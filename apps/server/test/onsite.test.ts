import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/env.ts";
import { readCapture } from "../src/capture.ts";
import { createApp } from "../src/app.ts";
import { simulateMatch } from "../src/sim/cs2-sim.ts";
import { Cs2Adapter } from "../src/adapters/cs2-gsi.ts";

const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));

test(".env loading: real environment wins, empty values are ignored, missing file is fine", () => {
  const dir = mkdtempSync(join(tmpdir(), "livecg-env-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, [
      "# 注释",
      "PORT=",
      "CS2_GSI_TOKEN=from-file",
      "LIVECG_ROLE=backup",
      'LIVECG_ADMIN_PASSWORD="quoted pass"',
      "LIVECG_PEER_URL=http://10.0.0.6:3000",
    ].join("\n"));
    const env: NodeJS.ProcessEnv = { LIVECG_ROLE: "primary" };
    const loaded = loadEnvFile(file, env);
    assert.equal(env.PORT, undefined, "empty PORT= must not become an empty string (would bind a random port)");
    assert.equal(env.CS2_GSI_TOKEN, "from-file");
    assert.equal(env.LIVECG_ROLE, "primary", "already-set variables are not overridden");
    assert.equal(env.LIVECG_ADMIN_PASSWORD, "quoted pass");
    assert.deepEqual(loaded.sort(), ["CS2_GSI_TOKEN", "LIVECG_ADMIN_PASSWORD", "LIVECG_PEER_URL"]);
    assert.deepEqual(loadEnvFile(join(dir, "missing.env"), {}), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(".env.example in the repo parses and leaves optional values unset", () => {
  const env: NodeJS.ProcessEnv = {};
  loadEnvFile(resolve(appsDir, "..", ".env.example"), env);
  assert.equal(env.PORT, "3000");
  assert.equal(env.LIVECG_AUTH, undefined, "LIVECG_AUTH= stays unset → auth on");
  assert.equal(env.LIVECG_PEER_URL, undefined, "no peer → single node");
});

test("CS2 capture records authenticated frames without the token, and replays to the same result", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-cap-"));
  const app = createApp({ appsDir, dataDir, gsiToken: "secret-gsi", auth: { enabled: false }, captureCs2: true });
  const port = await app.listen(0);
  try {
    const frames = [...simulateMatch({ seed: 3, maxRounds: 3 })].map((f) => f.payload);
    for (const p of frames) {
      await fetch(`http://127.0.0.1:${port}/gsi/cs2`, { method: "POST", body: JSON.stringify({ ...p, auth: { token: "secret-gsi" } }) });
    }
    // 错误 token 的帧不录
    await fetch(`http://127.0.0.1:${port}/gsi/cs2`, { method: "POST", body: JSON.stringify({ ...frames[0], auth: { token: "wrong" } }) });

    const files = readdirSync(join(dataDir, "captures"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^cs2-default-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const file = join(dataDir, "captures", files[0]);
    assert.ok(!readFileSync(file, "utf8").includes("secret-gsi"), "token never written to disk");

    appendFileSync(file, '{"t": 1, "room": "default", "payl'); // 断电留下的半行
    const captured = readCapture(file);
    assert.equal(captured.length, frames.length, "truncated last line is skipped");
    assert.ok(captured.every((f, i) => i === 0 || f.t >= captured[i - 1].t));

    // 回放录制数据得到的结果与原始数据完全一致（录制无损）
    const a = new Cs2Adapter();
    const b = new Cs2Adapter();
    let ra: any;
    let rb: any;
    for (const p of frames) ra = a.ingest(p);
    for (const f of captured) rb = b.ingest(f.payload);
    assert.deepEqual(rb.patch.extra.roundHistory, ra.patch.extra.roundHistory);
    assert.deepEqual([rb.patch.home.score, rb.patch.away.score], [ra.patch.home.score, ra.patch.away.score]);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("capture is off unless enabled", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-cap-"));
  const app = createApp({ appsDir, dataDir, gsiToken: "g", auth: { enabled: false } });
  const port = await app.listen(0);
  try {
    const p = [...simulateMatch({ seed: 1, maxRounds: 1 })][0].payload;
    await fetch(`http://127.0.0.1:${port}/gsi/cs2`, { method: "POST", body: JSON.stringify({ ...p, auth: { token: "g" } }) });
    assert.ok(!existsSync(join(dataDir, "captures")));
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
