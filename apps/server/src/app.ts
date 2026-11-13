import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@livecg/shared";
import { RoomError, RoomManager } from "./rooms.ts";
import type { Room } from "./room.ts";
import { PRESETS } from "./sports/presets.ts";
import { DEFAULT_ROOM } from "./store.ts";

export interface AppOptions {
  /** apps/ 目录（静态文件根） */
  appsDir: string;
  /** 数据目录；不传则不持久化（测试用） */
  dataDir?: string;
  gsiToken: string;
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
};

/** WebSocket 关闭码：房间不存在 / 已删除 */
export const WS_ROOM_GONE = 4404;

function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new RoomError("body too large", 413)); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

const json = (res: ServerResponse, code: number, body: unknown) =>
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));

export function createApp(opts: AppOptions) {
  const staticRoots: Record<string, string> = {
    "/graphics/": join(opts.appsDir, "graphics"),
    // 控制台是 React 构建产物（pnpm build 生成）
    "/control/": join(opts.appsDir, "control", "dist"),
  };

  // ───────────── 房间 ─────────────
  const clients = new Map<WebSocket, { room: string; role: string }>();
  const rooms = new RoomManager(opts.dataDir, (id) => {
    const c = { control: 0, graphics: 0 };
    for (const info of clients.values()) if (info.room === id && (info.role === "control" || info.role === "graphics")) c[info.role]++;
    return c;
  });

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
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
        res.end(await readFile(file));
        return true;
      } catch {
        break;
      }
    }
    return false;
  }

  const parseCommand = async (req: IncomingMessage): Promise<ClientMessage> => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(await readBody(req));
    } catch {
      throw new RoomError("请求体不是合法的 JSON");
    }
    if (!msg || typeof msg.type !== "string") throw new RoomError("missing type");
    return msg;
  };

  const server: Server = createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const method = req.method ?? "GET";
    try {
      // CS2 GSI：/gsi/cs2（默认房间）或 /gsi/cs2/<房间>
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

      // 房间管理
      if (url === "/api/rooms") {
        if (method === "GET") return json(res, 200, rooms.list());
        if (method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}");
          const room = rooms.create({ name: body.name, id: body.id, copyFrom: body.copyFrom });
          return json(res, 201, room.store.get().room);
        }
      }
      m = /^\/api\/rooms\/([^/]+)(\/state|\/command)?$/.exec(url);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!m[2] && method === "PATCH") {
          const body = JSON.parse((await readBody(req)) || "{}");
          return json(res, 200, rooms.rename(id, body.name).store.get().room);
        }
        if (!m[2] && method === "DELETE") {
          rooms.delete(id);
          return json(res, 200, { ok: true });
        }
        if (m[2] === "/state" && method === "GET") return json(res, 200, rooms.require(id).store.get());
        if (m[2] === "/command" && method === "POST") {
          const msg = await parseCommand(req);
          rooms.handleCommand(id, msg);
          return json(res, 200, { ok: true, rev: rooms.require(id).store.get().rev });
        }
      }

      // 兼容单房间版本：不带房间的接口作用于默认房间
      if (method === "POST" && url === "/api/command") {
        const msg = await parseCommand(req);
        rooms.handleCommand(DEFAULT_ROOM.id, msg);
        return json(res, 200, { ok: true, rev: rooms.require(DEFAULT_ROOM.id).store.get().rev });
      }
      if (method === "GET" && url === "/api/state") return json(res, 200, rooms.require(DEFAULT_ROOM.id).store.get());

      if (method === "GET" && url === "/api/presets") return json(res, 200, Object.values(PRESETS));
      if (method === "GET" && url === "/api/templates") {
        const files = await readdir(join(staticRoots["/graphics/"], "templates"));
        return json(res, 200, files.filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort());
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
      const status = err instanceof RoomError ? err.status : 400;
      json(res, status, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ───────────── WebSocket：/ws?room=<id> ─────────────
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const id = new URL(req.url ?? "/ws", "http://x").searchParams.get("room") || DEFAULT_ROOM.id;
    const room = rooms.get(id);
    if (!room) {
      ws.close(WS_ROOM_GONE, "room not found");
      return;
    }
    clients.set(ws, { room: id, role: "unknown" });
    ws.on("close", () => clients.delete(ws));
    send(ws, { type: "state", state: room.store.get() });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (msg.type === "hello") clients.set(ws, { room: id, role: msg.role });
        rooms.handleCommand(id, msg);
      } catch (err) {
        send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  return {
    server,
    rooms,
    listen(port: number): Promise<number> {
      return new Promise((resolve) => server.listen(port, () => resolve((server.address() as { port: number }).port)));
    },
    close(): Promise<void> {
      rooms.stopAll();
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
