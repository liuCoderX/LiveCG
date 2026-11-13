/**
 * LiveCG 共享协议：服务端、控制台、图文模板三方共用的数据模型与消息格式。
 * 原则：数据（MatchState）与呈现（GraphicLayer）分离；模板只订阅状态，不直接接数据源。
 */

/** 通用赛事模型：电竞与传统体育共用，项目特有字段放在 extra 中 */
export interface TeamState {
  id: string;
  name: string;
  shortName: string;
  logo?: string;
  color?: string;
  score: number;
  /** 例如 CS2 的阵营（CT/T）、足球的主客队 */
  side?: string;
}

export interface ClockState {
  /** 比赛时钟剩余/已用毫秒 */
  ms: number;
  running: boolean;
  direction: "up" | "down";
  /** 服务端记录时钟状态的时间戳，客户端据此本地插值，避免高频推送 */
  updatedAt: number;
}

export interface MatchState {
  sport: "cs2" | "football" | "basketball" | "generic" | string;
  title: string;
  /** 局/节/半场，例如 "R12"、"Q3"、"下半场" */
  period: string;
  home: TeamState;
  away: TeamState;
  clock?: ClockState;
  /** 项目特有数据（CS2：经济、炸弹状态、选手血量等） */
  extra: Record<string, unknown>;
}

/** 图文层：一个图层一次只播一个模板 */
export interface GraphicLayer {
  layer: string;
  template: string;
  visible: boolean;
  data: Record<string, unknown>;
}

export interface AppState {
  match: MatchState;
  layers: Record<string, GraphicLayer>;
  config: AppConfig;
  /** 单调递增版本号，便于客户端丢弃乱序消息 */
  rev: number;
}

/** 客户端 → 服务端 */
export type ClientMessage =
  | { type: "hello"; role: "graphics" | "control"; name?: string }
  | { type: "graphic.show"; layer: string; template: string; data?: Record<string, unknown> }
  | { type: "graphic.update"; layer: string; data: Record<string, unknown> }
  | { type: "graphic.hide"; layer: string }
  | { type: "graphic.clearAll" }
  | { type: "match.patch"; patch: DeepPartial<MatchState> }
  | { type: "config.set"; patch: DeepPartial<AppConfig> }
  /** 手动交换主客队与阵营的对应关系（自动识别失败时兜底） */
  | { type: "cs2.swapSides" }
  /** 换图/新比赛：清空已学习的阵容、回合历史、ADR 统计 */
  | { type: "cs2.reset" };

/** 服务端 → 客户端 */
export type ServerMessage =
  | { type: "state"; state: AppState }
  | { type: "event"; event: GameEvent }
  | { type: "error"; message: string };

/** 运行时配置（控制台可改） */
export interface AppConfig {
  /** CS2 数据延迟（毫秒），与视频播出延迟对齐 */
  cs2DelayMs: number;
  automation: {
    /** 回合结束自动弹出回合结算 */
    roundSummary: boolean;
    /** 回合结算停留时长（毫秒） */
    roundSummaryMs: number;
  };
}

// ───────────────────────── CS2 ─────────────────────────

export type TeamKey = "home" | "away";
export type Cs2Side = "CT" | "T";

export interface Cs2Player {
  steamid: string;
  name: string;
  team: TeamKey;
  side: Cs2Side;
  /** 观察者槽位（0-9），对应 OB 切换键位 */
  slot?: number;
  hp: number;
  armor: number;
  helmet: boolean;
  defuser: boolean;
  money: number;
  equipValue: number;
  kills: number;
  deaths: number;
  assists: number;
  /** 本回合击杀 / 伤害 */
  roundKills: number;
  roundDmg: number;
  /** 已观测回合的平均每回合伤害 */
  adr: number;
  alive: boolean;
  /** 当前主武器名（去掉 weapon_ 前缀） */
  weapon?: string;
  hasBomb: boolean;
}

export interface Cs2TeamEconomy {
  money: number;
  equipValue: number;
  alive: number;
  /** 连败局数（决定败局补偿） */
  lossStreak: number;
}

export type Cs2RoundReason = "elimination" | "bomb" | "defuse" | "time" | "unknown";

export interface Cs2RoundResult {
  round: number;
  winner: TeamKey;
  winnerSide: Cs2Side;
  reason: Cs2RoundReason;
  /** 回合结束时的比分 */
  score: { home: number; away: number };
  /** 本回合最佳选手（击杀优先，其次伤害） */
  mvp?: { steamid: string; name: string; team: TeamKey; kills: number; dmg: number };
  teams: Record<TeamKey, { kills: number; dmg: number }>;
}

export interface Cs2Kill {
  id: string;
  killer?: { name: string; team: TeamKey; side: Cs2Side };
  victim: { name: string; team: TeamKey; side: Cs2Side };
  weapon?: string;
  headshot: boolean;
}

export interface Cs2Extra {
  mapName: string;
  mapPhase: string;
  roundPhase: string;
  /** 当前回合号（从 1 开始） */
  round: number;
  bomb: "none" | "carried" | "planted" | "defused" | "exploded" | "dropped" | string;
  /** 当前队伍阵营 */
  sides: Record<TeamKey, Cs2Side>;
  observed?: string;
  players: Cs2Player[];
  economy: Record<TeamKey, Cs2TeamEconomy>;
  /** 最近若干条击杀 */
  killfeed: Cs2Kill[];
  lastRound?: Cs2RoundResult;
  roundHistory: Array<Pick<Cs2RoundResult, "round" | "winner" | "winnerSide" | "reason">>;
  /** 最近一次收到 GSI 数据的服务器时间 */
  lastFrameAt: number;
}

/** 由状态差分推导出的离散事件，供规则引擎与模板做一次性动画 */
export type GameEvent =
  | { type: "cs2.kill"; kill: Cs2Kill }
  | { type: "cs2.roundStart"; round: number }
  | { type: "cs2.roundEnd"; result: Cs2RoundResult }
  | { type: "cs2.bombPlanted"; by?: string }
  | { type: "cs2.bombDefused"; by?: string }
  | { type: "cs2.bombExploded" }
  | { type: "cs2.clutch"; player: string; team: TeamKey; vs: number }
  | { type: "cs2.halftime" }
  | { type: "cs2.matchEnd"; winner?: TeamKey };

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
