import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, ClientMessage, RoomSummary } from "@livecg/shared";
import { Room } from "./room.ts";
import { DEFAULT_ROOM, deepMerge, type StoreSeed } from "./store.ts";
import { loadSeed } from "./persist.ts";

export const ROOM_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class RoomError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface CreateRoomInput {
  name: string;
  id?: string;
  /** 从已有房间复制播出单、配置和队伍资料（设备连接会被关闭，避免与原房间冲突） */
  copyFrom?: string;
}

/**
 * 房间管理：加载 / 创建 / 改名 / 删除，以及跨房间的设备冲突检查。
 *
 * 数据布局：<dataDir>/rooms/<id>.json，每个房间一个文件。
 * 从单房间版本升级时，<dataDir>/livecg.json 会被迁移为 default 房间。
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private roomsDir: string;
  private listeners = new Set<(event: "created" | "deleted", room: Room) => void>();

  constructor(
    private dataDir: string | undefined,
    /** 每个房间的在线客户端数（由 WebSocket 层提供） */
    private clientCount: (id: string) => { control: number; graphics: number } = () => ({ control: 0, graphics: 0 }),
  ) {
    this.roomsDir = dataDir ? join(dataDir, "rooms") : "";
  }

  setClientCounter(fn: (id: string) => { control: number; graphics: number }): void {
    this.clientCount = fn;
  }

  on(fn: (event: "created" | "deleted", room: Room) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fileFor(id: string): string | undefined {
    return this.roomsDir ? join(this.roomsDir, `${id}.json`) : undefined;
  }

  load(): void {
    if (this.roomsDir) {
      mkdirSync(this.roomsDir, { recursive: true });
      // 单房间版本迁移：livecg.json → rooms/default.json
      const legacy = join(this.dataDir!, "livecg.json");
      const target = this.fileFor(DEFAULT_ROOM.id)!;
      if (existsSync(legacy) && !existsSync(target)) {
        renameSync(legacy, target);
        console.log(`[rooms] 已把 ${legacy} 迁移为默认房间`);
      }
      for (const f of readdirSync(this.roomsDir).sort()) {
        const m = /^([a-z0-9][a-z0-9-]{0,31})\.json$/.exec(f);
        if (m) this.open(m[1]);
      }
    }
    if (!this.rooms.has(DEFAULT_ROOM.id)) this.open(DEFAULT_ROOM.id, { room: DEFAULT_ROOM });
  }

  private open(id: string, seedOverride?: StoreSeed): Room {
    const file = this.fileFor(id);
    const seed = { ...(file ? loadSeed(file, id) : {}), ...(seedOverride ?? {}) };
    const room = new Room(id, file, seed);
    this.rooms.set(id, room);
    room.start();
    return room;
  }

  get(id: string | undefined | null): Room | undefined {
    return this.rooms.get(id || DEFAULT_ROOM.id);
  }

  require(id: string | undefined | null): Room {
    const room = this.get(id);
    if (!room) throw new RoomError(`房间不存在：${id}`, 404);
    return room;
  }

  ids(): string[] {
    return [...this.rooms.keys()];
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => {
        const s = room.store.get();
        const m = s.match;
        return {
          ...s.room,
          sport: m.sport,
          period: m.period,
          home: { name: m.home.shortName || m.home.name, score: m.home.score },
          away: { name: m.away.shortName || m.away.name, score: m.away.score },
          onAir: Object.values(s.layers).filter((l) => l.visible).length,
          clients: this.clientCount(room.id),
          casparcg: s.outputs.casparcg.status,
          scoreboard: s.outputs.scoreboard.status,
          cs2LastFrameAt: (m.extra as { lastFrameAt?: number }).lastFrameAt,
        };
      })
      .sort((a, b) => (a.id === DEFAULT_ROOM.id ? -1 : b.id === DEFAULT_ROOM.id ? 1 : a.name.localeCompare(b.name, "zh")));
  }

  create(input: CreateRoomInput): Room {
    const name = String(input.name ?? "").trim();
    if (!name) throw new RoomError("请填写房间名称");
    if (name.length > 40) throw new RoomError("房间名称不能超过 40 个字符");
    const id = input.id?.trim() || this.nextId();
    if (!ROOM_ID_RE.test(id)) throw new RoomError("房间标识只能用小写字母、数字和连字符，最长 32 个字符，且不能以连字符开头");
    if (this.rooms.has(id)) throw new RoomError(`房间标识已存在：${id}`, 409);

    let seed: StoreSeed = { room: { id, name } };
    if (input.copyFrom) {
      const src = this.require(input.copyFrom).store.get();
      seed = {
        room: { id, name },
        rundown: structuredClone(src.rundown),
        // 设备连接不复制启用状态：两个房间连同一个 CasparCG 层 / UDP 端口会互相覆盖
        config: { ...structuredClone(src.config), casparcg: { ...structuredClone(src.config.casparcg), enabled: false }, scoreboard: { ...src.config.scoreboard, enabled: false } },
        match: { home: { ...src.match.home, score: 0 }, away: { ...src.match.away, score: 0 } },
      };
    }
    const room = this.open(id, seed);
    for (const fn of this.listeners) fn("created", room);
    return room;
  }

  rename(id: string, name: string): Room {
    const room = this.require(id);
    const n = String(name ?? "").trim();
    if (!n) throw new RoomError("请填写房间名称");
    if (n.length > 40) throw new RoomError("房间名称不能超过 40 个字符");
    room.store.setRoom({ id, name: n });
    return room;
  }

  /** 删除房间：数据文件改名保留（可人工恢复），不做物理删除 */
  delete(id: string): void {
    if (id === DEFAULT_ROOM.id) throw new RoomError("默认房间不能删除");
    const room = this.require(id);
    const s = room.store.get();
    if (Object.values(s.layers).some((l) => l.visible)) throw new RoomError("该房间还有图文在 PGM 上，请先全部下屏", 409);
    room.stop();
    this.rooms.delete(id);
    const file = this.fileFor(id);
    if (file && existsSync(file)) renameSync(file, `${file}.deleted-${Date.now()}`);
    for (const fn of this.listeners) fn("deleted", room);
  }

  stopAll(): void {
    for (const room of this.rooms.values()) room.stop();
  }

  /** 房间级指令入口：设备配置变更先做跨房间冲突检查 */
  handleCommand(id: string, msg: ClientMessage): void {
    const room = this.require(id);
    if (msg.type === "config.set") this.validateConfig(id, deepMerge(room.store.get().config, msg.patch));
    room.handleCommand(msg);
  }

  /**
   * 设备冲突检查：
   *  - 计分器 UDP 端口：两个启用的房间不能监听同一端口
   *  - CasparCG：任意两路启用的输出（不论是否同一房间）不能占用同一台 CasparCG 的同一 channel-layer
   */
  validateConfig(id: string, next: AppConfig): void {
    const others = [...this.rooms.values()].filter((r) => r.id !== id).map((r) => ({ room: r.store.get().room, cfg: r.store.get().config }));

    if (next.scoreboard.enabled) {
      const clash = others.find((o) => o.cfg.scoreboard.enabled && o.cfg.scoreboard.port === next.scoreboard.port);
      if (clash) throw new RoomError(`计分器 UDP 端口 ${next.scoreboard.port} 已被房间「${clash.room.name}」使用`, 409);
    }

    if (next.casparcg.enabled) {
      const key = (cfg: AppConfig["casparcg"], o: { channel: number; layer: number }) => `${cfg.host.trim().toLowerCase()}:${cfg.port}/${o.channel}-${o.layer}`;
      const mine = next.casparcg.outputs.filter((o) => o.enabled);
      const seen = new Map<string, string>();
      for (const o of mine) {
        const k = key(next.casparcg, o);
        if (seen.has(k)) throw new RoomError(`输出「${seen.get(k)}」和「${o.label}」占用了同一个 CasparCG 通道-层 ${o.channel}-${o.layer}`);
        seen.set(k, o.label);
      }
      for (const other of others) {
        if (!other.cfg.casparcg.enabled) continue;
        for (const o of other.cfg.casparcg.outputs.filter((x) => x.enabled)) {
          const k = key(other.cfg.casparcg, o);
          if (seen.has(k)) throw new RoomError(`CasparCG 通道-层 ${o.channel}-${o.layer} 已被房间「${other.room.name}」的输出「${o.label}」占用`, 409);
        }
      }
    }
  }

  private nextId(): string {
    for (let n = 2; ; n++) if (!this.rooms.has(`room-${n}`)) return `room-${n}`;
  }
}
