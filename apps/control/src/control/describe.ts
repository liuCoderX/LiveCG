import type { AppState, GameEvent, TeamKey } from "@livecg/shared";

const REASON: Record<string, string> = { elimination: "全歼", bomb: "爆炸", defuse: "拆包", time: "超时", unknown: "" };
const FOOTBALL: Record<string, string> = { goal: "进球", penaltyGoal: "点球", ownGoal: "乌龙", yellow: "黄牌", red: "红牌", sub: "换人" };

/** 事件日志的一行中文描述；不认识的事件返回 null（不记录） */
export function describeEvent(e: GameEvent, state: AppState | undefined): string | null {
  const team = (k: TeamKey) => state?.match[k]?.shortName || k;
  switch (e.type) {
    case "cs2.kill": return `${e.kill.killer?.name ?? "☠"} → ${e.kill.victim.name}${e.kill.headshot ? "（爆头）" : ""}`;
    case "cs2.roundStart": return `第 ${e.round} 回合开始`;
    case "cs2.roundEnd": return `${team(e.result.winner)} 赢下第 ${e.result.round} 回合（${REASON[e.result.reason]}）${e.result.score.home}:${e.result.score.away}`;
    case "cs2.bombPlanted": return "炸弹已安放";
    case "cs2.bombDefused": return "炸弹已拆除";
    case "cs2.bombExploded": return "炸弹爆炸";
    case "cs2.clutch": return `残局 1v${e.vs}：${e.player}（${team(e.team)}）`;
    case "cs2.halftime": return "半场换边";
    case "cs2.matchEnd": return `比赛结束${e.winner ? `，${team(e.winner)} 获胜` : ""}`;
    case "football.event": return `${e.event.minute} ${FOOTBALL[e.event.type] ?? e.event.type} · ${team(e.event.team)} ${e.event.player}`;
    case "period.start": return `${e.label}`;
    case "clock.expired": return "比赛时钟归零";
    case "shotclock.expired": return "进攻时钟归零";
    default: return null;
  }
}

export const FOOTBALL_LABEL = FOOTBALL;
