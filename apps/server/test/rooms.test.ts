import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { AppState, RoomSummary, ServerMessage } from "@livecg/shared";
import { createApp, WS_ROOM_GONE } from "../src/app.ts";
import { RoomManager } from "../src/rooms.ts";

const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withApp(fn: (ctx: { base: string; port: number; dataDir: string; app: ReturnType<typeof createApp> }) => Promise<void>, dataDir = mkdtempSync(join(tmpdir(), "livecg-rooms-"))) {
  const app = createApp({ appsDir, dataDir, gsiToken: "t0ken" });
  const port = await app.listen(0);
  try {
    await fn({ base: `http://127.0.0.1:${port}`, port, dataDir, app });
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const post = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

/** 连接某房间的 WebSocket，收集状态 */
function wsClient(port: number, room?: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${room ? `?room=${room}` : ""}`);
  const states: AppState[] = [];
  let closed: { code: number } | undefined;
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    if (msg.type === "state") states.push(msg.state);
  });
  ws.on("close", (code) => (closed = { code }));
  return {
    ws,
    states,
    get closed() { return closed; },
    latest: () => states.at(-1)!,
    ready: () => new Promise<void>((r, j) => { ws.once("open", () => r()); ws.once("error", j); }),
    send: (m: unknown) => ws.send(JSON.stringify(m)),
  };
}

test("default room always exists; rooms can be created, renamed and listed", async () => {
  await withApp(async ({ base }) => {
    let list = (await fetch(`${base}/api/rooms`).then((r) => r.json())) as RoomSummary[];
    assert.deepEqual(list.map((r) => r.id), ["default"]);

    const a = await post(`${base}/api/rooms`, { name: "二号场", id: "court-2" });
    assert.equal(a.status, 201);
    assert.deepEqual(a.body, { id: "court-2", name: "二号场" });
    const b = await post(`${base}/api/rooms`, { name: "三号场" });
    assert.equal(b.body.id, "room-2", "auto id when none given");

    assert.equal((await post(`${base}/api/rooms`, { name: "x", id: "Bad Id" })).status, 400);
    assert.equal((await post(`${base}/api/rooms`, { name: "x", id: "court-2" })).status, 409);
    assert.equal((await post(`${base}/api/rooms`, { name: "  " })).status, 400);

    const renamed = await post(`${base}/api/rooms/court-2`, { name: "二号场（女篮）" }, "PATCH");
    assert.equal(renamed.body.name, "二号场（女篮）");
    list = await fetch(`${base}/api/rooms`).then((r) => r.json());
    assert.deepEqual(list.map((r) => r.id), ["default", "court-2", "room-2"]);
    assert.equal(list[1].name, "二号场（女篮）");
  });
});

test("rooms are isolated: commands, state and websocket broadcasts stay in their room", async () => {
  await withApp(async ({ base, port }) => {
    await post(`${base}/api/rooms`, { name: "B", id: "b" });
    const wa = wsClient(port);
    const wb = wsClient(port, "b");
    await Promise.all([wa.ready(), wb.ready()]);
    await sleep(50);
    assert.equal(wa.latest().room.id, "default");
    assert.equal(wb.latest().room.id, "b");
    const bCount = wb.states.length;

    wa.send({ type: "graphic.show", layer: "lt", template: "lower-third", data: { title: "A only" } });
    wa.send({ type: "match.patch", patch: { home: { score: 5 } } });
    await sleep(100);
    assert.equal(wa.latest().layers.lt?.data.title, "A only");
    assert.equal(wb.states.length, bCount, "room B received no broadcasts from room A");

    await post(`${base}/api/rooms/b/command`, { type: "match.patch", patch: { away: { score: 7 } } });
    await sleep(50);
    const a = await fetch(`${base}/api/state`).then((r) => r.json());
    const b = await fetch(`${base}/api/rooms/b/state`).then((r) => r.json());
    assert.deepEqual([a.match.home.score, a.match.away.score], [5, 0]);
    assert.deepEqual([b.match.home.score, b.match.away.score], [0, 7]);
    assert.deepEqual(b.layers, {});
    wa.ws.close();
    wb.ws.close();
  });
});

test("CS2 GSI is routed per room and still requires the token", async () => {
  await withApp(async ({ base }) => {
    await post(`${base}/api/rooms`, { name: "CS 赛场", id: "cs" });
    const frame = { auth: { token: "t0ken" }, map: { name: "de_nuke", round: 3, team_ct: { score: 2 }, team_t: { score: 1 } }, round: { phase: "live" } };
    assert.equal((await fetch(`${base}/gsi/cs2/cs`, { method: "POST", body: JSON.stringify(frame) })).status, 200);
    assert.equal((await fetch(`${base}/gsi/cs2/cs`, { method: "POST", body: JSON.stringify({ ...frame, auth: { token: "bad" } }) })).status, 401);
    assert.equal((await fetch(`${base}/gsi/cs2/nope`, { method: "POST", body: JSON.stringify(frame) })).status, 404);
    await sleep(50);
    const cs = await fetch(`${base}/api/rooms/cs/state`).then((r) => r.json());
    const def = await fetch(`${base}/api/state`).then((r) => r.json());
    assert.equal(cs.match.sport, "cs2");
    assert.equal(cs.match.extra.mapName, "de_nuke");
    assert.equal(def.match.sport, "generic", "default room untouched");
  });
});

test("unknown room websocket is closed with 4404; deleting a room disconnects its clients", async () => {
  await withApp(async ({ base, port }) => {
    const ghost = wsClient(port, "ghost");
    await sleep(150);
    assert.equal(ghost.closed?.code, WS_ROOM_GONE);

    await post(`${base}/api/rooms`, { name: "临时", id: "tmp" });
    const c = wsClient(port, "tmp");
    await c.ready();
    c.send({ type: "hello", role: "control" });
    await sleep(50);
    const list = (await fetch(`${base}/api/rooms`).then((r) => r.json())) as RoomSummary[];
    assert.equal(list.find((r) => r.id === "tmp")!.clients.control, 1);

    // 有图文在 PGM 时拒绝删除
    c.send({ type: "graphic.show", layer: "lt", template: "lower-third" });
    await sleep(50);
    assert.equal((await fetch(`${base}/api/rooms/tmp`, { method: "DELETE" })).status, 409);
    c.send({ type: "graphic.clearAll" });
    await sleep(50);
    assert.equal((await fetch(`${base}/api/rooms/tmp`, { method: "DELETE" })).status, 200);
    await sleep(100);
    assert.equal(c.closed?.code, WS_ROOM_GONE);
    assert.equal((await fetch(`${base}/api/rooms/tmp/state`)).status, 404);
    assert.equal((await fetch(`${base}/api/rooms/default`, { method: "DELETE" })).status, 400, "default room cannot be deleted");
  });
});

test("rooms persist to separate files, deleted rooms are kept as .deleted, and everything reloads", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-rooms-"));
  try {
    let app = createApp({ appsDir, dataDir, gsiToken: "x" });
    let port = await app.listen(0);
    let base = `http://127.0.0.1:${port}`;
    await post(`${base}/api/rooms`, { name: "保留", id: "keep" });
    await post(`${base}/api/rooms`, { name: "删除", id: "drop" });
    await post(`${base}/api/rooms`, { name: "新建后不改动", id: "fresh" });
    await post(`${base}/api/rooms/keep/command`, { type: "config.set", patch: { cs2DelayMs: 4000 } });
    await sleep(700);
    await fetch(`${base}/api/rooms/drop`, { method: "DELETE" });
    await app.close();

    const files = readdirSync(join(dataDir, "rooms"));
    assert.ok(files.includes("keep.json"));
    assert.ok(files.some((f) => f.startsWith("drop.json.deleted-")));

    app = createApp({ appsDir, dataDir, gsiToken: "x" });
    port = await app.listen(0);
    base = `http://127.0.0.1:${port}`;
    const list = (await fetch(`${base}/api/rooms`).then((r) => r.json())) as RoomSummary[];
    assert.deepEqual(list.map((r) => r.id).sort(), ["default", "fresh", "keep"], "a room created and never touched must survive a restart");
    assert.equal(list.find((r) => r.id === "keep")!.name, "保留");
    const keep = await fetch(`${base}/api/rooms/keep/state`).then((r) => r.json());
    assert.equal(keep.config.cs2DelayMs, 4000);
    await app.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("single-room data file is migrated into the default room", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-rooms-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "livecg.json"), JSON.stringify({
    version: 1,
    config: { cs2DelayMs: 90000 },
    rundown: { items: [{ id: "old", label: "旧条目", layer: "lt", template: "lower-third", data: {} }], selectedId: "old" },
    teams: { home: { name: "老主队", shortName: "老主" }, away: { name: "老客队", shortName: "老客" } },
  }));
  await withApp(async ({ base }) => {
    const s = await fetch(`${base}/api/state`).then((r) => r.json());
    assert.equal(s.room.id, "default");
    assert.equal(s.room.name, "默认房间", "legacy file without a name gets the default room name");
    assert.equal(s.config.cs2DelayMs, 90000);
    assert.equal(s.match.home.name, "老主队");
    assert.equal(s.rundown.items[0].label, "旧条目");
    assert.ok(existsSync(join(dataDir, "rooms", "default.json")));
    assert.ok(!existsSync(join(dataDir, "livecg.json")));
  }, dataDir);
});

test("copyFrom clones rundown, config and teams but disables device connections", () => {
  const m = new RoomManager(undefined);
  m.load();
  const src = m.require("default");
  src.handleCommand({ type: "rundown.upsert", item: { label: "复制我", layer: "lt", template: "lower-third", data: { title: "x" } } });
  src.handleCommand({ type: "match.patch", patch: { home: { name: "源主队", score: 3 } } });
  src.handleCommand({ type: "config.set", patch: { casparcg: { enabled: true, port: 1 }, scoreboard: { enabled: true, port: 46001 } } });
  const copy = m.create({ name: "副本", copyFrom: "default" }).store.get();
  assert.ok(copy.rundown.items.some((i) => i.label === "复制我"));
  assert.equal(copy.match.home.name, "源主队");
  assert.equal(copy.match.home.score, 0, "scores are not copied");
  assert.equal(copy.config.casparcg.enabled, false);
  assert.equal(copy.config.casparcg.port, 1, "other device settings are kept");
  assert.equal(copy.config.scoreboard.enabled, false);
  // 修改副本不影响源（深拷贝）
  m.require(copy.room.id).handleCommand({ type: "rundown.remove", id: copy.rundown.items[0].id });
  assert.equal(src.store.get().rundown.items[0].id, copy.rundown.items[0].id);
  m.stopAll();
});

test("device conflicts across rooms are rejected: scoreboard port and CasparCG channel-layer", () => {
  const m = new RoomManager(undefined);
  m.load();
  m.create({ name: "B", id: "b" });
  m.handleCommand("default", { type: "config.set", patch: { scoreboard: { enabled: true, port: 46010 } } });
  assert.throws(() => m.handleCommand("b", { type: "config.set", patch: { scoreboard: { enabled: true, port: 46010 } } }), /46010.*默认房间/);
  assert.doesNotThrow(() => m.handleCommand("b", { type: "config.set", patch: { scoreboard: { enabled: true, port: 46011 } } }));

  // CasparCG：默认房间 PGM 占用 1-20；B 房间同一台机器同一层 → 拒绝；换到 1-30 → 允许
  m.handleCommand("default", { type: "config.set", patch: { casparcg: { enabled: true, host: "10.0.0.9", port: 1 } } });
  assert.throws(() => m.handleCommand("b", { type: "config.set", patch: { casparcg: { enabled: true, host: "10.0.0.9", port: 1 } } }), /1-20.*默认房间/);
  const outputs = m.require("b").store.get().config.casparcg.outputs.map((o) => (o.id === "pgm" ? { ...o, layer: 30 } : o));
  assert.doesNotThrow(() => m.handleCommand("b", { type: "config.set", patch: { casparcg: { enabled: true, host: "10.0.0.9", port: 1, outputs } } }));
  // 同一台 CasparCG 的不同端口/主机不算冲突
  assert.doesNotThrow(() => m.handleCommand("b", { type: "config.set", patch: { casparcg: { host: "10.0.0.10", outputs: m.require("default").store.get().config.casparcg.outputs } } }));
  // 同一房间内两路输出撞层
  const dup = m.require("b").store.get().config.casparcg.outputs.map((o) => ({ ...o, enabled: true, channel: 3, layer: 5 }));
  assert.throws(() => m.handleCommand("b", { type: "config.set", patch: { casparcg: { outputs: dup } } }), /同一个 CasparCG 通道-层 3-5/);
  m.stopAll();
});

test("CasparCG output URLs carry the room id", async () => {
  const { CasparClient } = await import("../src/casparcg.ts");
  const url = CasparClient.urlFor({ enabled: true, host: "h", port: 1, baseUrl: "http://10.0.0.5:3000/", outputs: [] }, { id: "pgm", label: "PGM", channel: 1, layer: 20, source: "pgm", enabled: true }, "court-2");
  assert.equal(url, "http://10.0.0.5:3000/graphics/?room=court-2&channel=pgm");
  assert.ok(readFileSync(new URL("../src/casparcg.ts", import.meta.url), "utf8").includes("room.id"));
});
