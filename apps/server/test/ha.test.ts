import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppState, Cs2Extra, NodeStatus } from "@livecg/shared";
import { createApp } from "../src/app.ts";
import { Cs2Adapter } from "../src/adapters/cs2-gsi.ts";
import { simulateMatch } from "../src/sim/cs2-sim.ts";

const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOKEN = "replication-secret-123456";
const PW = "admin-pass-123";

const freePort = () => new Promise<number>((r) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port;
    s.close(() => r(port));
  });
});

async function until<T>(fn: () => Promise<T> | T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timeout; last value: ${JSON.stringify(v)?.slice(0, 300)}`);
    await sleep(50);
  }
}

/** 一个节点：固定端口，可关闭后用同一数据目录重启 */
function node(role: "primary" | "backup", port: number, peerPort: number, dataDir: string) {
  let app: ReturnType<typeof createApp> | undefined;
  let cookie = "";
  const base = `http://127.0.0.1:${port}`;
  const api = async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return {
    base,
    api,
    get app() { return app!; },
    async up() {
      app = createApp({ appsDir, dataDir, gsiToken: "g", auth: { enabled: true, initialAdminPassword: PW }, ha: { peerUrl: `http://127.0.0.1:${peerPort}`, token: TOKEN, role } });
      await app.listen(port);
      await app.ha.start();
    },
    async login() {
      const r = await fetch(base + "/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: PW }) });
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    },
    status: async () => (await api("/api/ha/status")).body as NodeStatus,
    state: async (room = "default") => (await api(`/api/rooms/${room}/state`)).body as AppState,
    async down() {
      await app?.close();
      app = undefined;
    },
  };
}

test("primary/backup: mirror, refuse writes on standby, fail over, rejoin as standby, hand back", async () => {
  const [pa, pb] = [await freePort(), await freePort()];
  const da = mkdtempSync(join(tmpdir(), "livecg-ha-a-"));
  const db = mkdtempSync(join(tmpdir(), "livecg-ha-b-"));
  const A = node("primary", pa, pb, da);
  const B = node("backup", pb, pa, db);
  const log = console.log;
  const warn = console.warn;
  console.log = console.warn = () => {};
  try {
    await A.up();
    await B.up();
    await A.login();
    await B.login(); // 账号已从主机同步（初始密码相同，也验证了 B 用同步来的账号能登录）
    assert.equal((await A.status()).role, "active");
    await until(B.status, (s) => s.role === "standby" && !!s.link?.connected);

    // ── 镜像 ──
    await A.api("/api/rooms", "POST", { name: "二号场", id: "court-2" });
    await A.api("/api/rooms/court-2/command", "POST", { type: "graphic.show", layer: "lt", template: "lower-third", data: { title: "主机上屏" } });
    await A.api("/api/users", "POST", { username: "op", password: "op-initial-1", role: "operator" });
    const mirrored = await until(() => B.state("court-2"), (s) => s?.layers?.lt?.data?.title === "主机上屏");
    const takeA = (await A.state("court-2")).layers.lt.takeId;
    assert.equal(mirrored.layers.lt.takeId, takeA, "same takeId on both nodes → no re-animation after failover");
    await until(() => B.api("/api/users"), (r) => r.status === 200 && r.body.some((u: { username: string }) => u.username === "op"));

    // ── 备机只读 ──
    const w = await B.api("/api/rooms/court-2/command", "POST", { type: "graphic.clearAll" });
    assert.equal(w.status, 409);
    assert.match(w.body.error, /备机/);
    assert.equal((await B.api("/api/rooms", "POST", { name: "x" })).status, 409);
    assert.equal((await B.api("/api/users", "POST", { username: "y", password: "whatever-123", role: "viewer" })).status, 409);
    // CS2 数据发到备机：接受但不处理（可以同时发给主备两台）
    const gsi = await fetch(`${B.base}/gsi/cs2/court-2`, { method: "POST", body: JSON.stringify({ auth: { token: "g" }, map: { name: "de_x", round: 0, team_ct: { score: 9 }, team_t: { score: 0 } }, round: { phase: "live" } }) });
    assert.equal(gsi.status, 200);
    await sleep(100);
    assert.notEqual((await B.state("court-2")).match.sport, "cs2");

    // ── 主机宕机 → 备机接管 ──
    await A.down();
    await until(B.status, (s) => s.link?.connected === false);
    const p = await B.api("/api/ha/promote", "POST");
    assert.equal(p.status, 200);
    assert.equal(p.body.peerDemoted, false, "peer unreachable → failover");
    assert.equal((await B.status()).role, "active");
    assert.equal((await B.api("/api/rooms/court-2/command", "POST", { type: "graphic.show", layer: "lt", template: "lower-third", data: { title: "备机接管后" } })).status, 200);
    assert.ok((await B.state("court-2")).layers.lt.takeId > takeA, "new takes after promotion never reuse a mirrored takeId");

    // ── 原主机恢复：发现对端已是主机 → 自动以备机身份启动并同步 ──
    await A.up();
    assert.equal((await A.status()).role, "standby", "no split brain when the old primary comes back");
    await A.login();
    await until(() => A.state("court-2"), (s) => s?.layers?.lt?.data?.title === "备机接管后");

    // ── 计划内倒换：B 交还给 A ──
    const h = await B.api("/api/ha/handover", "POST");
    assert.equal(h.status, 200);
    await until(A.status, (s) => s.role === "active");
    await until(B.status, (s) => s.role === "standby" && !!s.link?.connected);
    assert.equal((await A.api("/api/rooms/court-2/command", "POST", { type: "graphic.hide", layer: "lt" })).status, 200);
    await until(() => B.state("court-2"), (s) => s?.layers?.lt?.visible === false);

    // 房间删除同样镜像
    await A.api("/api/rooms/court-2", "DELETE");
    await until(() => B.api("/api/rooms/court-2/state"), (r) => r.status === 404);
  } finally {
    await A.down().catch(() => {});
    await B.down().catch(() => {});
    console.log = log;
    console.warn = warn;
    rmSync(da, { recursive: true, force: true });
    rmSync(db, { recursive: true, force: true });
  }
});

test("replication endpoint rejects a wrong token", async () => {
  const [pa, pb] = [await freePort(), await freePort()];
  const da = mkdtempSync(join(tmpdir(), "livecg-ha-a-"));
  const A = node("primary", pa, pb, da);
  const log = console.log;
  console.log = () => {};
  try {
    await A.up();
    const r = await fetch(`${A.base}/api/ha/promote`, { method: "POST", headers: { authorization: "Bearer wrong-token-xxxxxxxx" } });
    assert.equal(r.status, 401);
    const { default: WebSocket } = await import("ws");
    const code = await new Promise<number>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${pa}/ha`, { headers: { authorization: "Bearer nope" } });
      ws.on("error", () => res(401));
      ws.on("open", () => res(200));
    });
    assert.equal(code, 401);
  } finally {
    await A.down();
    console.log = log;
    rmSync(da, { recursive: true, force: true });
  }
});

test("CS2 adapter state survives promotion: mapping stays correct in the second half", () => {
  const frames = [...simulateMatch({ seed: 5 })].map((f) => f.payload);
  const alpha = (p: any) => (p.map.team_ct.name === "Alpha" ? p.map.team_ct.score : p.map.team_t.score);
  const a = new Cs2Adapter();
  // 主机跑到下半场中段
  const cut = frames.findIndex((p) => p.map.round >= 15);
  let last: any;
  for (const p of frames.slice(0, cut)) last = a.ingest(p);
  const extra = last.patch.extra as Cs2Extra;
  assert.equal(extra.sides.home, "T", "Alpha (home) is on T in the second half");
  // 备机接管：新适配器从镜像状态恢复
  const b = new Cs2Adapter();
  b.restore(extra);
  for (const p of frames.slice(cut)) assert.equal(b.ingest(p)!.patch.home?.score, alpha(p));
  // 对照：不恢复的适配器在没有阵容数据时会猜错
  const naive = new Cs2Adapter();
  const r = naive.ingest({ ...frames[cut], allplayers: undefined })!;
  assert.notEqual(r.patch.home?.score, alpha(frames[cut]), "without restore the first frame maps CT to home — wrong in the second half");
});
