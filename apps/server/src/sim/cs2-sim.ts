/**
 * CS2 GSI 比赛模拟器：生成与游戏 OB 客户端格式一致的 GSI 帧序列。
 * 用于本地联调（无需开游戏）与自动化测试。可通过 seed 复现。
 *
 * 规则简化：MR12（先到 13 胜，不含加时），第 12 回合后换边。
 */

export interface SimOptions {
  seed?: number;
  token?: string;
  mapName?: string;
  teamNames?: [string, string];
  /** false 时不输出 allplayers（模拟非 OB 客户端，只能拿到比分） */
  allPlayers?: boolean;
  /** 只模拟前 N 回合 */
  maxRounds?: number;
  /** 开局哪支队伍（0 = Aurora 队，1 = Falcon 队）为 CT，默认 0 */
  firstCt?: 0 | 1;
}

export interface SimFrame {
  payload: any;
  /** 该帧到下一帧的建议间隔（毫秒，实时速度） */
  waitMs: number;
}

interface SimPlayer {
  steamid: string;
  name: string;
  slot: number;
  hp: number;
  armor: number;
  helmet: boolean;
  money: number;
  kills: number;
  deaths: number;
  assists: number;
  roundKills: number;
  roundKillHs: number;
  roundDmg: number;
}

interface SimTeam {
  name: string;
  players: SimPlayer[];
  score: number;
  lossStreak: number;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  ["Aurora", "Blaze", "Comet", "Drift", "Echo"],
  ["Falcon", "Ghost", "Havoc", "Ion", "Jolt"],
];

export function* simulateMatch(opts: SimOptions = {}): Generator<SimFrame> {
  const rnd = mulberry32(opts.seed ?? 1);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const token = opts.token ?? "change-me";
  const mapName = opts.mapName ?? "de_mirage";
  const names = opts.teamNames ?? ["Alpha", "Bravo"];
  const withPlayers = opts.allPlayers ?? true;
  const maxRounds = opts.maxRounds ?? 24;

  const teams: [SimTeam, SimTeam] = [0, 1].map((ti) => ({
    name: names[ti],
    score: 0,
    lossStreak: 0,
    players: NAMES[ti].map((n, i) => ({
      steamid: `7656119800000${ti}${i}0`,
      name: n,
      slot: ti * 5 + i + 1 === 10 ? 0 : ti * 5 + i + 1,
      hp: 100, armor: 0, helmet: false, money: 800,
      kills: 0, deaths: 0, assists: 0, roundKills: 0, roundKillHs: 0, roundDmg: 0,
    })),
  })) as [SimTeam, SimTeam];

  let ctIdx: number = opts.firstCt ?? 0; // teams[ctIdx] 当前为 CT
  let completed = 0;
  let mapPhase = "live";
  const roundWins: Record<string, string> = {};
  let observed = teams[0].players[0].steamid;

  const sideOf = (ti: number) => (ti === ctIdx ? "CT" : "T");
  const weaponFor = (ti: number, pl: SimPlayer) => {
    const ct = sideOf(ti) === "CT";
    const rifle = pl.money >= 2700 || completed % 12 >= 2 ? (ct ? "weapon_m4a1_silencer" : "weapon_ak47") : undefined;
    const ws: Record<string, any> = {
      weapon_0: { name: "weapon_knife", type: "Knife", state: "holstered" },
      weapon_1: { name: ct ? "weapon_usp_silencer" : "weapon_glock", type: "Pistol", state: rifle ? "holstered" : "active" },
    };
    if (rifle) ws.weapon_2 = { name: rifle, type: "Rifle", state: "active" };
    return ws;
  };

  let bombCarrier: string | undefined;
  const frame = (roundPhase: string, extra: { winTeam?: string; bomb?: string; countdown?: [string, number] } = {}) => {
    const allplayers: Record<string, any> = {};
    teams.forEach((team, ti) =>
      team.players.forEach((pl) => {
        const weapons = weaponFor(ti, pl);
        if (pl.steamid === bombCarrier && pl.hp > 0) weapons.weapon_9 = { name: "weapon_c4", type: "C4", state: "holstered" };
        allplayers[pl.steamid] = {
          name: pl.name,
          observer_slot: pl.slot,
          team: sideOf(ti),
          state: {
            health: pl.hp, armor: pl.armor, helmet: pl.helmet, flashed: 0, burning: 0,
            money: pl.money, round_kills: pl.roundKills, round_killhs: pl.roundKillHs,
            round_totaldmg: pl.roundDmg, equip_value: pl.hp > 0 ? (pl.armor ? 1000 : 0) + (weapons.weapon_2 ? 2900 : 200) : 0,
            ...(sideOf(ti) === "CT" && pl.armor ? { defusekit: true } : {}),
          },
          match_stats: { kills: pl.kills, assists: pl.assists, deaths: pl.deaths, mvps: 0, score: pl.kills * 2 },
          weapons,
        };
      }),
    );
    const ct = teams[ctIdx];
    const t = teams[1 - ctIdx];
    const payload: any = {
      provider: { name: "Counter-Strike 2", appid: 730, version: 14000, steamid: "0", timestamp: Math.floor(Date.now() / 1000) },
      auth: { token },
      map: {
        mode: "competitive", name: mapName, phase: mapPhase, round: completed,
        team_ct: { score: ct.score, name: ct.name, consecutive_round_losses: ct.lossStreak, timeouts_remaining: 1, matches_won_this_series: 0 },
        team_t: { score: t.score, name: t.name, consecutive_round_losses: t.lossStreak, timeouts_remaining: 1, matches_won_this_series: 0 },
        num_matches_to_win_series: 0,
        round_wins: { ...roundWins },
      },
      round: { phase: roundPhase, ...(extra.winTeam ? { win_team: extra.winTeam } : {}), ...(extra.bomb ? { bomb: extra.bomb } : {}) },
      ...(extra.bomb ? { bomb: { state: extra.bomb } } : bombCarrier ? { bomb: { state: "carried", player: bombCarrier } } : {}),
      player: { steamid: observed, name: "observer", observer_slot: 1 },
      ...(extra.countdown ? { phase_countdowns: { phase: extra.countdown[0], phase_ends_in: extra.countdown[1].toFixed(1) } } : {}),
    };
    if (withPlayers) payload.allplayers = allplayers;
    return payload;
  };

  const alive = (ti: number) => teams[ti].players.filter((p) => p.hp > 0);

  const kill = (killerTeam: number): any => {
    const killer = pick(alive(killerTeam));
    const victim = pick(alive(1 - killerTeam));
    const hs = rnd() < 0.45;
    killer.kills++;
    killer.roundKills++;
    if (hs) killer.roundKillHs++;
    killer.roundDmg += victim.hp;
    killer.money += 300;
    victim.hp = 0;
    victim.deaths++;
    observed = killer.steamid;
    if (rnd() < 0.3) {
      const helpers = alive(killerTeam).filter((p) => p !== killer);
      if (helpers.length) pick(helpers).assists++;
    }
    return frame("live");
  };

  while (mapPhase !== "gameover") {
    // ── 冻结时间 ──
    for (const team of teams)
      for (const pl of team.players) {
        pl.hp = 100;
        pl.roundKills = pl.roundKillHs = pl.roundDmg = 0;
        pl.armor = pl.money >= 1000 ? 100 : 0;
        pl.helmet = pl.money >= 1000;
        if (pl.money >= 3700) pl.money -= 3700;
        else if (pl.money >= 1000) pl.money -= 650;
      }
    bombCarrier = pick(teams[1 - ctIdx].players).steamid;
    yield { payload: frame("freezetime", { countdown: ["freezetime", 15] }), waitMs: 3000 };

    // ── 回合进行 ──
    const ctWins = rnd() < 0.5;
    const winnerTi = ctWins ? ctIdx : 1 - ctIdx;
    const reason = ctWins ? pick(["elimination", "elimination", "defuse", "time"]) : pick(["elimination", "bomb"]);
    let clock = 115;
    yield { payload: frame("live", { countdown: ["live", clock] }), waitMs: 2500 };

    let bombState: string | undefined;
    const loserTi = 1 - winnerTi;
    // 赢方被淘汰 0-3 人，输方按胜利方式决定淘汰人数
    const winnerLosses = Math.floor(rnd() * 4);
    const loserLosses = reason === "elimination" ? 5 : reason === "time" ? 1 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 2);
    const queue = [...Array(winnerLosses).fill(loserTi), ...Array(loserLosses).fill(winnerTi)].sort(() => rnd() - 0.5);
    // 保证最后一个击杀由胜方完成（全歼时）
    if (reason === "elimination") {
      const idx = queue.lastIndexOf(winnerTi);
      queue.splice(idx, 1);
      queue.push(winnerTi);
    }
    const plantAt = reason === "bomb" || reason === "defuse" ? Math.floor(queue.length / 2) : -1;

    for (let i = 0; i < queue.length; i++) {
      if (i === plantAt) {
        bombState = "planted";
        bombCarrier = undefined;
        clock = 40;
        yield { payload: frame("live", { bomb: "planted", countdown: ["bomb", clock] }), waitMs: 2000 };
      }
      if (alive(queue[i]).length === 0 || alive(1 - queue[i]).length === 0) continue;
      clock -= 4 + Math.floor(rnd() * 8);
      const f = kill(queue[i]);
      if (bombState) {
        f.round.bomb = "planted";
        f.bomb = { state: "planted" };
      }
      f.phase_countdowns = { phase: bombState ? "bomb" : "live", phase_ends_in: Math.max(1, clock).toFixed(1) };
      yield { payload: f, waitMs: 1200 + Math.floor(rnd() * 1800) };
    }

    // ── 回合结束 ──
    completed++;
    const winSide = sideOf(winnerTi);
    if (reason === "bomb") bombState = "exploded";
    if (reason === "defuse") bombState = "defused";
    roundWins[String(completed)] = `${winSide.toLowerCase()}_win_${reason}`;
    teams[winnerTi].score++;
    teams[winnerTi].lossStreak = Math.max(0, teams[winnerTi].lossStreak - 1);
    teams[loserTi].lossStreak = Math.min(5, teams[loserTi].lossStreak + 1);
    for (const pl of teams[winnerTi].players) pl.money = Math.min(16000, pl.money + 3250);
    for (const pl of teams[loserTi].players) pl.money = Math.min(16000, pl.money + 1400 + 500 * Math.min(4, teams[loserTi].lossStreak - 1));

    const done = teams.some((t) => t.score >= 13) || completed >= maxRounds;
    yield {
      payload: frame("over", { winTeam: winSide, countdown: ["over", 7], ...(bombState ? { bomb: bombState } : {}) }),
      waitMs: done ? 1000 : 7000,
    };

    if (done) {
      mapPhase = "gameover";
      yield { payload: frame("over", { winTeam: winSide }), waitMs: 0 };
      break;
    }
    if (completed === 12) {
      mapPhase = "intermission";
      yield { payload: frame("over", { countdown: ["timeout_ct", 15] }), waitMs: 5000 };
      ctIdx = 1 - ctIdx;
      for (const team of teams) {
        team.lossStreak = 0;
        for (const pl of team.players) pl.money = 800;
      }
      mapPhase = "live";
    }
  }
}
