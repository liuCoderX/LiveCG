import { test } from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import type { BasketballExtra, FootballExtra, GameEvent, SportPresetId } from "@livecg/shared";
import { Store } from "../src/store.ts";
import { SportsController } from "../src/sports/controller.ts";
import { clockNow, parseClock } from "../src/sports/clock.ts";
import { PRESETS, periodAt } from "../src/sports/presets.ts";
import { parseScoreboardPacket, ScoreboardInput } from "../src/sports/scoreboard.ts";

const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 可控时间：t 由测试推进 */
function setup(preset: SportPresetId = "football", opts: { realTime?: boolean } = {}) {
  let t = 1_000_000;
  const store = new Store();
  const events: GameEvent[] = [];
  const now = opts.realTime ? Date.now : () => t;
  const ctl = new SportsController(store, (e) => events.push(e), now);
  ctl.handle({ type: "match.setup", preset });
  return {
    store, ctl, events,
    advance: (ms: number) => (t += ms),
    clock: () => clockNow(store.get().match.clock!, now()),
    shot: () => clockNow(store.get().match.shotClock!, now()),
    fx: () => store.get().match.extra as unknown as FootballExtra,
    bx: () => store.get().match.extra as unknown as BasketballExtra,
    done: () => ctl.dispose(),
  };
}

test("parseClock accepts broadcast formats", () => {
  assert.equal(parseClock("12:00"), 720_000);
  assert.equal(parseClock("9:58.3"), 598_300);
  assert.equal(parseClock("4.2"), 4_200);
  assert.equal(parseClock("90:00"), 5_400_000);
  assert.equal(parseClock("1:75"), undefined);
  assert.equal(parseClock("abc"), undefined);
});

test("football: setup, count-up clock, stoppage minute, second half starts at 45:00", () => {
  const s = setup("football");
  try {
    assert.equal(s.store.get().match.sport, "football");
    assert.equal(s.store.get().match.period, "上半场");
    assert.equal(s.clock(), 0);
    s.ctl.handle({ type: "clock.start" });
    s.advance(22 * MIN + 10_000);
    assert.equal(s.ctl.footballMinute(), "23'");
    s.advance(23 * MIN + 30_000); // 45:40
    assert.equal(s.ctl.footballMinute(), "45+1'");
    s.ctl.handle({ type: "football.addedTime", minutes: 3 });
    assert.equal(s.fx().addedTime, 3);
    s.ctl.handle({ type: "clock.stop" });
    const frozen = s.clock();
    s.advance(10_000);
    assert.equal(s.clock(), frozen, "stopped clock does not move");

    s.ctl.handle({ type: "period.next" });
    assert.equal(s.store.get().match.period, "下半场");
    assert.equal(s.store.get().match.periodShort, "2H");
    assert.equal(s.clock(), 45 * MIN);
    assert.equal(s.store.get().match.clock!.running, false);
    assert.equal(s.fx().addedTime, 0, "added time resets each half");
    // 加时下半场之后没有更多节次
    s.ctl.handle({ type: "period.set", index: 3 });
    s.ctl.handle({ type: "period.next" });
    assert.equal(s.store.get().match.periodIndex, 3);
  } finally {
    s.done();
  }
});

test("football events: goals change score, own goal credits the given team, undo reverts", () => {
  const s = setup("football");
  try {
    s.ctl.handle({ type: "clock.start" });
    s.advance(9 * MIN);
    s.ctl.handle({ type: "football.event", event: { type: "goal", team: "home", player: "张三" } });
    s.ctl.handle({ type: "football.event", event: { type: "ownGoal", team: "away", player: "李四" } });
    s.ctl.handle({ type: "football.event", event: { type: "red", team: "away", player: "王五" } });
    s.ctl.handle({ type: "football.event", event: { type: "sub", team: "home", player: "新人", playerOut: "老将", minute: "60'" } });
    const m = s.store.get().match;
    assert.deepEqual([m.home.score, m.away.score], [1, 1]);
    assert.equal(s.fx().events[0].minute, "10'");
    assert.equal(s.fx().events[3].minute, "60'", "explicit minute is kept");
    assert.equal(s.fx().redCards.away, 1);
    const goalEvents = s.events.filter((e) => e.type === "football.event");
    assert.equal(goalEvents.length, 4);

    s.ctl.handle({ type: "football.undo", id: s.fx().events[0].id });
    s.ctl.handle({ type: "football.undo", id: s.fx().events.find((e) => e.type === "red")!.id });
    assert.equal(s.store.get().match.home.score, 0);
    assert.equal(s.fx().redCards.away, 0);
    assert.throws(() => s.ctl.handle({ type: "football.event", event: { type: "goal", team: "home", player: " " } }), /球员/);
    assert.throws(() => s.ctl.handle({ type: "basketball.foul", team: "home", delta: 1 }), /不是篮球/);
  } finally {
    s.done();
  }
});

test("basketball FIBA: countdown, shot clock follows game clock, fouls/timeouts per period, overtime labels", () => {
  const s = setup("basketball-fiba");
  try {
    assert.equal(s.clock(), 10 * MIN);
    assert.equal(s.shot(), 24_000);
    assert.deepEqual(s.bx().timeouts, { home: 2, away: 2 });

    s.ctl.handle({ type: "clock.start" });
    s.advance(5_000);
    assert.equal(s.clock(), 10 * MIN - 5_000);
    assert.equal(s.shot(), 19_000);
    s.ctl.handle({ type: "shotclock.reset", ms: 14_000 });
    s.advance(1_000);
    assert.equal(s.shot(), 13_000, "reset shot clock keeps running with the game clock");
    s.ctl.handle({ type: "clock.toggle" });
    s.advance(3_000);
    assert.equal(s.shot(), 13_000, "stopping the game clock stops the shot clock");
    s.ctl.handle({ type: "clock.adjust", deltaMs: -100 });
    assert.equal(s.clock(), 10 * MIN - 6_100);

    s.ctl.handle({ type: "basketball.foul", team: "home", delta: 5 });
    s.ctl.handle({ type: "basketball.timeout", team: "away", delta: -5 });
    assert.equal(s.bx().fouls.home, 5);
    assert.equal(s.bx().timeouts.away, 0, "timeouts never go negative");
    s.ctl.handle({ type: "basketball.possession" });
    assert.equal(s.bx().possession, "home");
    s.ctl.handle({ type: "basketball.possession" });
    assert.equal(s.bx().possession, "away");

    s.ctl.handle({ type: "period.next" });
    assert.equal(s.bx().fouls.home, 0, "team fouls reset each quarter");
    assert.equal(s.bx().timeouts.away, 0, "FIBA Q2 keeps first-half timeouts");
    s.ctl.handle({ type: "period.next" });
    assert.deepEqual(s.bx().timeouts, { home: 3, away: 3 }, "FIBA second half: 3 timeouts");
    s.ctl.handle({ type: "period.set", index: 5 });
    assert.equal(s.store.get().match.period, "加时 2");
    assert.equal(s.store.get().match.periodShort, "OT2");
    assert.equal(s.clock(), 5 * MIN);
    assert.equal(periodAt(PRESETS["basketball-fiba"], 5)?.short, "OT2");
  } finally {
    s.done();
  }
});

test("countdown expiry stops both clocks at 0 and emits clock.expired; shot clock expiry emits its own event", async () => {
  const s = setup("basketball-fiba", { realTime: true });
  try {
    s.ctl.handle({ type: "clock.set", ms: 400 });
    s.ctl.handle({ type: "shotclock.reset", ms: 150 });
    s.ctl.handle({ type: "clock.start" });
    await sleep(250);
    assert.ok(s.events.some((e) => e.type === "shotclock.expired"));
    assert.equal(s.store.get().match.shotClock!.ms, 0);
    assert.equal(s.store.get().match.clock!.running, true, "shot clock violation does not stop the game clock");
    await sleep(300);
    const m = s.store.get().match;
    assert.equal(m.clock!.ms, 0);
    assert.equal(m.clock!.running, false);
    assert.ok(s.events.some((e) => e.type === "clock.expired"));
    s.ctl.handle({ type: "clock.start" });
    assert.equal(s.store.get().match.clock!.running, false, "cannot start an expired countdown");
  } finally {
    s.done();
  }
});

test("adjusting a running countdown reschedules expiry", async () => {
  const s = setup("basketball-fiba", { realTime: true });
  try {
    s.ctl.handle({ type: "clock.set", ms: 150 });
    s.ctl.handle({ type: "clock.start" });
    s.ctl.handle({ type: "clock.adjust", deltaMs: 300 });
    await sleep(250);
    assert.ok(!s.events.some((e) => e.type === "clock.expired"), "old timer must not fire early");
    await sleep(300);
    assert.ok(s.events.some((e) => e.type === "clock.expired"));
  } finally {
    s.done();
  }
});

test("scoreboard packet parser: JSON and key=value", () => {
  assert.deepEqual(parseScoreboardPacket('{"clock":"9:58.3","running":true,"period":2,"home":45,"away":41,"shot":"14.0"}'), {
    clockMs: 598_300, running: true, period: 2, home: 45, away: 41, shotMs: 14_000,
  });
  assert.deepEqual(parseScoreboardPacket("clock=0:04.2;running=0;homeFouls=4;shot=off"), { clockMs: 4_200, running: false, homeFouls: 4, shotMs: null });
  assert.deepEqual(parseScoreboardPacket("clockMs=1234,home=3"), { clockMs: 1234, home: 3 });
  assert.equal(parseScoreboardPacket("{broken"), null);
  assert.equal(parseScoreboardPacket("hello"), null);
});

test("scoreboard drives clock only when selected as clock source; internal commands are refused meanwhile", () => {
  const s = setup("basketball-fiba");
  const input = new ScoreboardInput(s.store, (i) => periodAt(PRESETS["basketball-fiba"], i), () => 5_000_000);
  try {
    input.onPacket('{"clock":"7:30","running":true,"home":20,"away":18,"period":2,"shot":"12"}');
    let m = s.store.get().match;
    assert.deepEqual([m.home.score, m.away.score, m.period], [20, 18, "第二节"]);
    assert.equal(m.clock!.ms, 10 * MIN, "internal clock source ignores scoreboard clock");

    s.store.dispatch({ type: "config.set", patch: { scoreboard: { enabled: true, clockSource: "scoreboard" } } });
    input.onPacket('{"clock":"7:30","running":true,"shot":"12"}');
    m = s.store.get().match;
    assert.equal(m.clock!.ms, 450_000);
    assert.equal(m.clock!.running, true);
    assert.equal(m.clock!.direction, "down");
    assert.equal(m.shotClock!.ms, 12_000);
    assert.throws(() => s.ctl.handle({ type: "clock.start" }), /计分器/);
    input.onPacket("shot=off");
    assert.equal(s.store.get().match.shotClock, undefined, "shot=off removes the shot clock");

    // 切回内部时钟：从最后读数继续，不跳
    s.store.dispatch({ type: "config.set", patch: { scoreboard: { clockSource: "internal" } } });
    assert.doesNotThrow(() => s.ctl.handle({ type: "clock.stop" }));
  } finally {
    input.stop();
    s.done();
  }
});

test("scoreboard over real UDP: receiving → stale status", async () => {
  const store = new Store();
  store.dispatch({ type: "config.set", patch: { scoreboard: { enabled: true, port: 0 + 45300 + Math.floor(Math.random() * 500), staleMs: 300 } } });
  const input = new ScoreboardInput(store, () => undefined);
  input.start();
  const sender = createSocket("udp4");
  try {
    const port = store.get().config.scoreboard.port;
    for (let i = 0; i < 50 && store.get().outputs.scoreboard.status !== "listening"; i++) await sleep(20);
    assert.equal(store.get().outputs.scoreboard.status, "listening");
    await new Promise<void>((r) => sender.send("home=7;away=3", port, "127.0.0.1", () => r()));
    for (let i = 0; i < 50 && store.get().match.home.score !== 7; i++) await sleep(20);
    assert.equal(store.get().match.home.score, 7);
    assert.equal(store.get().outputs.scoreboard.status, "receiving");
    await sleep(900);
    assert.equal(store.get().outputs.scoreboard.status, "stale");
  } finally {
    sender.close();
    input.stop();
  }
});
