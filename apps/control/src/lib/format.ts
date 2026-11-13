// 时间格式化与输出页共用同一份实现（apps/graphics/lib/util.js），构建时打包进控制台
export { fmtGameClock, fmtMatchClock, fmtShotClock } from "../../../graphics/lib/util.js";

/** "mm:ss" / "mm:ss.t" / "ss.t" → 毫秒；格式不对返回 undefined */
export function parseClockInput(text: string): number | undefined {
  const m = /^\s*(?:(\d{1,3}):)?(\d{1,2}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const sec = Number(m[2]);
  if (m[1] && sec >= 60) return undefined;
  return Math.round(((m[1] ? Number(m[1]) : 0) * 60 + sec) * 1000);
}

export const ageText = (at: number | undefined) => (at ? `${Math.max(0, (Date.now() - at) / 1000).toFixed(0)} 秒前` : "—");
