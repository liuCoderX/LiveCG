import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iconNameOf, iconRatio, scanIconPack } from "../src/icons.ts";
import { createApp } from "../src/app.ts";
import { Cs2Adapter } from "../src/adapters/cs2-gsi.ts";
import { simulateMatch } from "../src/sim/cs2-sim.ts";

const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

test("icon names and aspect ratios", () => {
  assert.equal(iconNameOf("weapon_AK47.svg"), "ak47");
  assert.equal(iconNameOf("m4a1_silencer.PNG"), "m4a1_silencer");
  assert.equal(iconNameOf("notes.txt"), undefined);
  assert.equal(iconNameOf("bad name.svg"), undefined);
  assert.equal(iconRatio(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 20">'), ".svg"), 3.2);
  assert.equal(iconRatio(Buffer.from('<svg width="30px" height="10px">'), ".svg"), 3);
  assert.equal(iconRatio(Buffer.from("<svg>"), ".svg"), 1);
  assert.equal(iconRatio(png(128, 32), ".png"), 4);
});

test("icon pack: manifest, svg preferred over png, only listed files are served", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-icons-"));
  const dir = join(dataDir, "icons", "cs2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "weapon_AK47.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 20"><path d="M0 0h64v20H0z"/></svg>');
  writeFileSync(join(dir, "ak47.png"), png(10, 10));
  writeFileSync(join(dir, "headshot.png"), png(32, 32));
  writeFileSync(join(dir, "readme.txt"), "x");
  writeFileSync(join(dataDir, "secret.svg"), "<svg/>");

  const pack = await scanIconPack(dir);
  assert.deepEqual(pack, { ak47: { file: "weapon_AK47.svg", ratio: 3.2 }, headshot: { file: "headshot.png", ratio: 1 } });
  assert.deepEqual(await scanIconPack(join(dataDir, "missing")), {});

  const app = createApp({ appsDir, dataDir, gsiToken: "g" });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    // 输出页不登录也要能取到（鉴权开着）
    const manifest = await fetch(`${base}/api/icons`);
    assert.equal(manifest.status, 200);
    assert.deepEqual((await manifest.json()).cs2, pack);

    const svg = await fetch(`${base}/icons/cs2/weapon_AK47.svg`);
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");
    assert.equal(svg.headers.get("access-control-allow-origin"), "*");
    assert.match(svg.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.match(await svg.text(), /viewBox="0 0 64 20"/);
    assert.equal((await fetch(`${base}/icons/cs2/headshot.png`)).headers.get("content-type"), "image/png");

    for (const bad of ["readme.txt", "..%2Fsecret.svg", "..%2F..%2Fusers.json", "nope.svg"]) {
      assert.equal((await fetch(`${base}/icons/cs2/${bad}`)).status, 404, bad);
    }
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("CS2 adapter reports grenades in the usual order, two flashbangs counted twice", () => {
  const a = new Cs2Adapter();
  let players: any[] = [];
  for (const { payload } of simulateMatch({ seed: 5, maxRounds: 4 })) {
    const r = a.ingest(payload);
    players = (r?.patch?.extra as any)?.players ?? players;
  }
  const withNades = players.filter((p) => p.grenades?.length);
  assert.ok(withNades.length > 0, "rifle rounds carry utility");
  for (const p of withNades) {
    assert.deepEqual(p.grenades, ["flashbang", "flashbang", "smokegrenade", p.side === "CT" ? "incgrenade" : "molotov"]);
  }
});
