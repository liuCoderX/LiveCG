import type {
  ClockState,
  Cs2Extra,
  Cs2Kill,
  Cs2Player,
  Cs2RoundReason,
  Cs2RoundResult,
  Cs2Side,
  Cs2TeamEconomy,
  DeepPartial,
  GameEvent,
  MatchState,
  TeamKey,
} from "@livecg/shared";

/**
 * CS2 Game State Integration 适配器（有状态）。
 *
 * GSI 只推送「当前状态快照」，不推送事件；本类负责：
 *  1. 队伍 ↔ 阵营映射（半场换边后比分条不跳位）
 *  2. 前后帧差分推导事件：击杀、回合开始/结束、炸弹、残局、半场、终局
 *  3. 汇总经济、回合结算、ADR、击杀信息、回合历史
 *
 * 输出通用的 MatchState patch + GameEvent 列表，不关心任何图文呈现。
 */

export interface IngestResult {
  patch: DeepPartial<MatchState>;
  events: GameEvent[];
}

/** 内部选手结构：额外保留差分所需字段，输出前去掉 */
type RawPlayer = Cs2Player & { killHs: number; activeWeapon?: string };

interface Frame {
  mapPhase: string;
  roundPhase: string;
  bomb: string;
  round: number;
  players: Map<string, RawPlayer>;
}

const KILLFEED_SIZE = 6;
const HISTORY_SIZE = 30;
const other = (t: TeamKey): TeamKey => (t === "home" ? "away" : "home");
const PRIMARY_TYPES = new Set(["Rifle", "SniperRifle", "Submachine Gun", "Shotgun", "Machine Gun"]);

export class Cs2Adapter {
  /** 已学习的阵容：steamid → 队伍。选手不会换队，所以这是最可靠的换边依据 */
  private roster = new Map<string, TeamKey>();
  /** 当前 CT 方是哪支队伍 */
  private ctTeam: TeamKey = "home";
  private prev?: Frame;
  private prevScore?: Record<TeamKey, number>;
  private lastRaw?: unknown;
  private killfeed: Cs2Kill[] = [];
  private history: Cs2Extra["roundHistory"] = [];
  private lastRound?: Cs2RoundResult;
  private dmg = new Map<string, { total: number; rounds: number }>();
  private clutchRound = -1;
  private killSeq = 0;

  constructor(private teamNames: () => Record<TeamKey, string> = () => ({ home: "", away: "" })) {}

  /** 操作员手动重置：连同阵容一起清空 */
  reset(): void {
    this.roster.clear();
    this.ctTeam = "home";
    this.manualLock = false;
    this.resetMap();
  }

  /** 单图数据清空（换图时自动调用） */
  private resetMap(): void {
    this.prev = undefined;
    this.prevScore = undefined;
    this.lastRaw = undefined;
    this.killfeed = [];
    this.history = [];
    this.lastRound = undefined;
    this.dmg.clear();
    this.clutchRound = -1;
  }

  /** 手动交换（自动识别出错时兜底），返回用最后一帧重新计算的 patch */
  swapSides(): IngestResult | null {
    this.ctTeam = other(this.ctTeam);
    for (const [id, t] of this.roster) this.roster.set(id, other(t));
    if (this.prevScore) this.prevScore = { home: this.prevScore.away, away: this.prevScore.home };
    if (this.prev) for (const pl of this.prev.players.values()) pl.team = other(pl.team);
    this.manualLock = true;
    if (!this.lastRaw) return null;
    const r = this.ingest(this.lastRaw);
    return r && { patch: r.patch, events: [] };
  }
  /** 手动交换后，在没有阵容数据时不再用队名推断覆盖操作员的选择（比分连续性仍生效，可识别半场换边） */
  private manualLock = false;

  ingest(p: any, now = Date.now()): IngestResult | null {
    if (!p?.map) return null;
    // 换图或新比赛（回合数倒退）：自动清空单图数据，避免上一张图的回合历史/ADR 串进来。
    // 阵容保留——BO3 下一张图主客队不变，正好用来继续识别阵营。
    const lastMap = this.lastRaw ? (this.lastRaw as any).map : undefined;
    if (lastMap && (lastMap.name !== p.map.name || (p.map.round ?? 0) < (lastMap.round ?? 0))) this.resetMap();
    this.lastRaw = p;
    const ct = p.map.team_ct ?? {};
    const t = p.map.team_t ?? {};
    const mapPhase: string = p.map.phase ?? "";
    const roundPhase: string = p.round?.phase ?? "";

    this.resolveSides(p, ct, t);
    const sideOf = (team: TeamKey): Cs2Side => (team === this.ctTeam ? "CT" : "T");
    const teamOf = (side: Cs2Side): TeamKey => (side === "CT" ? this.ctTeam : other(this.ctTeam));
    const score = { [teamOf("CT")]: ct.score ?? 0, [teamOf("T")]: t.score ?? 0 } as Record<TeamKey, number>;

    // 回合号：round_wins 中已出现当前回合结果，说明 map.round 尚未自增
    const mapRound: number = p.map.round ?? 0;
    const wins: Record<string, string> = p.map.round_wins ?? {};
    const completedRound = wins[String(mapRound + 1)] ? mapRound + 1 : mapRound;
    const round = roundPhase === "over" ? Math.max(1, completedRound) : mapRound + 1;

    const players = this.parsePlayers(p, teamOf);
    const bomb: string = p.bomb?.state ?? p.round?.bomb ?? "none";
    const frame: Frame = { mapPhase, roundPhase, bomb, round, players };
    const events = this.prev ? this.diff(this.prev, frame, p, completedRound, score) : [];
    this.prev = frame;
    this.prevScore = score;

    const list = [...players.values()].map(({ killHs: _k, activeWeapon: _w, ...pl }) => {
      const d = this.dmg.get(pl.steamid);
      return { ...pl, adr: d && d.rounds ? Math.round(d.total / d.rounds) : 0 };
    });
    list.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));

    const economy = (team: TeamKey): Cs2TeamEconomy => {
      const mine = list.filter((pl) => pl.team === team);
      const raw = sideOf(team) === "CT" ? ct : t;
      return {
        money: mine.reduce((s, pl) => s + pl.money, 0),
        equipValue: mine.reduce((s, pl) => s + pl.equipValue, 0),
        alive: mine.filter((pl) => pl.alive).length,
        lossStreak: raw.consecutive_round_losses ?? 0,
      };
    };

    const extra: Cs2Extra = {
      mapName: p.map.name ?? "",
      mapPhase,
      roundPhase,
      round,
      bomb,
      sides: { home: sideOf("home"), away: sideOf("away") },
      observed: p.player?.steamid,
      players: list,
      economy: { home: economy("home"), away: economy("away") },
      killfeed: this.killfeed,
      lastRound: this.lastRound,
      roundHistory: this.history,
      lastFrameAt: now,
    };

    const ends = parseFloat(p.phase_countdowns?.phase_ends_in);
    const clock: ClockState | undefined = Number.isFinite(ends)
      ? { ms: Math.max(0, Math.round(ends * 1000)), running: true, direction: "down", updatedAt: now }
      : undefined;

    return {
      patch: {
        sport: "cs2",
        period: `R${round}`,
        home: { score: score.home, side: sideOf("home") },
        away: { score: score.away, side: sideOf("away") },
        ...(clock ? { clock } : {}),
        extra: extra as unknown as Record<string, unknown>,
      },
      events,
    };
  }

  // ───────────── 阵营映射 ─────────────

  private resolveSides(p: any, ct: any, t: any): void {
    const all: Record<string, any> = p.allplayers ?? {};
    const sideOfPlayer = Object.entries(all)
      .filter(([, pl]) => pl.team === "CT" || pl.team === "T")
      .map(([id, pl]) => [id, pl.team as Cs2Side] as const);

    // 1) 阵容投票
    let keep = 0;
    let swap = 0;
    for (const [id, side] of sideOfPlayer) {
      const team = this.roster.get(id);
      if (!team) continue;
      const ctNow = side === "CT" ? team : other(team);
      ctNow === this.ctTeam ? keep++ : swap++;
    }
    if (keep + swap > 0) {
      if (swap > keep) this.ctTeam = other(this.ctTeam);
      this.manualLock = false;
    } else {
      // 2) 队名匹配（赛事服务器设置了 mp_teamname_1/2 时可靠）
      const names = this.teamNames();
      const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
      const byName = this.manualLock
        ? undefined
        : ct.name && norm(ct.name) === norm(names.home) ? "home"
        : ct.name && norm(ct.name) === norm(names.away) ? "away"
        : t.name && norm(t.name) === norm(names.home) ? "away"
        : t.name && norm(t.name) === norm(names.away) ? "home"
        : undefined;
      if (byName) this.ctTeam = byName;
      // 3) 半场/加时换边：map.phase 离开 intermission 说明双方已换边（比分打平时只能靠它）
      else if (this.prev?.mapPhase === "intermission" && p.map.phase !== "intermission") this.ctTeam = other(this.ctTeam);
      // 4) 比分连续性：漏掉 intermission 帧时的兜底
      else if (this.prevScore) {
        const c = ct.score ?? 0;
        const tt = t.score ?? 0;
        const asIs = this.ctTeam === "home" ? [c, tt] : [tt, c];
        const fits = (h: number, a: number) => h >= this.prevScore!.home && a >= this.prevScore!.away && h + a - this.prevScore!.home - this.prevScore!.away <= 1;
        if (!fits(asIs[0], asIs[1]) && fits(asIs[1], asIs[0])) this.ctTeam = other(this.ctTeam);
      }
    }

    // 学习新出现的选手
    for (const [id, side] of sideOfPlayer) {
      if (!this.roster.has(id)) this.roster.set(id, side === "CT" ? this.ctTeam : other(this.ctTeam));
    }
  }

  // ───────────── 选手解析 ─────────────

  private parsePlayers(p: any, teamOf: (s: Cs2Side) => TeamKey): Frame["players"] {
    const out: Frame["players"] = new Map();
    for (const [steamid, pl] of Object.entries<any>(p.allplayers ?? {})) {
      if (pl.team !== "CT" && pl.team !== "T") continue;
      const st = pl.state ?? {};
      const ms = pl.match_stats ?? {};
      const weapons = Object.values<any>(pl.weapons ?? {});
      const primary = weapons.find((w) => PRIMARY_TYPES.has(w.type)) ?? weapons.find((w) => w.type === "Pistol");
      out.set(steamid, {
        steamid,
        name: pl.name ?? steamid,
        team: teamOf(pl.team),
        side: pl.team,
        slot: pl.observer_slot,
        hp: st.health ?? 0,
        armor: st.armor ?? 0,
        helmet: !!st.helmet,
        defuser: !!st.defusekit,
        money: st.money ?? 0,
        equipValue: st.equip_value ?? 0,
        kills: ms.kills ?? 0,
        deaths: ms.deaths ?? 0,
        assists: ms.assists ?? 0,
        roundKills: st.round_kills ?? 0,
        roundDmg: st.round_totaldmg ?? 0,
        adr: 0,
        alive: (st.health ?? 0) > 0,
        weapon: primary?.name?.replace(/^weapon_/, ""),
        hasBomb: weapons.some((w) => w.type === "C4"),
        killHs: st.round_killhs ?? 0,
        // 击杀信息要用「当前手持」武器
        activeWeapon: weapons.find((w) => w.state === "active")?.name?.replace(/^weapon_/, ""),
      });
    }
    return out;
  }

  // ───────────── 事件差分 ─────────────

  private diff(prev: Frame, cur: Frame, p: any, completedRound: number, score: Record<TeamKey, number>): GameEvent[] {
    const events: GameEvent[] = [];

    // 击杀：killer 的 kills 增量 与 victim 的 hp>0→0 配对
    const killers: Array<{ pl: RawPlayer; hs: number }> = [];
    const victims: Cs2Player[] = [];
    for (const [id, pl] of cur.players) {
      const was = prev.players.get(id);
      if (!was) continue;
      const delta = pl.kills - was.kills;
      const hsPrev = pl.killHs >= was.killHs ? was.killHs : 0;
      let hs = Math.max(0, pl.killHs - hsPrev);
      for (let i = 0; i < delta; i++) killers.push({ pl, hs: hs-- > 0 ? 1 : 0 });
      if (was.hp > 0 && pl.hp === 0) victims.push(pl);
    }
    for (const v of victims) {
      const i = killers.findIndex((k) => k.pl.team !== v.team);
      const k = i >= 0 ? killers.splice(i, 1)[0] : undefined;
      const kill: Cs2Kill = {
        id: `k${++this.killSeq}`,
        victim: { name: v.name, team: v.team, side: v.side },
        ...(k ? { killer: { name: k.pl.name, team: k.pl.team, side: k.pl.side } } : {}),
        weapon: k ? (k.pl.activeWeapon ?? k.pl.weapon) : undefined,
        headshot: !!k?.hs,
      };
      this.killfeed = [...this.killfeed, kill].slice(-KILLFEED_SIZE);
      events.push({ type: "cs2.kill", kill });
    }

    // 回合开始
    if (prev.roundPhase !== "live" && cur.roundPhase === "live" && prev.roundPhase === "freezetime") {
      this.killfeed = [];
      events.push({ type: "cs2.roundStart", round: cur.round });
    }

    // 炸弹
    if (prev.bomb !== cur.bomb) {
      if (cur.bomb === "planted") events.push({ type: "cs2.bombPlanted" });
      if (cur.bomb === "defused") events.push({ type: "cs2.bombDefused" });
      if (cur.bomb === "exploded") events.push({ type: "cs2.bombExploded" });
    }

    // 残局：某方首次只剩 1 人且对面仍有人
    if (cur.roundPhase === "live" && this.clutchRound !== cur.round) {
      const alive = { home: 0, away: 0 };
      for (const pl of cur.players.values()) if (pl.alive) alive[pl.team]++;
      for (const team of ["home", "away"] as const) {
        if (alive[team] === 1 && alive[other(team)] >= 1) {
          const lone = [...cur.players.values()].find((pl) => pl.team === team && pl.alive)!;
          this.clutchRound = cur.round;
          events.push({ type: "cs2.clutch", player: lone.name, team, vs: alive[other(team)] });
          break;
        }
      }
    }

    // 回合结束
    if (prev.roundPhase !== "over" && cur.roundPhase === "over") {
      const winSide: Cs2Side | undefined = p.round?.win_team;
      if (winSide === "CT" || winSide === "T") {
        const result = this.buildRoundResult(cur, completedRound, winSide, p, score);
        this.lastRound = result;
        this.history = [...this.history, { round: result.round, winner: result.winner, winnerSide: result.winnerSide, reason: result.reason }].slice(-HISTORY_SIZE);
        events.push({ type: "cs2.roundEnd", result });
      }
    }

    if (prev.mapPhase !== "intermission" && cur.mapPhase === "intermission") events.push({ type: "cs2.halftime" });
    if (prev.mapPhase !== "gameover" && cur.mapPhase === "gameover") {
      events.push({ type: "cs2.matchEnd", winner: score.home === score.away ? undefined : score.home > score.away ? "home" : "away" });
    }
    return events;
  }

  private buildRoundResult(cur: Frame, round: number, winSide: Cs2Side, p: any, score: Record<TeamKey, number>): Cs2RoundResult {
    const ps = [...cur.players.values()];
    const winner = winSide === "CT" ? this.ctTeam : other(this.ctTeam);
    const raw = String(p.map?.round_wins?.[String(round)] ?? "");
    const reason: Cs2RoundReason = /elimination/.test(raw) ? "elimination" : /bomb/.test(raw) ? "bomb" : /defuse/.test(raw) ? "defuse" : /time/.test(raw) ? "time" : "unknown";

    for (const pl of ps) {
      const d = this.dmg.get(pl.steamid) ?? { total: 0, rounds: 0 };
      this.dmg.set(pl.steamid, { total: d.total + pl.roundDmg, rounds: d.rounds + 1 });
    }
    const best = [...ps].sort((a, b) => b.roundKills - a.roundKills || b.roundDmg - a.roundDmg)[0];
    const sum = (team: TeamKey, k: "roundKills" | "roundDmg") => ps.filter((pl) => pl.team === team).reduce((s, pl) => s + pl[k], 0);

    return {
      round,
      winner,
      winnerSide: winSide,
      reason,
      score: { ...score },
      ...(best && (best.roundKills > 0 || best.roundDmg > 0)
        ? { mvp: { steamid: best.steamid, name: best.name, team: best.team, kills: best.roundKills, dmg: best.roundDmg } }
        : {}),
      teams: {
        home: { kills: sum("home", "roundKills"), dmg: sum("home", "roundDmg") },
        away: { kills: sum("away", "roundKills"), dmg: sum("away", "roundDmg") },
      },
    };
  }
}
