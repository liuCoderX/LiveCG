import { randomUUID } from "node:crypto";
import type {
  BasketballExtra,
  ClientMessage,
  ClockState,
  FootballEvent,
  FootballExtra,
  GameEvent,
  MatchState,
  PeriodDef,
  SportPreset,
  SportPresetId,
  TeamKey,
} from "@livecg/shared";
import type { Store } from "../store.ts";
import { adjustClock, clockNow, msUntilZero, setClock, startClock, stopClock } from "./clock.ts";
import { PRESETS, periodAt } from "./presets.ts";

const MIN = 60_000;
const GOAL_TYPES = new Set<FootballEvent["type"]>(["goal", "ownGoal", "penaltyGoal"]);

type SportsMessage = Extract<
  ClientMessage,
  { type: `clock.${string}` | `period.${string}` | `shotclock.${string}` | `football.${string}` | `basketball.${string}` | "match.setup" }
>;

export const isSportsMessage = (msg: ClientMessage): msg is SportsMessage =>
  /^(clock|period|shotclock|football|basketball)\./.test(msg.type) || msg.type === "match.setup";

/**
 * 传统体育控制器：时钟、节次、足球事件、篮球犯规/暂停。
 *
 * 时钟由服务端权威维护（锚点 + 本地插值），这里负责两个定时器：
 *  - 主时钟倒计时归零 → 停表并发出 clock.expired
 *  - 进攻时钟归零 → 停在 0 并发出 shotclock.expired（主时钟由裁判决定，不自动停）
 * 时钟来源切到「计分器」时，内部定时器全部停止，时钟操作被拒绝，避免两个来源互相覆盖。
 */
export class SportsController {
  private clockTimer?: NodeJS.Timeout;
  private shotTimer?: NodeJS.Timeout;
  private lastSource?: string;
  private unsubscribe: () => void;

  constructor(
    private store: Store,
    private emit: (e: GameEvent) => void,
    private now: () => number = Date.now,
  ) {
    // 时钟来源切换（计分器 ↔ 内部）时重新挂定时器：从计分器最后的读数无缝接管
    this.unsubscribe = store.subscribe((s) => {
      const src = this.externalClock ? "scoreboard" : "internal";
      if (src !== this.lastSource) {
        this.lastSource = src;
        this.schedule();
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
    clearTimeout(this.clockTimer);
    clearTimeout(this.shotTimer);
  }

  get externalClock(): boolean {
    const sb = this.store.get().config.scoreboard;
    return sb.enabled && sb.clockSource === "scoreboard";
  }

  private get match(): MatchState {
    return this.store.get().match;
  }

  get preset(): SportPreset | undefined {
    const id = (this.match.extra as { preset?: SportPresetId }).preset;
    return id && (this.match.sport === "football" || this.match.sport === "basketball") ? PRESETS[id] : undefined;
  }

  private requirePreset(sport?: "football" | "basketball"): SportPreset {
    const p = this.preset;
    if (!p) throw new Error("请先在「赛况」里选择项目并开始新比赛");
    if (sport && p.sport !== sport) throw new Error(`当前比赛不是${sport === "football" ? "足球" : "篮球"}`);
    return p;
  }

  private requireInternalClock(): void {
    if (this.externalClock) throw new Error("时钟当前由计分器驱动；如需手动操作，请先把时钟来源切换为「内部时钟」");
  }

  handle(msg: SportsMessage): void {
    switch (msg.type) {
      case "match.setup":
        return this.setup(msg.preset);
      case "clock.start":
      case "clock.stop":
      case "clock.toggle": {
        this.requireInternalClock();
        this.requirePreset();
        const running = !!this.match.clock?.running;
        const start = msg.type === "clock.start" || (msg.type === "clock.toggle" && !running);
        return start ? this.startClocks() : this.stopClocks();
      }
      case "clock.set":
        this.requireInternalClock();
        return this.updateClock((c, now) => setClock(c, msg.ms, now));
      case "clock.adjust":
        this.requireInternalClock();
        return this.updateClock((c, now) => adjustClock(c, msg.deltaMs, now));
      case "period.set":
        return this.setPeriod(msg.index);
      case "period.next":
        return this.setPeriod((this.match.periodIndex ?? 0) + 1);
      case "period.prev":
        return this.setPeriod((this.match.periodIndex ?? 0) - 1);
      case "shotclock.reset":
        return this.resetShotClock(msg.ms);
      case "football.addedTime":
        this.requirePreset("football");
        return this.patchExtra<FootballExtra>({ addedTime: Math.max(0, Math.min(30, Math.round(msg.minutes))) });
      case "football.event":
        return this.addFootballEvent(msg.event);
      case "football.undo":
        return this.undoFootballEvent(msg.id);
      case "basketball.foul":
      case "basketball.timeout": {
        this.requirePreset("basketball");
        const key = msg.type === "basketball.foul" ? "fouls" : "timeouts";
        const cur = (this.match.extra as unknown as BasketballExtra)[key];
        return this.patchExtra<BasketballExtra>({ [key]: { ...cur, [msg.team]: Math.max(0, cur[msg.team] + msg.delta) } });
      }
      case "basketball.possession": {
        this.requirePreset("basketball");
        const cur = (this.match.extra as unknown as BasketballExtra).possession;
        const next: TeamKey = msg.team ?? (cur === "home" ? "away" : "home");
        return this.patchExtra<BasketballExtra>({ possession: next });
      }
    }
  }

  // ───────────── 比赛设置 / 节次 ─────────────

  private setup(id: SportPresetId): void {
    const preset = PRESETS[id];
    if (!preset) throw new Error(`未知的赛制：${id}`);
    const now = this.now();
    const p0 = preset.periods[0];
    const extra: FootballExtra | BasketballExtra =
      preset.sport === "football"
        ? { preset: id, addedTime: 0, events: [], redCards: { home: 0, away: 0 } }
        : {
            preset: id,
            fouls: { home: 0, away: 0 },
            timeouts: { home: p0.resetTimeouts ?? 0, away: p0.resetTimeouts ?? 0 },
            penaltyFouls: preset.penaltyFouls ?? 4,
            timeoutsMax: Math.max(0, ...preset.periods.map((p) => p.resetTimeouts ?? 0)),
          };
    this.store.setMatch((m) => ({
      ...m,
      sport: preset.sport,
      period: p0.label,
      periodShort: p0.short,
      periodIndex: 0,
      home: { ...m.home, score: 0, side: undefined },
      away: { ...m.away, score: 0, side: undefined },
      clock: { ms: p0.startMs, running: false, direction: p0.direction, updatedAt: now },
      shotClock: preset.shotClockMs ? { ms: preset.shotClockMs, running: false, direction: "down", updatedAt: now } : undefined,
      extra: extra as unknown as Record<string, unknown>,
    }));
    this.schedule();
    this.emit({ type: "period.start", periodIndex: 0, label: p0.label });
  }

  private setPeriod(index: number): void {
    const preset = this.requirePreset();
    const def = periodAt(preset, index);
    if (!def) return; // 越界：保持不动
    const now = this.now();
    const extraPatch: Record<string, unknown> = {};
    if (preset.sport === "football") extraPatch.addedTime = 0;
    if (preset.sport === "basketball") {
      const bx = this.match.extra as unknown as BasketballExtra;
      if (def.resetFouls) extraPatch.fouls = { home: 0, away: 0 };
      if (def.resetTimeouts !== undefined) extraPatch.timeouts = { home: def.resetTimeouts, away: def.resetTimeouts };
      else extraPatch.timeouts = bx.timeouts;
    }
    this.store.setMatch((m) => ({
      ...m,
      period: def.label,
      periodShort: def.short,
      periodIndex: index,
      // 计分器驱动时不动时钟，交给计分器
      clock: this.externalClock && m.clock ? m.clock : { ms: def.startMs, running: false, direction: def.direction, updatedAt: now },
      shotClock: m.shotClock && preset.shotClockMs && !this.externalClock ? { ...m.shotClock, ms: preset.shotClockMs, running: false, updatedAt: now } : m.shotClock,
      extra: { ...m.extra, ...extraPatch },
    }));
    this.schedule();
    this.emit({ type: "period.start", periodIndex: index, label: def.label });
  }

  currentPeriod(): PeriodDef | undefined {
    const p = this.preset;
    return p && periodAt(p, this.match.periodIndex ?? 0);
  }

  // ───────────── 时钟 ─────────────

  private startClocks(): void {
    const now = this.now();
    const m = this.match;
    if (!m.clock) return;
    if (m.clock.direction === "down" && clockNow(m.clock, now) <= 0) return; // 已归零，需先切节或校时
    const shot = m.shotClock && clockNow(m.shotClock, now) > 0 ? startClock(m.shotClock, now) : m.shotClock;
    this.store.patchMatch({ clock: startClock(m.clock, now), ...(shot ? { shotClock: shot } : {}) });
    this.schedule();
  }

  private stopClocks(): void {
    const now = this.now();
    const m = this.match;
    if (!m.clock) return;
    this.store.patchMatch({ clock: stopClock(m.clock, now), ...(m.shotClock ? { shotClock: stopClock(m.shotClock, now) } : {}) });
    this.schedule();
  }

  private updateClock(fn: (c: ClockState, now: number) => ClockState): void {
    this.requirePreset();
    const c = this.match.clock;
    if (!c) return;
    this.store.patchMatch({ clock: fn(c, this.now()) });
    this.schedule();
  }

  private resetShotClock(ms?: number): void {
    const preset = this.requirePreset("basketball");
    this.requireInternalClock();
    const m = this.match;
    const now = this.now();
    const value = ms ?? preset.shotClockMs ?? 24_000;
    // 主时钟在走，进攻时钟重置后继续走；主时钟停着则一起停着
    const running = !!m.clock?.running && value > 0;
    this.store.patchMatch({ shotClock: { ms: value, running, direction: "down", updatedAt: now } });
    this.schedule();
  }

  /** 按当前时钟重新挂归零定时器（每次时钟变化后调用） */
  private schedule(): void {
    clearTimeout(this.clockTimer);
    clearTimeout(this.shotTimer);
    if (this.externalClock) return;
    const m = this.match;
    const left = msUntilZero(m.clock, this.now());
    if (left !== undefined) this.clockTimer = setTimeout(() => this.onClockZero(), left);
    const shotLeft = msUntilZero(m.shotClock, this.now());
    if (shotLeft !== undefined) this.shotTimer = setTimeout(() => this.onShotZero(), shotLeft);
  }

  private onClockZero(): void {
    const now = this.now();
    const m = this.match;
    if (!m.clock?.running) return;
    if (clockNow(m.clock, now) > 0) return this.schedule(); // 期间被校时
    this.store.patchMatch({
      clock: { ...m.clock, ms: 0, running: false, updatedAt: now },
      ...(m.shotClock ? { shotClock: stopClock(m.shotClock, now) } : {}),
    });
    this.schedule();
    this.emit({ type: "clock.expired", periodIndex: m.periodIndex ?? 0 });
  }

  private onShotZero(): void {
    const now = this.now();
    const s = this.match.shotClock;
    if (!s?.running) return;
    if (clockNow(s, now) > 0) return this.schedule();
    this.store.patchMatch({ shotClock: { ...s, ms: 0, running: false, updatedAt: now } });
    this.schedule();
    this.emit({ type: "shotclock.expired" });
  }

  // ───────────── 足球事件 ─────────────

  /** 足球比赛分钟：0:00–0:59 是第 1 分钟；超过本节规定时间记为 45+2' */
  footballMinute(): string {
    const def = this.currentPeriod();
    const c = this.match.clock;
    if (!def || !c) return "";
    const ms = clockNow(c, this.now());
    const end = def.startMs + def.lengthMs;
    if (ms >= end) return `${end / MIN}+${Math.floor((ms - end) / MIN) + 1}'`;
    return `${Math.floor(ms / MIN) + 1}'`;
  }

  private addFootballEvent(input: Omit<FootballEvent, "id" | "minute"> & { minute?: string }): void {
    this.requirePreset("football");
    if (!input.player?.trim()) throw new Error("请填写球员");
    const event: FootballEvent = {
      id: randomUUID().slice(0, 8),
      type: input.type,
      team: input.team,
      player: input.player.trim(),
      ...(input.playerOut?.trim() ? { playerOut: input.playerOut.trim() } : {}),
      minute: input.minute?.trim() || this.footballMinute(),
    };
    const fx = this.match.extra as unknown as FootballExtra;
    const isGoal = GOAL_TYPES.has(event.type);
    const score = { home: this.match.home.score, away: this.match.away.score };
    if (isGoal) score[event.team]++;
    this.store.setMatch((m) => ({
      ...m,
      home: { ...m.home, score: score.home },
      away: { ...m.away, score: score.away },
      extra: {
        ...m.extra,
        events: [...fx.events, event],
        redCards: event.type === "red" ? { ...fx.redCards, [event.team]: fx.redCards[event.team] + 1 } : fx.redCards,
      },
    }));
    this.emit({ type: "football.event", event, score });
  }

  private undoFootballEvent(id: string): void {
    this.requirePreset("football");
    const fx = this.match.extra as unknown as FootballExtra;
    const event = fx.events.find((e) => e.id === id);
    if (!event) return;
    const isGoal = GOAL_TYPES.has(event.type);
    this.store.setMatch((m) => ({
      ...m,
      home: { ...m.home, score: Math.max(0, m.home.score - (isGoal && event.team === "home" ? 1 : 0)) },
      away: { ...m.away, score: Math.max(0, m.away.score - (isGoal && event.team === "away" ? 1 : 0)) },
      extra: {
        ...m.extra,
        events: fx.events.filter((e) => e.id !== id),
        redCards: event.type === "red" ? { ...fx.redCards, [event.team]: Math.max(0, fx.redCards[event.team] - 1) } : fx.redCards,
      },
    }));
  }

  private patchExtra<T>(patch: Partial<T>): void {
    this.store.setMatch((m) => ({ ...m, extra: { ...m.extra, ...patch } }));
  }
}
