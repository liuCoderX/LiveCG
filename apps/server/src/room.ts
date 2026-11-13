import type { ClientMessage, GameEvent } from "@livecg/shared";
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

  constructor(
    readonly id: string,
    private file: string | undefined,
    seed: StoreSeed,
    options: { outputToken?: string } = {},
  ) {
    this.store = new Store({ ...seed, room: { id, name: seed.room?.name ?? id } });
    const s = this.store;
    this.cs2 = new Cs2Adapter(() => ({ home: s.get().match.home.name, away: s.get().match.away.name }));
    this.cs2Delay = new DelayQueue(() => s.get().config.cs2DelayMs);
    this.rules = createRules(s);
    this.caspar = new CasparClient(s, { outputToken: options.outputToken });
    this.sports = new SportsController(s, (e) => this.emit(e));
    this.scoreboard = new ScoreboardInput(s, (i) => (this.sports.preset ? periodAt(this.sports.preset, i) : undefined));
  }

  start(): void {
    if (this.file) this.stopPersist = persistTo(this.store, this.file);
    this.caspar.start();
    this.scoreboard.start();
  }

  /** 停止所有后台服务（CasparCG 连接、UDP 监听、定时器），并把未写盘的改动写盘 */
  stop(): void {
    this.stopPersist?.();
    this.stopPersist = undefined;
    this.caspar.stop();
    this.scoreboard.stop();
    this.sports.dispose();
    this.cs2Delay.clear();
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
