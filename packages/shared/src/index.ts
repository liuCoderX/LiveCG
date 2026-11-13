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
  | { type: "match.patch"; patch: DeepPartial<MatchState> };

/** 服务端 → 客户端 */
export type ServerMessage =
  | { type: "state"; state: AppState }
  | { type: "error"; message: string };

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
