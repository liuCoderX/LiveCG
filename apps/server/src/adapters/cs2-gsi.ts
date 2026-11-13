import type { DeepPartial, MatchState } from "@livecg/shared";

/**
 * CS2 Game State Integration 适配器。
 * 游戏客户端（建议用 OB/观察者机位）按 cfg 配置把 JSON POST 到 /gsi/cs2。
 * 这里只做「原始数据 → 通用 MatchState」的映射，不关心任何图文呈现。
 */
export function mapCs2Payload(p: any): DeepPartial<MatchState> | null {
  if (!p?.map) return null;
  const ct = p.map.team_ct ?? {};
  const t = p.map.team_t ?? {};

  const players = p.allplayers
    ? Object.entries(p.allplayers).map(([steamid, pl]: [string, any]) => ({
        steamid,
        name: pl.name,
        team: pl.team,
        health: pl.state?.health,
        armor: pl.state?.armor,
        money: pl.state?.money,
        kills: pl.match_stats?.kills,
        deaths: pl.match_stats?.deaths,
        adr: undefined,
      }))
    : undefined;

  return {
    sport: "cs2",
    period: `R${(p.map.round ?? 0) + 1}`,
    home: { score: ct.score ?? 0, side: "CT", ...(ct.name ? { name: ct.name } : {}) },
    away: { score: t.score ?? 0, side: "T", ...(t.name ? { name: t.name } : {}) },
    extra: {
      mapName: p.map.name,
      mapPhase: p.map.phase,
      roundPhase: p.round?.phase,
      bomb: p.round?.bomb ?? p.bomb?.state,
      observedPlayer: p.player?.name,
      ...(players ? { players } : {}),
    },
  };
}
