import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { loadSeed, persistTo } from "../src/persist.ts";

const lt = (title: string) => ({ layer: "lt", template: "lower-third", data: { title } });

test("cue puts a graphic on PVW only; take moves it to PGM with a new takeId", () => {
  const s = new Store();
  s.dispatch({ type: "graphic.cue", ...lt("A") });
  assert.equal(s.get().preview.lt?.data.title, "A");
  assert.equal(s.get().layers.lt, undefined);
  const cueTake = s.get().preview.lt!.takeId;

  s.dispatch({ type: "graphic.take" });
  assert.equal(s.get().layers.lt?.data.title, "A");
  assert.equal(s.get().layers.lt?.visible, true);
  assert.equal(s.get().preview.lt, undefined, "PVW is emptied after take");
  assert.ok(s.get().layers.lt!.takeId > cueTake);
});

test("take without layer takes every cued layer at once; take on empty PVW is a no-op", () => {
  const s = new Store();
  s.dispatch({ type: "graphic.cue", ...lt("A") });
  s.dispatch({ type: "graphic.cue", layer: "scorebug", template: "scorebug" });
  s.dispatch({ type: "graphic.take" });
  assert.deepEqual(Object.keys(s.get().layers).sort(), ["lt", "scorebug"]);
  const rev = s.get().rev;
  s.dispatch({ type: "graphic.take" });
  assert.equal(s.get().rev, rev);
});

test("update keeps takeId (no re-animation); a new show bumps it", () => {
  const s = new Store();
  s.dispatch({ type: "graphic.show", ...lt("A") });
  const id = s.get().layers.lt!.takeId;
  s.dispatch({ type: "graphic.update", layer: "lt", data: { subtitle: "x" } });
  assert.equal(s.get().layers.lt!.takeId, id);
  assert.deepEqual(s.get().layers.lt!.data, { title: "A", subtitle: "x" });
  s.dispatch({ type: "graphic.show", ...lt("B") });
  assert.ok(s.get().layers.lt!.takeId > id);
});

test("update can target PVW without touching PGM", () => {
  const s = new Store();
  s.dispatch({ type: "graphic.show", ...lt("on air") });
  s.dispatch({ type: "graphic.cue", ...lt("next") });
  s.dispatch({ type: "graphic.update", layer: "lt", data: { title: "next (edited)" }, channel: "pvw" });
  assert.equal(s.get().layers.lt!.data.title, "on air");
  assert.equal(s.get().preview.lt!.data.title, "next (edited)");
});

test("rundown.cue cues the selected item and advances the selection", () => {
  const s = new Store();
  const [first, second] = s.get().rundown.items;
  s.dispatch({ type: "rundown.select", id: first.id });
  s.dispatch({ type: "rundown.cue" });
  assert.equal(s.get().preview[first.layer]?.itemId, first.id);
  assert.equal(s.get().rundown.selectedId, second.id);
});

test("rundown.fire toggles the same item; a different item on the same layer replaces it", () => {
  const s = new Store();
  const c1 = s.get().rundown.items.find((i) => i.id === "lt-caster-1")!;
  const c2 = s.get().rundown.items.find((i) => i.id === "lt-caster-2")!;
  s.dispatch({ type: "rundown.fire", id: c1.id });
  assert.equal(s.get().layers.lt?.itemId, c1.id);
  s.dispatch({ type: "rundown.fire", id: c2.id });
  assert.equal(s.get().layers.lt?.itemId, c2.id, "second caster replaces the first, not toggles it off");
  assert.equal(s.get().layers.lt?.visible, true);
  s.dispatch({ type: "rundown.fire", id: c2.id });
  assert.equal(s.get().layers.lt?.visible, false);
});

test("rundown.upsert generates ids, steals duplicate hotkeys and validates input", () => {
  const s = new Store();
  s.dispatch({ type: "rundown.upsert", item: { label: "新条目", layer: "lt", template: "lower-third", data: {}, hotkey: "1" } });
  const items = s.get().rundown.items;
  const created = items.at(-1)!;
  assert.ok(created.id);
  assert.equal(s.get().rundown.selectedId, created.id);
  assert.equal(items.filter((i) => i.hotkey === "1").length, 1);
  assert.equal(created.hotkey, "1");
  assert.throws(() => s.dispatch({ type: "rundown.upsert", item: { label: "x", layer: "lt", template: "lower-third", data: {}, hotkey: "F5" } }), /热键/);
  assert.throws(() => s.dispatch({ type: "rundown.upsert", item: { label: "x", layer: "", template: "lower-third", data: {} } }), /图层/);
});

test("rundown.move and remove keep the selection sensible", () => {
  const s = new Store();
  const ids = s.get().rundown.items.map((i) => i.id);
  s.dispatch({ type: "rundown.move", id: ids[0], to: 99 });
  assert.equal(s.get().rundown.items.at(-1)!.id, ids[0]);
  s.dispatch({ type: "rundown.select", id: ids[1] });
  s.dispatch({ type: "rundown.remove", id: ids[1] });
  assert.equal(s.get().rundown.selectedId, ids[2], "selection moves to the item that took its place");
});

test("persistence round-trips config, rundown and team names but not layers or scores", async () => {
  const dir = mkdtempSync(join(tmpdir(), "livecg-"));
  const file = join(dir, "livecg.json");
  try {
    const s = new Store(loadSeed(file));
    const stop = persistTo(s, file, 10);
    s.dispatch({ type: "config.set", patch: { cs2DelayMs: 90000 } });
    s.dispatch({ type: "match.patch", patch: { home: { name: "Team Alpha", score: 9 } } });
    s.dispatch({ type: "rundown.upsert", item: { label: "保存我", layer: "lt", template: "lower-third", data: { title: "x" } } });
    s.dispatch({ type: "graphic.show", ...lt("on air") });
    await new Promise((r) => setTimeout(r, 50));
    stop();

    const raw = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(raw.layers, undefined);
    const s2 = new Store(loadSeed(file));
    assert.equal(s2.get().config.cs2DelayMs, 90000);
    assert.equal(s2.get().match.home.name, "Team Alpha");
    assert.equal(s2.get().match.home.score, 0);
    assert.ok(s2.get().rundown.items.some((i) => i.label === "保存我"));
    assert.deepEqual(s2.get().layers, {});
    assert.equal(s2.get().config.casparcg.port, 5250, "defaults fill fields missing from older files");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt data file falls back to defaults instead of crashing", () => {
  const dir = mkdtempSync(join(tmpdir(), "livecg-"));
  try {
    const file = join(dir, "livecg.json");
    writeFileSync(file, "{ not json");
    const s = new Store(loadSeed(file));
    assert.ok(s.get().rundown.items.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
