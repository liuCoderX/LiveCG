import type { PeriodDef, SportPreset, SportPresetId } from "@livecg/shared";

const MIN = 60_000;

/**
 * 赛制预设。只覆盖转播图文需要的规则（节次、时钟、犯规/暂停计数），不做裁判逻辑。
 * 规则细节以赛事方实际规程为准，操作员可随时手动修正时钟/犯规/暂停。
 */
export const PRESETS: Record<SportPresetId, SportPreset> = {
  football: {
    id: "football",
    label: "足球（90 分钟 + 加时）",
    sport: "football",
    periods: [
      { label: "上半场", short: "1H", startMs: 0, lengthMs: 45 * MIN, direction: "up" },
      { label: "下半场", short: "2H", startMs: 45 * MIN, lengthMs: 45 * MIN, direction: "up" },
      { label: "加时上半场", short: "ET1", startMs: 90 * MIN, lengthMs: 15 * MIN, direction: "up" },
      { label: "加时下半场", short: "ET2", startMs: 105 * MIN, lengthMs: 15 * MIN, direction: "up" },
    ],
  },
  "basketball-fiba": {
    id: "basketball-fiba",
    label: "篮球 FIBA（4×10 分钟）",
    sport: "basketball",
    shotClockMs: 24_000,
    penaltyFouls: 4,
    repeatLast: true,
    periods: [
      // FIBA：上半场 2 次暂停，下半场 3 次，每个加时 1 次；全队犯规每节清零，加时延续第四节
      { label: "第一节", short: "Q1", startMs: 10 * MIN, lengthMs: 10 * MIN, direction: "down", resetTimeouts: 2, resetFouls: true },
      { label: "第二节", short: "Q2", startMs: 10 * MIN, lengthMs: 10 * MIN, direction: "down", resetFouls: true },
      { label: "第三节", short: "Q3", startMs: 10 * MIN, lengthMs: 10 * MIN, direction: "down", resetTimeouts: 3, resetFouls: true },
      { label: "第四节", short: "Q4", startMs: 10 * MIN, lengthMs: 10 * MIN, direction: "down", resetFouls: true },
      { label: "加时", short: "OT", startMs: 5 * MIN, lengthMs: 5 * MIN, direction: "down", resetTimeouts: 1 },
    ],
  },
  "basketball-nba": {
    id: "basketball-nba",
    label: "篮球 NBA（4×12 分钟）",
    sport: "basketball",
    shotClockMs: 24_000,
    penaltyFouls: 4,
    repeatLast: true,
    periods: [
      { label: "第一节", short: "Q1", startMs: 12 * MIN, lengthMs: 12 * MIN, direction: "down", resetTimeouts: 7, resetFouls: true },
      { label: "第二节", short: "Q2", startMs: 12 * MIN, lengthMs: 12 * MIN, direction: "down", resetFouls: true },
      { label: "第三节", short: "Q3", startMs: 12 * MIN, lengthMs: 12 * MIN, direction: "down", resetFouls: true },
      { label: "第四节", short: "Q4", startMs: 12 * MIN, lengthMs: 12 * MIN, direction: "down", resetFouls: true },
      { label: "加时", short: "OT", startMs: 5 * MIN, lengthMs: 5 * MIN, direction: "down", resetTimeouts: 2, resetFouls: true },
    ],
  },
};

/** 取第 i 节；超出定义且允许重复时生成「加时 2 / OT2」 */
export function periodAt(preset: SportPreset, i: number): PeriodDef | undefined {
  const defs = preset.periods;
  if (i < 0) return undefined;
  if (i < defs.length) return defs[i];
  if (!preset.repeatLast) return undefined;
  const last = defs[defs.length - 1];
  const n = i - defs.length + 2;
  return { ...last, label: `${last.label} ${n}`, short: `${last.short}${n}` };
}
