import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import type { AppState, NodeStatus } from "@livecg/shared";
import type { RoomManager } from "./rooms.ts";
import type { StoredUser, UserStore } from "./auth/auth.ts";

/**
 * 主备（双机热备）。
 *
 * 两台 LiveCG 互为对端（LIVECG_PEER_URL），用共享密钥（LIVECG_REPLICATION_TOKEN）互相认证。
 * - 主机（active）：正常运行；通过 /ha WebSocket 把所有房间的完整状态和账号实时推给备机。
 * - 备机（standby）：只镜像，不连 CasparCG、不监听计分器、不计时、不处理 CS2，指令一律拒绝。
 *
 * 切换是人工操作（管理员点「接管为主机」），不做自动升主：自动升主在网络抖动、主机自己恢复时
 * 容易出现两台同时驱动 CasparCG 的「双主」。启动时、运行中都会探测对端，出现双主时在控制台告警。
 *
 * 输出页地址带 &failover=<对端>：主机断线时，已经在 CasparCG / OBS 里运行的输出页自己改连备机，
 * 因为备机是镜像，画面和 takeId 都一致，不会重播入场。
 */

export interface HaOptions {
  peerUrl: string | (() => string);
  token: string;
  /** 初始角色：primary 启动即为主机（除非对端已经是主机）；backup 启动为备机 */
  role: "primary" | "backup";
  dataDir?: string;
}

type ReplicaMessage =
  | { type: "snapshot"; rooms: AppState[]; users: StoredUser[] }
  | { type: "room"; state: AppState }
  | { type: "room-deleted"; id: string }
  | { type: "users"; users: StoredUser[] };

/** WebSocket 关闭码：对端不是主机，不能提供同步 */
export const WS_NOT_ACTIVE = 4409;

const tokenEquals = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export class HaController {
  private role: NodeStatus["role"] = "active";
  private link: NonNullable<NodeStatus["link"]> = { connected: false };
  private conflict = false;
  private client?: WebSocket;
  private retryTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private replicas = new Set<WebSocket>();
  private closed = false;

  constructor(
    private rooms: RoomManager,
    private users: UserStore,
    private opts?: HaOptions,
  ) {}

  get enabled(): boolean {
    return !!this.opts;
  }

  get isActive(): boolean {
    return this.role === "active";
  }

  peer(): string | undefined {
    if (!this.opts) return undefined;
    const p = typeof this.opts.peerUrl === "function" ? this.opts.peerUrl() : this.opts.peerUrl;
    return p.replace(/\/+$/, "");
  }

  status(): NodeStatus & { conflict?: boolean } {
    if (!this.opts) return { role: "active" };
    return {
      role: this.role,
      peer: this.peer(),
      ...(this.role === "standby" ? { link: { ...this.link } } : {}),
      ...(this.conflict ? { conflict: true } : {}),
    };
  }

  /** 校验对端发来的复制令牌 */
  checkToken(bearer: string | undefined): boolean {
    return !!this.opts && !!bearer && tokenEquals(bearer, this.opts.token);
  }

  private get stateFile() {
    return this.opts?.dataDir ? join(this.opts.dataDir, "ha.json") : undefined;
  }

  /** 决定启动角色：对端已经是主机 → 备机；否则沿用上次的角色（升主后重启仍是主机）；再否则按配置 */
  async start(): Promise<void> {
    if (!this.opts) {
      this.rooms.setActive(true);
      return;
    }
    let persisted: NodeStatus["role"] | undefined;
    if (this.stateFile && existsSync(this.stateFile)) {
      try { persisted = JSON.parse(readFileSync(this.stateFile, "utf8")).role; } catch { /* ignore */ }
    }
    const peer = await this.peerStatus();
    let role: NodeStatus["role"];
    if (peer?.role === "active") {
      role = "standby";
      if (persisted === "active" || this.opts.role === "primary") console.warn(`[ha] 对端 ${this.peer()} 已经是主机，本机以备机身份启动（避免双主）`);
    } else {
      role = persisted ?? (this.opts.role === "primary" ? "active" : "standby");
    }
    this.apply(role, { adopt: false });
  }

  stop(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    this.client?.terminate();
    for (const ws of this.replicas) ws.terminate();
  }

  /** 备机 → 主机。先尽量让对端降为备机（计划内倒换无缝）；对端不可达时直接接管（故障切换） */
  async promote(): Promise<{ peerDemoted: boolean }> {
    if (!this.opts) throw new Error("未配置主备");
    if (this.role === "active") return { peerDemoted: false };
    let peerDemoted = false;
    try {
      const r = await this.peerFetch("/api/ha/demote", "POST");
      peerDemoted = r.ok;
    } catch {
      /* 对端不可达：故障切换 */
    }
    this.apply("active", { adopt: true });
    return { peerDemoted };
  }

  /** 主机 → 备机（由对端接管时调用） */
  demote(): void {
    if (!this.opts || this.role === "standby") return;
    this.apply("standby", { adopt: false });
  }

  /** 主机发起的计划内倒换：请对端接管（对端会回调本机 demote） */
  async handover(): Promise<void> {
    if (!this.opts) throw new Error("未配置主备");
    if (this.role !== "active") throw new Error("只有主机可以发起倒换");
    const r = await this.peerFetch("/api/ha/promote", "POST").catch((err: Error) => {
      throw new Error(`联系不上对端 ${this.peer()}：${err.message}`);
    });
    if (!r.ok) throw new Error(`对端拒绝接管：HTTP ${r.status}`);
  }

  private apply(role: NodeStatus["role"], opts: { adopt: boolean }) {
    this.role = role;
    this.conflict = false;
    if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify({ role, at: Date.now() }));
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    if (role === "active") {
      this.client?.terminate();
      this.client = undefined;
      this.link = { connected: false };
      this.rooms.setActive(true, { adopt: opts.adopt });
      // 运行中持续探测：对端也是主机 → 双主告警
      this.pollTimer = setInterval(async () => {
        const s = await this.peerStatus();
        this.conflict = s?.role === "active";
      }, 5_000);
      console.log("[ha] 本机为主机");
    } else {
      for (const ws of this.replicas) ws.close(WS_NOT_ACTIVE, "demoted");
      this.rooms.setActive(false);
      this.connect();
      console.log(`[ha] 本机为备机，从 ${this.peer()} 同步`);
    }
  }

  private async peerFetch(path: string, method = "GET"): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3_000);
    try {
      return await fetch(`${this.peer()}${path}`, { method, headers: { authorization: `Bearer ${this.opts!.token}` }, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  private async peerStatus(): Promise<NodeStatus | undefined> {
    try {
      const r = await this.peerFetch("/api/ha/status");
      return r.ok ? ((await r.json()) as NodeStatus) : undefined;
    } catch {
      return undefined;
    }
  }

  // ───────────── 备机：同步客户端 ─────────────

  private connect() {
    if (this.closed || this.role !== "standby") return;
    const url = `${this.peer()!.replace(/^http/, "ws")}/ha`;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.opts!.token}` } });
    this.client = ws;
    // 主机每 5 秒 ping 一次；12 秒没有任何动静（主机断电、网线断开时 TCP 可能长时间不报错）就判定失联
    let lastSeen = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastSeen > 12_000) ws.terminate();
    }, 2_000);
    ws.on("ping", () => (lastSeen = Date.now()));
    ws.on("message", () => (lastSeen = Date.now()));
    ws.on("close", () => clearInterval(watchdog));
    ws.on("open", () => {
      lastSeen = Date.now();
      this.link = { connected: true, lastSyncAt: Date.now() };
    });
    ws.on("message", (raw) => {
      try {
        this.onReplica(JSON.parse(raw.toString()) as ReplicaMessage);
        this.link.lastSyncAt = Date.now();
      } catch (err) {
        console.error("[ha] 同步数据处理失败", err);
      }
    });
    ws.on("error", (err) => (this.link.message = err.message));
    ws.on("close", (code) => {
      if (this.client !== ws) return;
      this.link = { connected: false, lastSyncAt: this.link.lastSyncAt, message: code === WS_NOT_ACTIVE ? "对端不是主机" : this.link.message ?? "连接断开" };
      if (!this.closed && this.role === "standby") this.retryTimer = setTimeout(() => this.connect(), 2_000);
    });
  }

  private onReplica(msg: ReplicaMessage) {
    if (this.role !== "standby") return;
    switch (msg.type) {
      case "snapshot": {
        const ids = new Set(msg.rooms.map((s) => s.room.id));
        for (const id of this.rooms.ids()) if (!ids.has(id)) this.rooms.mirrorDelete(id);
        for (const s of msg.rooms) this.rooms.mirror(s);
        this.users.replaceAll(msg.users);
        return;
      }
      case "room":
        return this.rooms.mirror(msg.state);
      case "room-deleted":
        return this.rooms.mirrorDelete(msg.id);
      case "users":
        return this.users.replaceAll(msg.users);
    }
  }

  // ───────────── 主机：向备机推送 ─────────────

  /** /ha 连接（已通过令牌校验）：先发完整快照，之后推送每次变化 */
  serveReplica(ws: WebSocket) {
    if (this.role !== "active") {
      ws.close(WS_NOT_ACTIVE, "not active");
      return;
    }
    this.replicas.add(ws);
    const send = (m: ReplicaMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    const subs = new Map<string, () => void>();
    const watch = (id: string) => {
      const room = this.rooms.get(id);
      if (!room || subs.has(id)) return;
      subs.set(id, room.store.subscribe((state) => send({ type: "room", state })));
    };
    send({ type: "snapshot", rooms: this.rooms.ids().map((id) => this.rooms.require(id).store.get()), users: this.users.snapshot() });
    for (const id of this.rooms.ids()) watch(id);
    const offRooms = this.rooms.on((event, room) => {
      if (event === "created") {
        watch(room.id);
        send({ type: "room", state: room.store.get() });
      } else {
        subs.get(room.id)?.();
        subs.delete(room.id);
        send({ type: "room-deleted", id: room.id });
      }
    });
    const offUsers = this.users.on(() => send({ type: "users", users: this.users.snapshot() }));
    // 心跳：半开连接 10 秒内被发现
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 5_000);
    ws.on("close", () => {
      this.replicas.delete(ws);
      clearInterval(ping);
      offRooms();
      offUsers();
      for (const off of subs.values()) off();
    });
  }
}
