import type { ClockState } from "@livecg/shared";

/**
 * 时钟是「锚点」表示：ms 是 updatedAt 时刻的读数，running 时各端按本地时间插值。
 * 这样运行中的时钟不需要每 100ms 推送一次，启停/校时才产生一次状态变化。
 */
export const clockNow = (c: ClockState, now = Date.now()): number => {
  if (!c.running) return c.ms;
  const d = now - c.updatedAt;
  return c.direction === "down" ? Math.max(0, c.ms - d) : c.ms + d;
};

export const startClock = (c: ClockState, now = Date.now()): ClockState =>
  c.running ? c : { ...c, running: true, updatedAt: now };

export const stopClock = (c: ClockState, now = Date.now()): ClockState =>
  ({ ...c, ms: clockNow(c, now), running: false, updatedAt: now });

export const setClock = (c: ClockState, ms: number, now = Date.now()): ClockState =>
  ({ ...c, ms: Math.max(0, Math.round(ms)), updatedAt: now });

export const adjustClock = (c: ClockState, deltaMs: number, now = Date.now()): ClockState =>
  setClock(c, clockNow(c, now) + deltaMs, now);

/** 倒计时距离归零还有多久；不在倒计时则为 undefined */
export const msUntilZero = (c: ClockState | undefined, now = Date.now()): number | undefined =>
  c?.running && c.direction === "down" ? clockNow(c, now) : undefined;

/** 解析 "mm:ss"、"mm:ss.t"、"ss.t"、"ss" 为毫秒 */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(?:(\d{1,3}):)?(\d{1,2}(?:\.\d+)?)\s*$/.exec(String(text));
  if (!m) return undefined;
  const min = m[1] ? Number(m[1]) : 0;
  const sec = Number(m[2]);
  if (m[1] && sec >= 60) return undefined;
  return Math.round((min * 60 + sec) * 1000);
}
