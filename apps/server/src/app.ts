import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { HaController, type HaOptions } from "./ha.ts";
import type { ClientMessage, Me, ServerMessage } from "@livecg/shared";
import { RoomError, RoomManager } from "./rooms.ts";
import type { Room } from "./room.ts";
import { PRESETS } from "./sports/presets.ts";
import { DEFAULT_ROOM } from "./store.ts";
import { announceInitialPassword, AuthError, LoginLimiter, publicUser, SessionStore, UserStore } from "./auth/auth.ts";
import { ANONYMOUS, AUTH_DISABLED, atLeast, canAccessRoom, denyReason, type Principal } from "./auth/permissions.ts";
import { AuditLog } from "./auth/audit.ts";

export interface AppOptions {
  /** apps/ 目录（静态文件根） */
  appsDir: string;
  /** 数据目录；不传则不持久化（测试用） */
  dataDir?: string;
  gsiToken: string;
  auth?: {
    /** 默认开启；关闭后所有人都是管理员（仅限本机开发） */
    enabled?: boolean;
    /** 首次启动的管理员密码；不给则随机生成并要求首次登录修改 */
    initialAdminPassword?: string;
    /** 设置后，未登录的输出页需要在地址上带 ?token= 才能读取状态 */
    outputToken?: string;
  };
  /** 主备：不配置则为单机 */
  ha?: Omit<HaOptions, "dataDir">;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** WebSocket 关闭码：房间不存在 / 已删除 */
export const WS_ROOM_GONE = 4404;
/** WebSocket 关闭码：输出页令牌缺失或错误 */
export const WS_UNAUTHORIZED = 4401;

const SESSION_COOKIE = "livecg_session";

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new HttpError("body too large", 413)); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

const readJson = async <T = Record<string, unknown>>(req: IncomingMessage): Promise<T> => {
  const text = await readBody(req);
  if (!text) return {} as T;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("请求体不是合法的 JSON", 400);
  }
};

const json = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string | string[]> = {}) =>
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }).end(JSON.stringify(body));

const cookieOf = (req: IncomingMessage, name: string) => {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
};

/**
 * 跨站请求防护：浏览器发起的请求如果带 Origin，必须与 Host 一致，否则不认 Cookie 会话。
 * （SameSite=Lax 已挡住跨站 POST；WebSocket 握手不受 SameSite 约束，必须靠这里挡。）
 */
const sameOrigin = (req: IncomingMessage) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

const clientIp = (req: IncomingMessage) => req.socket.remoteAddress ?? "";

export function createApp(opts: AppOptions) {
  const authEnabled = opts.auth?.enabled ?? true;
  const outputToken = opts.auth?.outputToken || undefined;
  const staticRoots: Record<string, string> = {
    "/graphics/": join(opts.appsDir, "graphics"),
    // 控制台是 React 构建产物（pnpm build 生成）
    "/control/": join(opts.appsDir, "control", "dist"),
  };

  // ───────────── 账号 / 会话 / 审计 ─────────────
  const users = new UserStore(opts.dataDir ? join(opts.dataDir, "users.json") : undefined);
  const sessions = new SessionStore(opts.dataDir ? join(opts.dataDir, "sessions.json") : undefined);
  const limiter = new LoginLimiter();
  const audit = new AuditLog(opts.dataDir);
  if (authEnabled) {
    const { createdAdmin } = users.load(opts.auth?.initialAdminPassword);
    if (createdAdmin && !opts.auth?.initialAdminPassword) announceInitialPassword(opts.dataDir, createdAdmin);
  }

  /** 凭据（会话 id 或 API 令牌）→ 当前身份；每次使用时重新解析，删号/降权/改密码立即生效 */
  interface Credentials { sid?: string; bearer?: string; trustedOrigin: boolean }
  const credentialsOf = (req: IncomingMessage): Credentials => ({
    sid: cookieOf(req, SESSION_COOKIE),
    bearer: /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1],
    trustedOrigin: sameOrigin(req),
  });
  const resolve = (c: Credentials): Principal & { mustChangePassword?: boolean } => {
    if (!authEnabled) return AUTH_DISABLED;
    if (c.bearer) {
      const hit = users.byToken(c.bearer);
      if (!hit) throw new HttpError("API 令牌无效或已被吊销", 401);
      return { username: hit.user.username, role: hit.user.role, rooms: hit.user.rooms, via: `token:${hit.token.label}` };
    }
    if (c.sid && c.trustedOrigin) {
      const name = sessions.get(c.sid);
      const u = name ? users.get(name) : undefined;
      if (u) return { username: u.username, role: u.role, rooms: u.rooms, via: "session", mustChangePassword: u.mustChangePassword };
    }
    return ANONYMOUS;
  };

  /** 需要登录的接口：匿名 401；初始/被重置的密码必须先改掉才能做别的 */
  const requireUser = (p: ReturnType<typeof resolve>, opts2: { allowMustChange?: boolean } = {}) => {
    if (p.anonymous) throw new HttpError("未登录", 401);
    if (p.mustChangePassword && !opts2.allowMustChange) throw new HttpError("请先修改初始密码", 403);
    return p;
  };
  const requireAdmin = (p: ReturnType<typeof resolve>) => {
    requireUser(p);
    if (!atLeast(p, "admin")) throw new HttpError("需要管理员权限", 403);
    return p;
  };

  // ───────────── 房间 ─────────────
  interface ClientInfo { room: string; role: string; creds: Credentials; ip: string }
  const clients = new Map<WebSocket, ClientInfo>();
  const peerUrl = () => (opts.ha ? (typeof opts.ha.peerUrl === "function" ? opts.ha.peerUrl() : opts.ha.peerUrl).replace(/\/+$/, "") : undefined);
  const rooms = new RoomManager(opts.dataDir, (id) => {
    const c = { control: 0, graphics: 0 };
    for (const info of clients.values()) if (info.room === id && (info.role === "control" || info.role === "graphics")) c[info.role]++;
    return c;
  }, { outputToken, failoverUrl: peerUrl });
  // 配置了主备时先以备机方式加载（不连设备），由 ha.start() 决定是否升为主机，
  // 避免重启的备机在判定角色前抢先向 CasparCG 发 PLAY
  if (opts.ha) rooms.setActive(false);

  const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const roomClients = (id: string) => [...clients].filter(([, info]) => info.room === id).map(([ws]) => ws);

  /** 把房间的状态和事件广播给该房间的客户端（只发给本房间） */
  const unwire = new Map<string, () => void>();
  const wire = (room: Room) => {
    const a = room.store.subscribe((state) => { for (const ws of roomClients(room.id)) send(ws, { type: "state", state }); });
    const b = room.onEvent((event) => { for (const ws of roomClients(room.id)) send(ws, { type: "event", event }); });
    unwire.set(room.id, () => { a(); b(); });
  };
  rooms.on((event, room) => {
    if (event === "created") return wire(room);
    unwire.get(room.id)?.();
    unwire.delete(room.id);
    for (const ws of roomClients(room.id)) ws.close(WS_ROOM_GONE, "room deleted");
  });
  rooms.load();
  for (const id of rooms.ids()) wire(rooms.require(id));
  const ha = new HaController(rooms, users, opts.ha ? { ...opts.ha, dataDir: opts.dataDir } : undefined);
  const requireActiveNode = () => {
    if (!ha.isActive) throw new HttpError("这台是备机：账号等数据从主机同步，请在主机上修改", 409);
  };

  /** 房间指令的唯一入口（WebSocket 与 HTTP 共用）：权限检查 → 执行 → 审计 */
  const runCommand = (p: Principal, room: string, msg: ClientMessage, ip: string) => {
    if (msg.type === "hello") return;
    const deny = denyReason(p, room, msg);
    if (deny) {
      audit.write({ user: p.username, via: p.via, ip, room, action: msg.type, detail: msg, ok: false, error: deny });
      throw new HttpError(deny, p.anonymous ? 401 : 403);
    }
    try {
      rooms.handleCommand(room, msg);
      audit.write({ user: p.username, via: p.via, ip, room, action: msg.type, detail: msg, ok: true });
    } catch (err) {
      audit.write({ user: p.username, via: p.via, ip, room, action: msg.type, detail: msg, ok: false, error: (err as Error).message });
      throw err;
    }
  };

  // ───────────── HTTP ─────────────
  async function serveStatic(url: string, res: ServerResponse): Promise<boolean> {
    for (const [prefix, dir] of Object.entries(staticRoots)) {
      if (!url.startsWith(prefix)) continue;
      let rel = decodeURIComponent(url.slice(prefix.length).split("?")[0]);
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const file = normalize(join(dir, rel));
      // 带分隔符比较，防止 ../graphicsX 之类的同前缀目录穿越
      if (!file.startsWith(dir + sep)) break;
      try {
        if (!(await stat(file)).isFile()) break;
        res.writeHead(200, {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
          "cache-control": "no-cache",
          // 输出页的模板是 ES Module：主备切换后输出页会从对端加载模板，跨源加载模块需要 CORS
          ...(prefix === "/graphics/" ? { "access-control-allow-origin": "*" } : {}),
        });
        res.end(await readFile(file));
        return true;
      } catch {
        break;
      }
    }
    return false;
  }

  const parseCommand = async (req: IncomingMessage): Promise<ClientMessage> => {
    const msg = await readJson<ClientMessage>(req);
    if (!msg || typeof msg.type !== "string") throw new HttpError("missing type", 400);
    return msg;
  };

  const setSessionCookie = (sid: string, maxAge: number) =>
    `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

  const me = (p: Principal): Me => {
    const stored = authEnabled ? users.get(p.username) : undefined;
    const user = stored
      ? publicUser(stored)
      : { username: p.username, role: p.role, rooms: p.rooms, mustChangePassword: false, tokens: [] };
    return {
      authDisabled: !authEnabled,
      user,
      ...(p.role === "admin" && outputToken ? { outputToken } : {}),
      ...(ha.enabled ? { node: ha.status() } : {}),
    };
  };

  const server: Server = createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const query = new URL(req.url ?? "/", "http://x").searchParams;
    const method = req.method ?? "GET";
    const ip = clientIp(req);
    try {
      // CS2 GSI：/gsi/cs2（默认房间）或 /gsi/cs2/<房间>；用 cfg 里的 token 鉴权
      let m = /^\/gsi\/cs2(?:\/([^/]+))?$/.exec(url);
      if (method === "POST" && m) {
        const room = rooms.require(m[1] ? decodeURIComponent(m[1]) : DEFAULT_ROOM.id);
        const payload = JSON.parse(await readBody(req));
        if (payload?.auth?.token !== opts.gsiToken) {
          res.writeHead(401).end();
          return;
        }
        room.ingestCs2(payload);
        res.writeHead(200).end();
        return;
      }

      // ───── 主备 ─────
      if (url.startsWith("/api/ha/")) {
        const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
        const fromPeer = ha.checkToken(bearer);
        const who = fromPeer ? { username: "peer", via: "replication" } : (() => {
          const p = resolve(credentialsOf(req));
          return { username: p.username, via: p.via, p };
        })();
        const asAdmin = () => {
          if (!fromPeer) requireAdmin((who as { p: ReturnType<typeof resolve> }).p);
        };
        if (method === "GET" && url === "/api/ha/status") {
          if (!fromPeer) requireUser((who as { p: ReturnType<typeof resolve> }).p);
          return json(res, 200, ha.status());
        }
        if (!ha.enabled) throw new HttpError("未配置主备（LIVECG_PEER_URL）", 400);
        if (method === "POST" && url === "/api/ha/promote") {
          asAdmin();
          const r = await ha.promote();
          audit.write({ user: who.username, via: who.via, ip, action: "ha.promote", detail: r, ok: true });
          return json(res, 200, { ok: true, ...r, node: ha.status() });
        }
        if (method === "POST" && url === "/api/ha/demote") {
          asAdmin();
          ha.demote();
          audit.write({ user: who.username, via: who.via, ip, action: "ha.demote", ok: true });
          return json(res, 200, { ok: true, node: ha.status() });
        }
        if (method === "POST" && url === "/api/ha/handover") {
          asAdmin();
          await ha.handover();
          audit.write({ user: who.username, via: who.via, ip, action: "ha.handover", ok: true });
          return json(res, 200, { ok: true });
        }
      }

      // 公开信息
      if (method === "GET" && url === "/api/presets") return json(res, 200, Object.values(PRESETS));
      if (method === "GET" && url === "/api/templates") {
        const files = await readdir(join(staticRoots["/graphics/"], "templates"));
        return json(res, 200, files.filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort());
      }

      // ───── 登录 ─────
      if (url.startsWith("/api/auth/")) {
        if (method === "POST" && url === "/api/auth/login") {
          if (!authEnabled) return json(res, 200, me(AUTH_DISABLED));
          if (!sameOrigin(req)) throw new HttpError("跨站登录请求被拒绝", 403);
          const body = await readJson<{ username?: string; password?: string }>(req);
          const username = String(body.username ?? "").trim();
          const key = `${ip}|${username.toLowerCase()}`;
          limiter.check(key);
          const u = users.verify(username, String(body.password ?? ""));
          if (!u) {
            limiter.fail(key);
            audit.write({ user: username || "?", via: "session", ip, action: "auth.login", ok: false, error: "用户名或密码错误" });
            throw new HttpError("用户名或密码错误", 401);
          }
          limiter.succeed(key);
          const sid = sessions.create(u.username);
          audit.write({ user: u.username, via: "session", ip, action: "auth.login", ok: true });
          const p: Principal = { username: u.username, role: u.role, rooms: u.rooms, via: "session" };
          return json(res, 200, me(p), { "set-cookie": setSessionCookie(sid, 24 * 3600) });
        }
        if (method === "POST" && url === "/api/auth/logout") {
          const c = credentialsOf(req);
          const p = resolve(c);
          sessions.destroy(c.sid);
          if (!p.anonymous) audit.write({ user: p.username, via: p.via, ip, action: "auth.logout", ok: true });
          return json(res, 200, { ok: true }, { "set-cookie": setSessionCookie("", 0) });
        }
        const c = credentialsOf(req);
        const p = resolve(c);
        if (method === "GET" && url === "/api/auth/me") return json(res, 200, me(requireUser(p, { allowMustChange: true })));
        if (method === "POST" && url === "/api/auth/password") {
          requireUser(p, { allowMustChange: true });
          requireActiveNode();
          if (!authEnabled) throw new HttpError("未开启鉴权", 400);
          const body = await readJson<{ current?: string; next?: string }>(req);
          users.changeOwnPassword(p.username, String(body.current ?? ""), String(body.next ?? ""));
          // 改密码后踢掉本人的其它会话（例如在别的电脑上登录的）
          sessions.destroyUser(p.username, c.sid);
          audit.write({ user: p.username, via: p.via, ip, action: "auth.password", ok: true });
          return json(res, 200, me(resolve(c)));
        }
        if (method === "POST" && url === "/api/auth/tokens") {
          requireUser(p);
          requireActiveNode();
          if (p.via !== "session") throw new HttpError("只能在控制台里创建令牌", 403);
          const body = await readJson<{ label?: string }>(req);
          const { token, info } = users.createToken(p.username, body.label);
          audit.write({ user: p.username, via: p.via, ip, action: "auth.token.create", detail: { label: info.label }, ok: true });
          return json(res, 201, { token, id: info.id, label: info.label });
        }
        m = /^\/api\/auth\/tokens\/([^/]+)$/.exec(url);
        if (method === "DELETE" && m) {
          requireUser(p);
          requireActiveNode();
          users.revokeToken(p.username, decodeURIComponent(m[1]));
          audit.write({ user: p.username, via: p.via, ip, action: "auth.token.revoke", detail: { id: m[1] }, ok: true });
          return json(res, 200, { ok: true });
        }
      }

      // 以下接口都需要登录
      const p = resolve(credentialsOf(req));
      if (url.startsWith("/api/")) requireUser(p);

      // ───── 账号管理（管理员） ─────
      if (url === "/api/users") {
        requireAdmin(p);
        if (method === "GET") return json(res, 200, users.list().map(publicUser));
        if (method === "POST") {
          requireActiveNode();
          const body = await readJson(req);
          const u = users.create({ username: body.username, password: body.password, role: body.role, rooms: body.rooms });
          audit.write({ user: p.username, via: p.via, ip, action: "user.create", detail: { username: u.username, role: u.role, rooms: u.rooms }, ok: true });
          return json(res, 201, publicUser(u));
        }
      }
      m = /^\/api\/users\/([^/]+)$/.exec(url);
      if (m) {
        requireAdmin(p);
        const name = decodeURIComponent(m[1]);
        if (method !== "GET") requireActiveNode();
        if (method === "PATCH") {
          const body = await readJson(req);
          const u = users.update(name, { role: body.role, rooms: body.rooms, password: body.password });
          if (body.password !== undefined || body.role !== undefined) sessions.destroyUser(u.username);
          audit.write({ user: p.username, via: p.via, ip, action: "user.update", detail: { username: u.username, role: body.role, rooms: body.rooms, passwordReset: body.password !== undefined }, ok: true });
          return json(res, 200, publicUser(u));
        }
        if (method === "DELETE") {
          if (name.toLowerCase() === p.username.toLowerCase()) throw new HttpError("不能删除自己", 400);
          users.delete(name);
          sessions.destroyUser(name);
          audit.write({ user: p.username, via: p.via, ip, action: "user.delete", detail: { username: name }, ok: true });
          return json(res, 200, { ok: true });
        }
      }

      // ───── 审计（管理员） ─────
      if (method === "GET" && url === "/api/audit") {
        requireAdmin(p);
        return json(res, 200, audit.query({
          date: query.get("date") ?? undefined,
          room: query.get("room") ?? undefined,
          user: query.get("user") ?? undefined,
          action: query.get("action") ?? undefined,
          limit: Number(query.get("limit") ?? 200),
        }));
      }

      // ───── 房间 ─────
      if (url === "/api/rooms") {
        if (method === "GET") return json(res, 200, rooms.list().filter((r) => canAccessRoom(p, r.id)));
        if (method === "POST") {
          requireAdmin(p);
          const body = await readJson<{ name?: string; id?: string; copyFrom?: string }>(req);
          const room = rooms.create({ name: body.name ?? "", id: body.id, copyFrom: body.copyFrom });
          audit.write({ user: p.username, via: p.via, ip, room: room.id, action: "room.create", detail: body, ok: true });
          return json(res, 201, room.store.get().room);
        }
      }
      m = /^\/api\/rooms\/([^/]+)(\/state|\/command)?$/.exec(url);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!m[2] && method === "PATCH") {
          requireAdmin(p);
          const body = await readJson<{ name?: string }>(req);
          const info = rooms.rename(id, body.name ?? "").store.get().room;
          audit.write({ user: p.username, via: p.via, ip, room: id, action: "room.rename", detail: body, ok: true });
          return json(res, 200, info);
        }
        if (!m[2] && method === "DELETE") {
          requireAdmin(p);
          rooms.delete(id);
          audit.write({ user: p.username, via: p.via, ip, room: id, action: "room.delete", ok: true });
          return json(res, 200, { ok: true });
        }
        if (!canAccessRoom(p, id)) throw new HttpError(`没有房间「${id}」的权限`, 403);
        if (m[2] === "/state" && method === "GET") return json(res, 200, rooms.require(id).store.get());
        if (m[2] === "/command" && method === "POST") {
          runCommand(p, id, await parseCommand(req), ip);
          return json(res, 200, { ok: true, rev: rooms.require(id).store.get().rev });
        }
      }

      // 兼容单房间版本：不带房间的接口作用于默认房间
      if (method === "POST" && url === "/api/command") {
        if (!canAccessRoom(p, DEFAULT_ROOM.id)) throw new HttpError("没有默认房间的权限", 403);
        runCommand(p, DEFAULT_ROOM.id, await parseCommand(req), ip);
        return json(res, 200, { ok: true, rev: rooms.require(DEFAULT_ROOM.id).store.get().rev });
      }
      if (method === "GET" && url === "/api/state") {
        if (!canAccessRoom(p, DEFAULT_ROOM.id)) throw new HttpError("没有默认房间的权限", 403);
        return json(res, 200, rooms.require(DEFAULT_ROOM.id).store.get());
      }

      if (method === "GET" && url === "/") {
        res.writeHead(302, { location: "/control/rooms.html" }).end();
        return;
      }
      if (method === "GET" && (await serveStatic(req.url ?? "/", res))) return;
      if (method === "GET" && url.startsWith("/control/")) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("控制台尚未构建：请在项目根目录运行 pnpm build（pnpm start 会自动构建）");
        return;
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      const status = err instanceof HttpError || err instanceof RoomError || err instanceof AuthError ? err.status : 400;
      json(res, status, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ───────────── WebSocket：/ws?room=<id> ─────────────
  // 未登录的连接（输出页）只读；登录的控制台按账号权限执行指令。
  const wss = new WebSocketServer({ noServer: true });
  const haWss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/ws") return wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    if (path === "/ha") {
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!ha.checkToken(bearer)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return socket.destroy();
      }
      return haWss.handleUpgrade(req, socket, head, (ws) => ha.serveReplica(ws));
    }
    socket.destroy();
  });
  wss.on("connection", (ws, req) => {
    const params = new URL(req.url ?? "/ws", "http://x").searchParams;
    const id = params.get("room") || DEFAULT_ROOM.id;
    const room = rooms.get(id);
    if (!room) {
      ws.close(WS_ROOM_GONE, "room not found");
      return;
    }
    const creds = credentialsOf(req);
    let principal: Principal;
    try {
      principal = resolve(creds);
    } catch {
      ws.close(WS_UNAUTHORIZED, "invalid token");
      return;
    }
    if (outputToken && principal.anonymous && params.get("token") !== outputToken) {
      ws.close(WS_UNAUTHORIZED, "output token required");
      return;
    }
    const ip = clientIp(req);
    clients.set(ws, { room: id, role: "unknown", creds, ip });
    ws.on("close", () => clients.delete(ws));
    send(ws, { type: "state", state: room.store.get() });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (msg.type === "hello") {
          clients.set(ws, { room: id, role: msg.role, creds, ip });
          return;
        }
        let p: Principal;
        try {
          p = resolve(creds);
        } catch {
          p = ANONYMOUS;
        }
        if ((p as { mustChangePassword?: boolean }).mustChangePassword) throw new HttpError("请先修改初始密码", 403);
        runCommand(p, id, msg, ip);
      } catch (err) {
        send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  return {
    server,
    rooms,
    users,
    audit,
    ha,
    listen(port: number): Promise<number> {
      return new Promise((resolvePort) => server.listen(port, () => resolvePort((server.address() as { port: number }).port)));
    },
    close(): Promise<void> {
      ha.stop();
      rooms.stopAll();
      sessions.flush();
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      haWss.close();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
