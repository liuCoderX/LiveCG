import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { AuditEntry, Me, ServerMessage } from "@livecg/shared";
import { createApp, WS_UNAUTHORIZED } from "../src/app.ts";
import { hashPassword, verifyPassword } from "../src/auth/auth.ts";

const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ADMIN_PW = "admin-pass-123";

type Ctx = { base: string; port: number; dataDir: string; app: ReturnType<typeof createApp> };
async function withApp(fn: (ctx: Ctx) => Promise<void>, extra: { outputToken?: string; dataDir?: string; keep?: boolean } = {}) {
  const dataDir = extra.dataDir ?? mkdtempSync(join(tmpdir(), "livecg-auth-"));
  const app = createApp({ appsDir, dataDir, gsiToken: "g", auth: { enabled: true, initialAdminPassword: ADMIN_PW, outputToken: extra.outputToken } });
  const port = await app.listen(0);
  try {
    await fn({ base: `http://127.0.0.1:${port}`, port, dataDir, app });
  } finally {
    await app.close();
    if (!extra.keep) rmSync(dataDir, { recursive: true, force: true });
  }
}

/** 简易浏览器：记住 Cookie */
function agent(base: string) {
  let cookie = "";
  const req = async (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return {
    req,
    get cookie() { return cookie; },
    login: (username: string, password: string) => req("/api/auth/login", "POST", { username, password }),
  };
}

function ws(port: number, room = "default", headers: Record<string, string> = {}, query = "") {
  const sock = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}${query}`, { headers });
  const errors: string[] = [];
  let closed: number | undefined;
  sock.on("message", (raw) => {
    const m = JSON.parse(raw.toString()) as ServerMessage;
    if (m.type === "error") errors.push(m.message);
  });
  sock.on("close", (code) => (closed = code));
  return {
    sock,
    errors,
    get closed() { return closed; },
    open: () => new Promise<void>((r, j) => { sock.once("open", () => r()); sock.once("error", j); }),
    send: (m: unknown) => sock.send(JSON.stringify(m)),
  };
}

test("password hashing round-trips and rejects wrong passwords", () => {
  const h = hashPassword("correct horse");
  assert.ok(h.startsWith("scrypt$"));
  assert.ok(verifyPassword("correct horse", h));
  assert.ok(!verifyPassword("wrong horse", h));
  assert.notEqual(hashPassword("x"), hashPassword("x"), "salted");
});

test("anonymous requests are rejected; login sets an HttpOnly session cookie; logout clears it", async () => {
  await withApp(async ({ base }) => {
    const a = agent(base);
    assert.equal((await a.req("/api/rooms")).status, 401);
    assert.equal((await a.req("/api/state")).status, 401);
    assert.equal((await a.req("/api/command", "POST", { type: "graphic.clearAll" })).status, 401);
    assert.equal((await a.req("/api/presets")).status, 200, "public endpoints stay public");

    const r = await fetch(base + "/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: ADMIN_PW }) });
    const set = r.headers.get("set-cookie")!;
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Lax/);

    assert.equal((await a.login("admin", ADMIN_PW)).status, 200);
    const me = (await a.req("/api/auth/me")).body as Me;
    assert.equal(me.user.role, "admin");
    assert.equal(me.user.mustChangePassword, false, "env-provided admin password does not force a change");
    assert.equal((await a.req("/api/rooms")).status, 200);
    await a.req("/api/auth/logout", "POST");
    assert.equal((await a.req("/api/rooms")).status, 401);
  });
});

test("wrong passwords are rate limited", async () => {
  await withApp(async ({ base }) => {
    const a = agent(base);
    for (let i = 0; i < 5; i++) assert.equal((await a.login("admin", "nope")).status, 401);
    const locked = await a.login("admin", ADMIN_PW);
    assert.equal(locked.status, 429, "locked even with the right password");
    assert.match(locked.body.error, /秒后再试/);
  });
});

test("new users must change their password before doing anything else", async () => {
  await withApp(async ({ base }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    assert.equal((await admin.req("/api/users", "POST", { username: "op", password: "short", role: "operator" })).status, 400);
    assert.equal((await admin.req("/api/users", "POST", { username: "op", password: "op-initial-1", role: "operator" })).status, 201);

    const op = agent(base);
    await op.login("op", "op-initial-1");
    assert.equal(((await op.req("/api/auth/me")).body as Me).user.mustChangePassword, true);
    assert.equal((await op.req("/api/rooms")).status, 403);
    assert.equal((await op.req("/api/auth/password", "POST", { current: "bad", next: "op-new-pass-1" })).status, 403);
    assert.equal((await op.req("/api/auth/password", "POST", { current: "op-initial-1", next: "op-new-pass-1" })).status, 200);
    assert.equal((await op.req("/api/rooms")).status, 200);
  });
});

test("roles: viewer is read-only, operator cannot touch devices or rooms, room scope is enforced", async () => {
  await withApp(async ({ base, port }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    await admin.req("/api/rooms", "POST", { name: "B", id: "b" });
    await admin.req("/api/users", "POST", { username: "op", password: "op-initial-1", role: "operator", rooms: ["b"] });
    await admin.req("/api/users", "POST", { username: "vw", password: "vw-initial-1", role: "viewer" });

    const op = agent(base);
    await op.login("op", "op-initial-1");
    await op.req("/api/auth/password", "POST", { current: "op-initial-1", next: "op-pass-final" });
    assert.deepEqual(((await op.req("/api/rooms")).body as Array<{ id: string }>).map((r) => r.id), ["b"], "operator only sees rooms in scope");
    assert.equal((await op.req("/api/rooms/b/command", "POST", { type: "graphic.show", layer: "lt", template: "lower-third" })).status, 200);
    assert.equal((await op.req("/api/rooms/b/command", "POST", { type: "config.set", patch: { cs2DelayMs: 1000 } })).status, 200, "non-device config is fine");
    const dev = await op.req("/api/rooms/b/command", "POST", { type: "config.set", patch: { casparcg: { enabled: true } } });
    assert.equal(dev.status, 403);
    assert.match(dev.body.error, /管理员/);
    assert.equal((await op.req("/api/rooms/default/command", "POST", { type: "graphic.clearAll" })).status, 403, "room out of scope");
    assert.equal((await op.req("/api/rooms/default/state")).status, 403);
    assert.equal((await op.req("/api/rooms", "POST", { name: "x" })).status, 403);
    assert.equal((await op.req("/api/users")).status, 403);
    assert.equal((await op.req("/api/audit")).status, 403);

    const vw = agent(base);
    await vw.login("vw", "vw-initial-1");
    await vw.req("/api/auth/password", "POST", { current: "vw-initial-1", next: "vw-pass-final" });
    assert.equal((await vw.req("/api/rooms/default/state")).status, 200);
    assert.equal((await vw.req("/api/rooms/default/command", "POST", { type: "graphic.clearAll" })).status, 403);

    // WebSocket：viewer 的指令被拒绝
    const c = ws(port, "default", { cookie: vw.cookie });
    await c.open();
    c.send({ type: "graphic.show", layer: "lt", template: "lower-third" });
    await sleep(100);
    assert.match(c.errors[0] ?? "", /只读/);
    c.sock.close();
  });
});

test("demoting a user takes effect on an already-open websocket", async () => {
  await withApp(async ({ base, port }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    await admin.req("/api/users", "POST", { username: "op", password: "op-initial-1", role: "operator" });
    const op = agent(base);
    await op.login("op", "op-initial-1");
    await op.req("/api/auth/password", "POST", { current: "op-initial-1", next: "op-pass-final" });
    const c = ws(port, "default", { cookie: op.cookie });
    await c.open();
    c.send({ type: "match.patch", patch: { home: { score: 1 } } });
    await sleep(100);
    assert.equal(c.errors.length, 0);
    await admin.req("/api/users/op", "PATCH", { role: "viewer" });
    c.send({ type: "match.patch", patch: { home: { score: 2 } } });
    await sleep(100);
    assert.equal(c.errors.length, 1, "role change kills the session → command refused");
    const s = (await admin.req("/api/state")).body;
    assert.equal(s.match.home.score, 1);
    c.sock.close();
  });
});

test("API tokens: bearer auth works, is scoped to the user, can be revoked", async () => {
  await withApp(async ({ base }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    const created = await admin.req("/api/auth/tokens", "POST", { label: "Stream Deck" });
    assert.equal(created.status, 201);
    const token = created.body.token as string;
    assert.match(token, /^lcg_/);
    const bearer = { authorization: `Bearer ${token}` };
    const r = await fetch(`${base}/api/rooms/default/command`, { method: "POST", headers: bearer, body: JSON.stringify({ type: "graphic.clearAll" }) });
    assert.equal(r.status, 200);
    const me = (await admin.req("/api/auth/me")).body as Me;
    assert.equal(me.user.tokens[0].label, "Stream Deck");
    assert.ok(!JSON.stringify(me).includes(token), "plaintext token is never returned again");
    // 令牌不能用来再创建令牌（防止泄露的令牌自我续命）
    const r2 = await fetch(`${base}/api/auth/tokens`, { method: "POST", headers: bearer, body: JSON.stringify({ label: "x" }) });
    assert.equal(r2.status, 403);
    await admin.req(`/api/auth/tokens/${created.body.id}`, "DELETE");
    const r3 = await fetch(`${base}/api/rooms/default/command`, { method: "POST", headers: bearer, body: JSON.stringify({ type: "graphic.clearAll" }) });
    assert.equal(r3.status, 401);
    const r4 = await fetch(`${base}/api/rooms`, { headers: { authorization: "Bearer lcg_forged" } });
    assert.equal(r4.status, 401);
  });
});

test("user management guards: last admin, self-delete, duplicate names", async () => {
  await withApp(async ({ base }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    assert.equal((await admin.req("/api/users/admin", "PATCH", { role: "operator" })).status, 409);
    assert.equal((await admin.req("/api/users/admin", "DELETE")).status, 400);
    assert.equal((await admin.req("/api/users", "POST", { username: "Admin", password: "whatever-123", role: "viewer" })).status, 409, "case-insensitive");
    assert.equal((await admin.req("/api/users", "POST", { username: "x y", password: "whatever-123", role: "viewer" })).status, 400);
    assert.equal((await admin.req("/api/users", "POST", { username: "boss", password: "whatever-123", role: "god" })).status, 400);
  });
});

test("output pages: anonymous websocket is read-only; with an output token configured it must be supplied", async () => {
  await withApp(async ({ port }) => {
    const anon = ws(port);
    await anon.open();
    anon.send({ type: "graphic.clearAll" });
    await sleep(100);
    assert.match(anon.errors[0] ?? "", /未登录/);
    anon.sock.close();
  });
  await withApp(async ({ port }) => {
    const denied = ws(port);
    await sleep(150);
    assert.equal(denied.closed, WS_UNAUTHORIZED);
    const ok = ws(port, "default", {}, "&token=out-secret");
    await ok.open();
    assert.equal(ok.closed, undefined);
    ok.sock.close();
  }, { outputToken: "out-secret" });
});

test("cross-origin websocket does not get the session's permissions", async () => {
  await withApp(async ({ base, port }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    const evil = ws(port, "default", { cookie: admin.cookie, origin: "http://evil.example" });
    await evil.open();
    evil.send({ type: "graphic.clearAll" });
    await sleep(100);
    assert.match(evil.errors[0] ?? "", /未登录/);
    evil.sock.close();
    const r = await fetch(`${base}/api/rooms/default/command`, { method: "POST", headers: { cookie: admin.cookie, origin: "http://evil.example" }, body: JSON.stringify({ type: "graphic.clearAll" }) });
    assert.equal(r.status, 401, "cross-origin POST with cookie is treated as anonymous");
  });
});

test("audit log records commands, denials and logins, and is queryable by admins", async () => {
  await withApp(async ({ base, dataDir }) => {
    const admin = agent(base);
    await admin.login("admin", ADMIN_PW);
    await admin.login("admin", "wrong");
    await admin.req("/api/rooms/default/command", "POST", { type: "graphic.show", layer: "lt", template: "lower-third", data: { title: "审计我" } });
    await admin.req("/api/rooms/default/command", "POST", { type: "config.set", patch: { scoreboard: { enabled: true, port: 1 } } });
    const all = (await admin.req("/api/audit")).body as AuditEntry[];
    assert.ok(all.length >= 4);
    assert.equal(all[0].action, "config.set", "newest first");
    const show = all.find((e) => e.action === "graphic.show")!;
    assert.equal(show.user, "admin");
    assert.equal(show.room, "default");
    assert.equal(show.via, "session");
    assert.ok(JSON.stringify(show.detail).includes("审计我"));
    assert.ok(all.some((e) => e.action === "auth.login" && !e.ok));
    const filtered = (await admin.req("/api/audit?action=auth.")).body as AuditEntry[];
    assert.ok(filtered.every((e) => e.action.startsWith("auth.")));
    const files = readdirSync(join(dataDir, "audit"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
    assert.ok(readFileSync(join(dataDir, "audit", files[0]), "utf8").includes("graphic.show"));
  });
});

test("sessions survive a server restart; users file never contains plaintext passwords", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-auth-"));
  let cookie = "";
  try {
    await withApp(async ({ base }) => {
      const a = agent(base);
      await a.login("admin", ADMIN_PW);
      cookie = a.cookie;
    }, { dataDir, keep: true });
    assert.ok(!readFileSync(join(dataDir, "users.json"), "utf8").includes(ADMIN_PW));
    assert.ok(!readFileSync(join(dataDir, "sessions.json"), "utf8").includes(cookie.split("=")[1]), "only session hashes are stored");
    await withApp(async ({ base }) => {
      const r = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
      assert.equal(r.status, 200);
    }, { dataDir, keep: true });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("first start without a configured password generates one, writes it to a 0600 file and forces a change", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "livecg-auth-"));
  const log = console.log;
  console.log = () => {};
  try {
    const app = createApp({ appsDir, dataDir, gsiToken: "g", auth: { enabled: true } });
    const port = await app.listen(0);
    const file = join(dataDir, "initial-admin-password.txt");
    assert.ok(existsSync(file));
    const pw = /密码：(\S+)/.exec(readFileSync(file, "utf8"))![1];
    const a = agent(`http://127.0.0.1:${port}`);
    assert.equal((await a.login("admin", pw)).status, 200);
    assert.equal(((await a.req("/api/auth/me")).body as Me).user.mustChangePassword, true);
    await app.close();
  } finally {
    console.log = log;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
