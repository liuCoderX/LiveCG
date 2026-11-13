import { createSocket, type Socket } from "node:dgram";
import type { DeepPartial, MatchState, PeriodDef } from "@livecg/shared";
import type { Store } from "../store.ts";
import { parseClock } from "./clock.ts";

/**
 * 外部计分器输入（UDP）。
 *
 * 各厂商计分器的串口协议大多不公开，LiveCG 不内置任何厂商协议，而是定义一个简单的通用格式：
 * 每个 UDP 包是一帧，内容为 JSON 或 key=value 文本。厂商协议由一个小的桥接程序（或串口转网络
 * 设备 + 脚本）翻译成这个格式发过来即可。字段都是可选的，只更新包里出现的字段：
 *
 *   {"clock":"9:58.3","running":true,"period":2,"home":45,"away":41,"shot":"14.0",
 *    "homeFouls":3,"awayFouls":2,"homeTimeouts":2,"awayTimeouts":1}
 *   clock=9:58.3;running=1;period=2;home=45;away=41;shot=14
 *
 * - clock / shot：时钟读数，"mm:ss"、"mm:ss.t"、"ss.t"；或用 clockMs / shotMs 传毫秒
 * - shot 为空字符串或 "off" 表示进攻时钟关闭
 * - period：从 1 开始的节次
 * - 时钟字段只在「时钟来源 = 计分器」时生效；比分、节次、犯规、暂停只要收到就生效
 */
export interface ScoreboardFrame {
  clockMs?: number;
  running?: boolean;
  period?: number;
  home?: number;
  away?: number;
  /** null = 进攻时钟关闭 */
  shotMs?: number | null;
  homeFouls?: number;
  awayFouls?: number;
  homeTimeouts?: number;
  awayTimeouts?: number;
}

const truthy = (v: unknown) => v === true || v === 1 || /^(1|true|yes|on|run|running)$/i.test(String(v));
const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? Math.max(0, Math.round(n)) : undefined;
};

export function parseScoreboardPacket(text: string): ScoreboardFrame | null {
  const raw = text.trim();
  if (!raw) return null;
  let obj: Record<string, unknown>;
  if (raw.startsWith("{")) {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  } else {
    obj = {};
    for (const part of raw.split(/[;,&\n]+/)) {
      const i = part.indexOf("=");
      if (i > 0) obj[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
  }
  const f: ScoreboardFrame = {};
  const clockMs = obj.clockMs !== undefined ? int(obj.clockMs) : obj.clock !== undefined ? parseClock(String(obj.clock)) : undefined;
  if (clockMs !== undefined) f.clockMs = clockMs;
  if (obj.running !== undefined) f.running = truthy(obj.running);
  if (obj.shotMs !== undefined || obj.shot !== undefined) {
    const v = obj.shotMs ?? obj.shot;
    f.shotMs = v === null || v === "" || /^off$/i.test(String(v)) ? null : obj.shotMs !== undefined ? int(v) ?? null : parseClock(String(v)) ?? null;
  }
  for (const k of ["period", "home", "away", "homeFouls", "awayFouls", "homeTimeouts", "awayTimeouts"] as const) {
    const v = int(obj[k]);
    if (v !== undefined) f[k] = v;
  }
  return Object.keys(f).length ? f : null;
}

export class ScoreboardInput {
  private sock?: Socket;
  private boundKey = "";
  private staleTimer?: NodeJS.Timeout;
  /** 最近一包的精确时间（状态里的 lastAt 为减少提交做了节流，不能用来判断掉线） */
  private lastPacketAt = 0;
  private unsubscribe?: () => void;

  constructor(
    private store: Store,
    /** 节次序号 → 定义（来自当前赛制） */
    private periodAt: (index: number) => PeriodDef | undefined,
    private now: () => number = Date.now,
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe(() => this.sync());
    this.sync();
    this.staleTimer = setInterval(() => this.checkStale(), 500);
  }

  stop(): void {
    this.unsubscribe?.();
    clearInterval(this.staleTimer);
    this.sock?.close();
    this.sock = undefined;
  }

  private sync(): void {
    const cfg = this.store.get().config.scoreboard;
    const key = cfg.enabled ? String(cfg.port) : "";
    if (key === this.boundKey) return;
    this.boundKey = key;
    this.sock?.close();
    this.sock = undefined;
    if (!cfg.enabled) return this.setStatus({ status: "disabled", message: undefined, lastAt: undefined });

    const sock = createSocket({ type: "udp4", reuseAddr: true });
    this.sock = sock;
    sock.on("message", (buf) => this.onPacket(buf.toString("utf8")));
    sock.on("error", (err) => {
      this.setStatus({ status: "error", message: `UDP ${cfg.port}：${err.message}` });
      sock.close();
      if (this.sock === sock) {
        this.sock = undefined;
        this.boundKey = "";
      }
    });
    sock.bind(cfg.port, () => this.setStatus({ status: "listening", message: `UDP ${cfg.port}`, lastAt: undefined }));
  }

  /** 也供测试 / 其它输入方式（如 TCP 桥）直接调用 */
  onPacket(text: string): void {
    const f = parseScoreboardPacket(text);
    if (!f) return;
    const now = this.now();
    this.lastPacketAt = now;
    const s = this.store.get();
    const patch: DeepPartial<MatchState> = {};

    if (f.home !== undefined) patch.home = { score: f.home };
    if (f.away !== undefined) patch.away = { score: f.away };
    if (f.period !== undefined && f.period >= 1) {
      const def = this.periodAt(f.period - 1);
      patch.periodIndex = f.period - 1;
      if (def) {
        patch.period = def.label;
        patch.periodShort = def.short;
      }
    }

    if (s.config.scoreboard.clockSource === "scoreboard") {
      const cur = s.match.clock;
      const def = this.periodAt(f.period !== undefined ? f.period - 1 : s.match.periodIndex ?? 0);
      if (f.clockMs !== undefined || f.running !== undefined) {
        patch.clock = {
          ms: f.clockMs ?? cur?.ms ?? 0,
          running: f.running ?? cur?.running ?? false,
          direction: def?.direction ?? cur?.direction ?? "down",
          updatedAt: now,
        };
      }
      if (f.shotMs !== undefined) {
        patch.shotClock = f.shotMs === null
          ? undefined
          : { ms: f.shotMs, running: f.running ?? cur?.running ?? false, direction: "down", updatedAt: now };
      }
    }

    const extra: Record<string, unknown> = {};
    const ex = s.match.extra as { fouls?: Record<string, number>; timeouts?: Record<string, number> };
    if (f.homeFouls !== undefined || f.awayFouls !== undefined) {
      extra.fouls = { home: f.homeFouls ?? ex.fouls?.home ?? 0, away: f.awayFouls ?? ex.fouls?.away ?? 0 };
    }
    if (f.homeTimeouts !== undefined || f.awayTimeouts !== undefined) {
      extra.timeouts = { home: f.homeTimeouts ?? ex.timeouts?.home ?? 0, away: f.awayTimeouts ?? ex.timeouts?.away ?? 0 };
    }
    if (Object.keys(extra).length) patch.extra = extra;

    // shotClock 关闭需要真正删掉字段，deepMerge 做不到，走 setMatch
    if ("shotClock" in patch && patch.shotClock === undefined) {
      const { shotClock: _s, ...rest } = patch;
      this.store.setMatch((m) => {
        const next = { ...m };
        delete next.shotClock;
        return next;
      });
      this.store.patchMatch(rest);
    } else {
      this.store.patchMatch(patch);
    }
    this.setStatus({ status: "receiving", message: undefined, lastAt: now });
  }

  private checkStale(): void {
    const sb = this.store.get().outputs.scoreboard;
    const { staleMs } = this.store.get().config.scoreboard;
    if (sb.status === "receiving" && this.now() - this.lastPacketAt > staleMs) {
      this.setStatus({ status: "stale", message: `超过 ${Math.round(staleMs / 1000)} 秒没有收到计分器数据` });
    }
  }

  private setStatus(patch: Partial<ReturnType<Store["get"]>["outputs"]["scoreboard"]>): void {
    const cur = this.store.get().outputs.scoreboard;
    // lastAt 每包都变：只有状态变化或每秒一次才提交，避免状态风暴
    const onlyLastAt = Object.keys(patch).every((k) => k === "lastAt" || JSON.stringify((cur as any)[k]) === JSON.stringify((patch as any)[k]));
    if (onlyLastAt && patch.lastAt && cur.lastAt && patch.lastAt - cur.lastAt < 1000) return;
    if (Object.entries(patch).every(([k, v]) => JSON.stringify((cur as any)[k]) === JSON.stringify(v))) return;
    this.store.setOutputs({ scoreboard: patch });
  }
}
