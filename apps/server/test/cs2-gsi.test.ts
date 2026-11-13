import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cs2Extra, GameEvent } from "@livecg/shared";
import { Cs2Adapter } from "../src/adapters/cs2-gsi.ts";
import { simulateMatch } from "../src/sim/cs2-sim.ts";
import { DelayQueue } from "../src/delay-queue.ts";

/** 从原始帧里读出 Alpha 队（模拟器中开局为 CT → 应映射为 home）的真实比分 */
const alphaScore = (p: any) => (p.map.team_ct.name === "Alpha" ? p.map.team_ct.score : p.map.team_t.score);
const bravoScore = (p: any) => (p.map.team_ct.name === "Bravo" ? p.map.team_ct.score : p.map.team_t.score);

function run(opts: Parameters<typeof simulateMatch>[0]) {
  const adapter = new Cs2Adapter();
  const events: GameEvent[] = [];
  const frames: any[] = [];
  let last: any;
  for (const { payload } of simulateMatch(opts)) {
    const r = adapter.ingest(payload);
    assert.ok(r);
    frames.push(payload);
    events.push(...r.events);
    last = r.patch;
    // 关键性质：无论是否换边，home 永远是 Alpha
    assert.equal(r.patch.home?.score, alphaScore(payload), `home score drift at R${payload.map.round}`);
    assert.equal(r.patch.away?.score, bravoScore(payload));
  }
  return { adapter, events, frames, last };
}

for (const seed of [1, 2, 3, 42, 1234]) {
  test(`full match keeps home/away stable across halftime (seed ${seed})`, () => {
    const { events, frames, last } = run({ seed });
    const final = frames.at(-1);
    const totalRounds = final.map.round;
    assert.ok(totalRounds > 12, "match should pass halftime");

    const roundEnds = events.filter((e) => e.type === "cs2.roundEnd");
    assert.equal(roundEnds.length, totalRounds, "one roundEnd per round");
    roundEnds.forEach((e, i) => assert.equal(e.type === "cs2.roundEnd" && e.result.round, i + 1));

    // 胜者 + 比分与原始数据一致
    const lastEnd = roundEnds.at(-1)!;
    assert.ok(lastEnd.type === "cs2.roundEnd");
    assert.deepEqual(lastEnd.result.score, { home: alphaScore(final), away: bravoScore(final) });

    assert.equal(events.filter((e) => e.type === "cs2.halftime").length, 1);
    const end = events.filter((e) => e.type === "cs2.matchEnd");
    assert.equal(end.length, 1);
    assert.equal(end[0].type === "cs2.matchEnd" && end[0].winner, alphaScore(final) > bravoScore(final) ? "home" : "away");

    // 第二半场：Alpha 在 T 方
    const extra = last.extra as Cs2Extra;
    assert.equal(extra.sides.home, "T");
    assert.equal(extra.roundHistory.length, totalRounds);
  });
}

test("kills are paired with opposing-team victims and match death counts", () => {
  const { events, frames } = run({ seed: 7 });
  const kills = events.flatMap((e) => (e.type === "cs2.kill" ? [e.kill] : []));
  const final = frames.at(-1);
  const deaths = Object.values<any>(final.allplayers).reduce((s, p) => s + p.match_stats.deaths, 0);
  assert.equal(kills.length, deaths);
  for (const k of kills) {
    assert.ok(k.killer, "simulator never produces world kills");
    assert.notEqual(k.killer!.team, k.victim.team);
    assert.ok(k.weapon);
  }
  assert.ok(kills.some((k) => k.headshot));
  assert.ok(kills.some((k) => !k.headshot));
});

test("round results carry reason, MVP and team totals", () => {
  const { events } = run({ seed: 11 });
  const results = events.flatMap((e) => (e.type === "cs2.roundEnd" ? [e.result] : []));
  const reasons = new Set(results.map((r) => r.reason));
  assert.ok(!reasons.has("unknown"));
  assert.ok(reasons.size >= 3, `expected varied round reasons, got ${[...reasons]}`);
  for (const r of results) {
    if (r.reason === "elimination") assert.equal(r.teams[r.winner].kills >= 1, true);
    if (r.mvp) assert.ok(r.mvp.kills >= 0 && r.mvp.name);
  }
});

test("bomb events follow plant → defuse/explode", () => {
  const { events } = run({ seed: 5 });
  const bombs = events.filter((e) => e.type.startsWith("cs2.bomb")).map((e) => e.type);
  assert.ok(bombs.includes("cs2.bombPlanted"));
  for (let i = 0; i < bombs.length; i++) {
    if (bombs[i] !== "cs2.bombPlanted") assert.equal(bombs[i - 1], "cs2.bombPlanted");
  }
});

test("clutch fires at most once per round", () => {
  const { events } = run({ seed: 3 });
  let round = 0;
  const seen = new Set<number>();
  for (const e of events) {
    if (e.type === "cs2.roundStart") round = e.round;
    if (e.type === "cs2.clutch") {
      assert.ok(!seen.has(round));
      seen.add(round);
      assert.ok(e.vs >= 1);
    }
  }
  assert.ok(seen.size > 0);
});

test("without allplayers, intermission + score continuity detect the side swap", () => {
  let tiedHalves = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { frames } = run({ seed, allPlayers: false }); // 断言在 run() 内
    const half = frames.find((p) => p.map.phase === "intermission");
    if (half && half.map.team_ct.score === half.map.team_t.score) tiedHalves++;
  }
  assert.ok(tiedHalves > 0, "need at least one 6:6 halftime to cover the ambiguous case");
});

test("team names win when no roster is available", () => {
  const adapter = new Cs2Adapter(() => ({ home: "Bravo", away: "Alpha" }));
  for (const { payload } of simulateMatch({ seed: 2, allPlayers: false, maxRounds: 3 })) {
    const r = adapter.ingest(payload)!;
    assert.equal(r.patch.home?.score, bravoScore(payload));
  }
});

test("manual swap flips mapping and survives later frames", () => {
  const adapter = new Cs2Adapter();
  const frames = [...simulateMatch({ seed: 4, maxRounds: 4 })].map((f) => f.payload);
  frames.slice(0, 6).forEach((p) => adapter.ingest(p));
  const swapped = adapter.swapSides()!;
  assert.equal(swapped.patch.home?.score, bravoScore(frames[5]));
  for (const p of frames.slice(6)) assert.equal(adapter.ingest(p)!.patch.home?.score, bravoScore(p));
});

test("a new map clears per-map data but keeps the roster (home stays home)", () => {
  const adapter = new Cs2Adapter();
  for (const { payload } of simulateMatch({ seed: 6, maxRounds: 5 })) adapter.ingest(payload);
  // 第二张图：同一批选手，但 Alpha（Aurora 等人）开局在 T 方
  let last: any;
  for (const { payload } of simulateMatch({ seed: 7, maxRounds: 3, mapName: "de_inferno", firstCt: 1 })) {
    last = adapter.ingest(payload)!;
    assert.equal(last.patch.home?.score, alphaScore(payload), "Alpha must stay home on the next map");
  }
  const extra = last.patch.extra as Cs2Extra;
  assert.equal(extra.mapName, "de_inferno");
  assert.equal(extra.sides.home, "T");
  assert.equal(extra.roundHistory.length, 3, "history from the previous map must not leak");
  assert.ok(extra.players.filter((p) => p.name === "Aurora").every((p) => p.team === "home"));
});

test("round number going backwards (new match, same map) also resets history", () => {
  const adapter = new Cs2Adapter();
  for (const { payload } of simulateMatch({ seed: 6, maxRounds: 5 })) adapter.ingest(payload);
  let last: any;
  for (const { payload } of simulateMatch({ seed: 8, maxRounds: 2 })) last = adapter.ingest(payload);
  assert.equal((last.patch.extra as Cs2Extra).roundHistory.length, 2);
});

test("ADR accumulates over observed rounds", () => {
  const { last } = run({ seed: 8, maxRounds: 6 });
  const players = (last.extra as Cs2Extra).players;
  assert.equal(players.length, 10);
  assert.ok(players.some((p) => p.adr > 0));
});

test("DelayQueue keeps FIFO order even when the delay shrinks", async () => {
  let delay = 60;
  const q = new DelayQueue(() => delay);
  const out: number[] = [];
  q.push(() => out.push(1));
  delay = 0;
  q.push(() => out.push(2));
  q.push(() => out.push(3));
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(out, [1, 2, 3]);
});
