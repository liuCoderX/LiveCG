import type { AppState, ClientMessage, Cs2Extra, GameEvent } from "@livecg/shared";
import { Store, type StoreSeed } from "./store.ts";
import { Cs2Adapter, type IngestResult } from "./adapters/cs2-gsi.ts";
import { DelayQueue } from "./delay-queue.ts";
import { createRules } from "./rules.ts";
import { persistTo } from "./persist.ts";
import { CasparClient } from "./casparcg.ts";
import { isSportsMessage, SportsController } from "./sports/controller.ts";
import { ScoreboardInput } from "./sports/scoreboard.ts";
import { periodAt } from "./sports/presets.ts";

/**
 * 一个房间 = 一场独立的赛事：独立的状态、播出单、PVW/PGM、CS2 接入、计分器、CasparCG 连接和数据文件。
 * 房间之间不共享任何可变状态。
 */
export class Room {
  readonly store: Store;
  private cs2: Cs2Adapter;
  private cs2Delay: DelayQueue;
  private rules: ReturnType<typeof createRules>;
  private caspar: CasparClient;
  private sports: SportsController;
  private scoreboard: ScoreboardInput;
  private stopPersist?: () => void;
  private eventListeners = new Set<(e: GameEvent) => void>();
  /**
   * 主机（active）：运行全部服务。备机（standby）：只镜像主机推来的状态并落盘，
   * 不连 CasparCG、不监听计分器、不计时、不处理 CS2 数据。
   */
  private active = false;

  constructor(
    readonly id: string,
    private file: string | undefined,
    seed: StoreSeed,
    options: { outputToken?: string; failoverUrl?: string | (() => string | undefined) } = {},
  ) {
    this.store = new Store({ ...seed, room: { id, name: seed.room?.name ?? id } });
    const s = this.store;
    this.cs2 = new Cs2Adapter(() => ({ home: s.get().match.home.name, away: s.get().match.away.name }));
    this.cs2Delay = new DelayQueue(() => s.get().config.cs2DelayMs);
    this.rules = createRules(s);
    this.caspar = new CasparClient(s, { outputToken: options.outputToken, failoverUrl: options.failoverUrl });
    this.sports = new SportsController(s, (e) => this.emit(e));
    this.sports.suspend();
    this.scoreboard = new ScoreboardInput(s, (i) => (this.sports.preset ? periodAt(this.sports.preset, i) : undefined));
  }

  /** 单机：落盘 + 启动全部服务 */
  start(): void {
    this.startPersistence();
    this.setActive(true);
  }

  startPersistence(): void {
    if (this.file && !this.stopPersist) this.stopPersist = persistTo(this.store, this.file);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 主备切换：启动 / 停止设备连接与定时器 */
  setActive(active: boolean, opts: { adopt?: boolean } = {}): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      const m = this.store.get().match;
      if (m.sport === "cs2") this.cs2.restore(m.extra as unknown as Partial<Cs2Extra>);
      this.sports.resume();
      this.caspar.start({ adopt: opts.adopt });
      this.scoreboard.start();
    } else {
      this.caspar.stop();
      this.scoreboard.stop();
      this.sports.suspend();
      this.cs2Delay.clear();
    }
  }

  /** 备机：用主机推来的完整状态替换本地状态 */
  mirror(state: AppState): void {
    this.store.replaceState({ ...state, room: { id: this.id, name: state.room.name } });
  }

  /** 停止所有后台服务（CasparCG 连接、UDP 监听、定时器），并把未写盘的改动写盘 */
  stop(): void {
    this.setActive(false);
    this.stopPersist?.();
    this.stopPersist = undefined;
    this.sports.dispose();
  }

  onEvent(fn: (e: GameEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** 数据源推导出的事件：先给规则引擎，再通知订阅者（WebSocket 广播） */
  private emit(event: GameEvent): void {
    this.rules(event);
    for (const fn of this.eventListeners) fn(event);
  }

  private applyIngest(result: IngestResult | null): void {
    if (!result) return;
    this.store.patchMatch(result.patch);
    for (const event of result.events) this.emit(event);
  }

  /** CS2 GSI 帧：先进延迟缓冲再解析，保证事件与状态同步延迟 */
  ingestCs2(payload: unknown): void {
    // 备机不处理：CS2 可以同时把数据发给主备两台（两个 cfg 文件），以主机为准
    if (!this.active) return;
    this.cs2Delay.push(() => this.applyIngest(this.cs2.ingest(payload)));
  }

  /** 本房间所有控制指令的唯一入口 */
  handleCommand(msg: ClientMessage): void {
    switch (msg.type) {
      case "hello":
        return;
      case "cs2.swapSides":
        return this.applyIngest(this.cs2.swapSides());
      case "cs2.reset":
        this.cs2Delay.clear();
        this.cs2.reset();
        return this.store.patchMatch({ home: { score: 0 }, away: { score: 0 }, extra: { killfeed: [], roundHistory: [], lastRound: undefined } });
      case "casparcg.reconnect":
        return this.caspar.reconnect();
      default:
        if (isSportsMessage(msg)) return this.sports.handle(msg);
        return this.store.dispatch(msg);
    }
  }
}
