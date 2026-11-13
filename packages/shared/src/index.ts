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
  /** 比赛主时钟 */
  clock?: ClockState;
  /** 篮球进攻时钟（24 秒） */
  shotClock?: ClockState;
  /** 当前节/半场序号（从 0 开始，传统体育使用） */
  periodIndex?: number;
  /** 节次短标签（Q1 / OT2 / 2H），比分条使用；由赛制预设生成 */
  periodShort?: string;
  /** 项目特有数据（CS2：Cs2Extra；足球：FootballExtra；篮球：BasketballExtra） */
  extra: Record<string, unknown>;
}

/** 图文层：一个图层一次只播一个模板 */
export interface GraphicLayer {
  layer: string;
  template: string;
  visible: boolean;
  data: Record<string, unknown>;
  /** 来源播出单条目（热键再次按下时据此判断是否「同一条」→ 下屏） */
  itemId?: string;
  /**
   * 每次上屏（show / take）自增；仅数据更新（update）不变。
   * 输出端据此区分「数据刷新」（只重绘）和「重新上屏」（先出场再入场）。
   */
  takeId: number;
}

/** PVW / PGM 两路输出 */
export type Channel = "pgm" | "pvw";

/** 播出单条目：预先编排好的一条图文 */
export interface RundownItem {
  id: string;
  label: string;
  layer: string;
  template: string;
  data: Record<string, unknown>;
  /** 单键热键（1-9 / a-z），按下即直接上/下 PGM */
  hotkey?: string;
}

export interface Rundown {
  items: RundownItem[];
  selectedId?: string;
}

/** 房间：一场独立的赛事（独立的比分、播出单、输出、数据接入） */
export interface RoomInfo {
  /** URL 中使用的标识：小写字母、数字、连字符 */
  id: string;
  name: string;
}

/** 房间列表上的实时摘要（GET /api/rooms） */
export interface RoomSummary extends RoomInfo {
  sport: string;
  period: string;
  home: { name: string; score: number };
  away: { name: string; score: number };
  /** PGM 上正在播出的图层数 */
  onAir: number;
  clients: { control: number; graphics: number };
  casparcg: OutputStatus["casparcg"]["status"];
  scoreboard: OutputStatus["scoreboard"]["status"];
  /** 最近一次收到 CS2 数据的时间 */
  cs2LastFrameAt?: number;
}

export interface AppState {
  room: RoomInfo;
  match: MatchState;
  /** PGM：正在播出的图层 */
  layers: Record<string, GraphicLayer>;
  /** PVW：已预备（CUE）、等待 TAKE 的图层 */
  preview: Record<string, GraphicLayer>;
  rundown: Rundown;
  config: AppConfig;
  /** 外部播出设备状态（不持久化） */
  outputs: OutputStatus;
  /** 单调递增版本号，便于客户端丢弃乱序消息 */
  rev: number;
}

type LayerData = Record<string, unknown>;

/** 客户端 → 服务端（WebSocket 与 POST /api/command 共用） */
export type ClientMessage =
  | { type: "hello"; role: "graphics" | "control"; name?: string }
  /** 直接上 PGM（规则引擎、热键使用） */
  | { type: "graphic.show"; layer: string; template: string; data?: LayerData; itemId?: string }
  /** 预备到 PVW */
  | { type: "graphic.cue"; layer: string; template: string; data?: LayerData; itemId?: string }
  /** PVW → PGM；不指定 layer 时把 PVW 上所有图层一起切出 */
  | { type: "graphic.take"; layer?: string }
  /** 刷新数据（不重新播放入场动画），默认作用于 PGM */
  | { type: "graphic.update"; layer: string; data: LayerData; channel?: Channel }
  | { type: "graphic.hide"; layer: string }
  | { type: "graphic.clearAll" }
  | { type: "preview.clear"; layer?: string }
  | { type: "rundown.upsert"; item: Omit<RundownItem, "id"> & { id?: string } }
  | { type: "rundown.remove"; id: string }
  | { type: "rundown.move"; id: string; to: number }
  | { type: "rundown.select"; id: string }
  /** 把条目（默认当前选中）预备到 PVW，并把选中项移到下一条 */
  | { type: "rundown.cue"; id?: string }
  /** 热键：条目不在 PGM 则直接上屏，已在 PGM 则下屏 */
  | { type: "rundown.fire"; id: string }
  | { type: "match.patch"; patch: DeepPartial<MatchState> }
  | { type: "config.set"; patch: DeepPartial<AppConfig> }
  /** 手动交换主客队与阵营的对应关系（自动识别失败时兜底） */
  | { type: "cs2.swapSides" }
  /** 换图/新比赛：清空已学习的阵容、回合历史、ADR 统计 */
  | { type: "cs2.reset" }
  /** 立即重连 CasparCG 并重新加载输出 */
  | { type: "casparcg.reconnect" }
  // ── 传统体育（M3） ──
  /** 按预设开始一场新比赛：比分、时钟、节次、犯规/暂停全部重置（队名保留） */
  | { type: "match.setup"; preset: SportPresetId }
  | { type: "clock.start" }
  | { type: "clock.stop" }
  | { type: "clock.toggle" }
  | { type: "clock.set"; ms: number }
  | { type: "clock.adjust"; deltaMs: number }
  /** 切换节次；时钟按该节的起始值重置并停止 */
  | { type: "period.set"; index: number }
  | { type: "period.next" }
  | { type: "period.prev" }
  /** 进攻时钟重置（默认 24 秒；进攻篮板等情况传 14 秒） */
  | { type: "shotclock.reset"; ms?: number }
  /** 足球：补时分钟数（第四官员举牌） */
  | { type: "football.addedTime"; minutes: number }
  /** 足球事件；minute 不传时按当前时钟计算 */
  | { type: "football.event"; event: Omit<FootballEvent, "id" | "minute"> & { minute?: string } }
  /** 撤销一条足球事件（进球会同时减去比分） */
  | { type: "football.undo"; id: string }
  | { type: "basketball.foul"; team: TeamKey; delta: number }
  | { type: "basketball.timeout"; team: TeamKey; delta: number }
  | { type: "basketball.possession"; team?: TeamKey };

/** 服务端 → 客户端 */
export type ServerMessage =
  | { type: "state"; state: AppState }
  | { type: "event"; event: GameEvent }
  | { type: "error"; message: string };

/** CasparCG 上的一路 HTML 输出 */
export interface CasparOutput {
  id: string;
  label: string;
  channel: number;
  layer: number;
  source: Channel;
  enabled: boolean;
}

export interface CasparConfig {
  enabled: boolean;
  host: string;
  /** AMCP 端口，默认 5250 */
  port: number;
  /** CasparCG 访问 LiveCG 的地址（CasparCG 在另一台机器时不能用 localhost） */
  baseUrl: string;
  outputs: CasparOutput[];
}

export interface OutputStatus {
  scoreboard: {
    status: "disabled" | "listening" | "receiving" | "stale" | "error";
    message?: string;
    /** 最近一次收到计分器数据的服务器时间 */
    lastAt?: number;
  };
  casparcg: {
    status: "disabled" | "connecting" | "connected" | "error";
    message?: string;
    version?: string;
    /** 已在 CasparCG 上加载的输出 id */
    loaded: string[];
  };
}

/** 运行时配置（控制台可改，持久化到磁盘） */
export interface AppConfig {
  /** CS2 数据延迟（毫秒），与视频播出延迟对齐 */
  cs2DelayMs: number;
  automation: {
    /** 回合结束自动弹出回合结算 */
    roundSummary: boolean;
    /** 回合结算停留时长（毫秒） */
    roundSummaryMs: number;
    /** 足球事件（进球/红黄牌/换人）自动上屏 */
    matchEvents: boolean;
    matchEventMs: number;
  };
  casparcg: CasparConfig;
  scoreboard: ScoreboardConfig;
}

/** 模板元数据：控制台据此生成播出单编辑表单，输出端据此决定叠放顺序 */
export interface TemplateMeta {
  label: string;
  /** 默认图层名 */
  layer: string;
  /** 叠放顺序，越大越靠上 */
  z: number;
  fields?: Array<{ key: string; label: string; type: "text" | "textarea" | "number"; placeholder?: string }>;
}

// ───────────────────────── 传统体育 ─────────────────────────

export type SportPresetId = "football" | "basketball-fiba" | "basketball-nba";

export interface PeriodDef {
  label: string;
  /** 比分条上的短标签，如 1H / Q3 / OT */
  short: string;
  /** 本节开始时时钟的显示值：足球下半场从 45:00 开始正计时；篮球每节从 10:00 倒计时 */
  startMs: number;
  /** 本节规定时长（足球据此计算补时分钟，如 45+2'） */
  lengthMs: number;
  direction: "up" | "down";
  /** 进入本节时把双方剩余暂停重置为该值（FIBA 下半场 3 次） */
  resetTimeouts?: number;
  /** 进入本节时是否清零全队犯规 */
  resetFouls?: boolean;
}

export interface SportPreset {
  id: SportPresetId;
  label: string;
  sport: "football" | "basketball";
  periods: PeriodDef[];
  /** 超出 periods 后「下一节」重复使用的节次（篮球多个加时） */
  repeatLast?: boolean;
  shotClockMs?: number;
  /** 全队犯规达到此数后，再犯规即罚球（FIBA / NBA 均为 4） */
  penaltyFouls?: number;
}

export interface FootballEvent {
  id: string;
  type: "goal" | "ownGoal" | "penaltyGoal" | "yellow" | "red" | "sub";
  team: TeamKey;
  player: string;
  /** 换人：被换下的球员 */
  playerOut?: string;
  /** 显示用分钟，如 23' 或 45+2' */
  minute: string;
}

export interface FootballExtra {
  preset: SportPresetId;
  /** 本节补时分钟数，0 表示未公布 */
  addedTime: number;
  events: FootballEvent[];
  redCards: Record<TeamKey, number>;
}

export interface BasketballExtra {
  preset: SportPresetId;
  fouls: Record<TeamKey, number>;
  timeouts: Record<TeamKey, number>;
  possession?: TeamKey;
  penaltyFouls: number;
  /** 本赛制单节最多可用暂停数（比分条据此画暂停格数：FIBA 3、NBA 7） */
  timeoutsMax: number;
}

/** 外部计分器（UDP 输入） */
export interface ScoreboardConfig {
  enabled: boolean;
  /** UDP 监听端口 */
  port: number;
  /** 时钟来源：internal = LiveCG 内部时钟；scoreboard = 跟随计分器 */
  clockSource: "internal" | "scoreboard";
  /** 超过此毫秒数没收到数据即告警 */
  staleMs: number;
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
  | { type: "cs2.matchEnd"; winner?: TeamKey }
  | { type: "clock.expired"; periodIndex: number }
  | { type: "shotclock.expired" }
  | { type: "period.start"; periodIndex: number; label: string }
  | { type: "football.event"; event: FootballEvent; score: Record<TeamKey, number> };

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
