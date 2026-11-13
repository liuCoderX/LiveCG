import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Role, UserInfo } from "@livecg/shared";

/**
 * 账号、会话与 API 令牌。
 *
 * - 密码：scrypt（随机盐）哈希保存，比较用 timingSafeEqual
 * - 会话：浏览器 Cookie 里是 32 字节随机 id，服务端只保存其 SHA-256，落盘后重启不掉登录
 * - API 令牌：给 Stream Deck / Companion / 脚本用，`lcg_` 前缀 + 24 字节随机数，只保存 SHA-256，明文只在创建时显示一次
 */

export interface StoredToken {
  id: string;
  label: string;
  hash: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface StoredUser {
  username: string;
  role: Role;
  /** "*" = 所有房间 */
  rooms: "*" | string[];
  passwordHash: string;
  mustChangePassword?: boolean;
  createdAt: number;
  tokens: StoredToken[];
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;
const MIN_PASSWORD = 8;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** 用户不存在时用来「陪跑」一次哈希的假密码哈希（同算法同长度，避免时间侧信道） */
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

export const publicUser = (u: StoredUser): UserInfo => ({
  username: u.username,
  role: u.role,
  rooms: u.rooms,
  mustChangePassword: !!u.mustChangePassword,
  tokens: u.tokens.map(({ id, label, createdAt, lastUsedAt }) => ({ id, label, createdAt, lastUsedAt })),
});

function writeJson(file: string, data: unknown, secret = false) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: secret ? 0o600 : 0o644 });
  renameSync(`${file}.tmp`, file);
}

const validatePassword = (pw: unknown) => {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw new AuthError(`密码至少 ${MIN_PASSWORD} 位`);
};
const validateRooms = (rooms: unknown): "*" | string[] => {
  if (rooms === "*" || rooms === undefined) return "*";
  if (!Array.isArray(rooms) || rooms.some((r) => typeof r !== "string")) throw new AuthError("房间范围格式错误");
  return [...new Set(rooms as string[])];
};
const validateRole = (role: unknown): Role => {
  if (role !== "admin" && role !== "operator" && role !== "viewer") throw new AuthError("角色只能是 admin / operator / viewer");
  return role;
};

export class UserStore {
  private users: StoredUser[] = [];
  private listeners = new Set<() => void>();

  constructor(private file: string | undefined) {}

  /** 读取账号；没有任何账号时创建初始管理员，返回其明文密码（仅此一次） */
  load(initialPassword?: string): { createdAdmin?: string } {
    if (this.file && existsSync(this.file)) {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      this.users = data.users ?? [];
    }
    if (this.users.length) return {};
    const password = initialPassword || randomBytes(9).toString("base64url");
    this.users.push({
      username: "admin",
      role: "admin",
      rooms: "*",
      passwordHash: hashPassword(password),
      // 自动生成的密码必须在首次登录后修改
      mustChangePassword: !initialPassword,
      createdAt: Date.now(),
      tokens: [],
    });
    this.save();
    return { createdAdmin: password };
  }

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 主备同步用：整体替换（备机镜像主机的账号） */
  replaceAll(users: StoredUser[]) {
    this.users = structuredClone(users);
    this.save(false);
  }

  snapshot(): StoredUser[] {
    return structuredClone(this.users);
  }

  private save(notify = true) {
    if (this.file) writeJson(this.file, { version: 1, users: this.users }, true);
    if (notify) for (const fn of this.listeners) fn();
  }

  get(username: string): StoredUser | undefined {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  }

  list(): StoredUser[] {
    return this.users;
  }

  verify(username: string, password: string): StoredUser | undefined {
    const u = this.get(username);
    // 用户不存在时也做一次哈希，避免用响应时间判断用户名是否存在
    if (!u) {
      verifyPassword(password, DUMMY_HASH);
      return undefined;
    }
    return verifyPassword(password, u.passwordHash) ? u : undefined;
  }

  create(input: { username: unknown; password: unknown; role: unknown; rooms?: unknown }): StoredUser {
    const username = String(input.username ?? "").trim();
    if (!USERNAME_RE.test(username)) throw new AuthError("用户名为 2–32 位字母、数字、下划线、点或连字符");
    if (this.get(username)) throw new AuthError(`用户已存在：${username}`, 409);
    validatePassword(input.password);
    const user: StoredUser = {
      username,
      role: validateRole(input.role),
      rooms: validateRooms(input.rooms),
      passwordHash: hashPassword(input.password as string),
      mustChangePassword: true,
      createdAt: Date.now(),
      tokens: [],
    };
    this.users.push(user);
    this.save();
    return user;
  }

  update(username: string, patch: { role?: unknown; rooms?: unknown; password?: unknown }): StoredUser {
    const u = this.require(username);
    if (patch.role !== undefined) {
      const role = validateRole(patch.role);
      if (u.role === "admin" && role !== "admin") this.assertNotLastAdmin(u);
      u.role = role;
    }
    if (patch.rooms !== undefined) u.rooms = validateRooms(patch.rooms);
    if (patch.password !== undefined) {
      validatePassword(patch.password);
      u.passwordHash = hashPassword(patch.password as string);
      // 管理员重置的密码需本人登录后修改
      u.mustChangePassword = true;
    }
    this.save();
    return u;
  }

  changeOwnPassword(username: string, current: string, next: string) {
    const u = this.require(username);
    if (!verifyPassword(String(current ?? ""), u.passwordHash)) throw new AuthError("当前密码不正确", 403);
    validatePassword(next);
    if (next === current) throw new AuthError("新密码不能与当前密码相同");
    u.passwordHash = hashPassword(next);
    u.mustChangePassword = false;
    this.save();
  }

  delete(username: string) {
    const u = this.require(username);
    if (u.role === "admin") this.assertNotLastAdmin(u);
    this.users = this.users.filter((x) => x !== u);
    this.save();
  }

  createToken(username: string, label: unknown): { token: string; info: StoredToken } {
    const u = this.require(username);
    const name = String(label ?? "").trim() || "API 令牌";
    if (name.length > 40) throw new AuthError("令牌名称不能超过 40 个字符");
    const token = `lcg_${randomBytes(24).toString("base64url")}`;
    const info: StoredToken = { id: randomBytes(6).toString("hex"), label: name, hash: sha256(token), createdAt: Date.now() };
    u.tokens.push(info);
    this.save();
    return { token, info };
  }

  revokeToken(username: string, id: string) {
    const u = this.require(username);
    const before = u.tokens.length;
    u.tokens = u.tokens.filter((t) => t.id !== id);
    if (u.tokens.length === before) throw new AuthError("令牌不存在", 404);
    this.save();
  }

  /** Bearer 令牌 → 用户；记录最近使用时间（最多每分钟写一次盘） */
  byToken(token: string): { user: StoredUser; token: StoredToken } | undefined {
    if (!token.startsWith("lcg_")) return undefined;
    const h = sha256(token);
    for (const user of this.users) {
      const t = user.tokens.find((x) => x.hash === h);
      if (t) {
        const now = Date.now();
        if (!t.lastUsedAt || now - t.lastUsedAt > 60_000) {
          t.lastUsedAt = now;
          this.save(false);
        }
        return { user, token: t };
      }
    }
    return undefined;
  }

  private require(username: string): StoredUser {
    const u = this.get(username);
    if (!u) throw new AuthError(`用户不存在：${username}`, 404);
    return u;
  }

  private assertNotLastAdmin(u: StoredUser) {
    if (!this.users.some((x) => x !== u && x.role === "admin")) throw new AuthError("至少要保留一个管理员", 409);
  }
}

// ───────────── 会话 ─────────────

const SESSION_TTL = 24 * 3600_000;

export class SessionStore {
  private sessions = new Map<string, { username: string; expires: number }>();
  private saveTimer?: NodeJS.Timeout;

  constructor(private file: string | undefined) {
    if (file && existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, { username: string; expires: number }>;
        const now = Date.now();
        for (const [k, v] of Object.entries(data)) if (v.expires > now) this.sessions.set(k, v);
      } catch {
        /* 损坏就当没有会话 */
      }
    }
  }

  create(username: string): string {
    const sid = randomBytes(32).toString("base64url");
    this.sessions.set(sha256(sid), { username, expires: Date.now() + SESSION_TTL });
    this.persist(true);
    return sid;
  }

  /** 有效会话 → 用户名；使用时顺延有效期（滑动过期） */
  get(sid: string | undefined): string | undefined {
    if (!sid) return undefined;
    const key = sha256(sid);
    const s = this.sessions.get(key);
    if (!s) return undefined;
    const now = Date.now();
    if (s.expires < now) {
      this.sessions.delete(key);
      this.persist();
      return undefined;
    }
    if (s.expires - now < SESSION_TTL - 60_000) {
      s.expires = now + SESSION_TTL;
      this.persist();
    }
    return s.username;
  }

  destroy(sid: string | undefined) {
    if (sid && this.sessions.delete(sha256(sid))) this.persist(true);
  }

  /** 删除用户或修改密码后，踢掉该用户的其它会话 */
  destroyUser(username: string, except?: string) {
    const keep = except ? sha256(except) : undefined;
    for (const [k, v] of this.sessions) if (v.username.toLowerCase() === username.toLowerCase() && k !== keep) this.sessions.delete(k);
    this.persist(true);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.file) writeJson(this.file, Object.fromEntries(this.sessions), true);
  }

  private persist(now = false) {
    if (!this.file) return;
    if (now) return this.flush();
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.flush(), 5_000);
  }
}

// ───────────── 登录限流 ─────────────

/** 同一 IP + 用户名 5 分钟内失败 5 次，锁定 60 秒 */
export class LoginLimiter {
  private fails = new Map<string, { count: number; first: number; lockedUntil?: number }>();

  check(key: string) {
    const f = this.fails.get(key);
    if (f?.lockedUntil && f.lockedUntil > Date.now()) {
      throw new AuthError(`登录失败次数过多，请 ${Math.ceil((f.lockedUntil - Date.now()) / 1000)} 秒后再试`, 429);
    }
  }

  fail(key: string) {
    const now = Date.now();
    const f = this.fails.get(key);
    if (!f || now - f.first > 5 * 60_000) {
      this.fails.set(key, { count: 1, first: now });
      return;
    }
    f.count++;
    if (f.count >= 5) f.lockedUntil = now + 60_000;
  }

  succeed(key: string) {
    this.fails.delete(key);
  }
}

/** 把初始管理员密码写到数据目录（仅本机可读），并在控制台醒目提示 */
export function announceInitialPassword(dataDir: string | undefined, password: string) {
  const line = "═".repeat(60);
  console.log(`\n${line}\n  已创建初始管理员账号\n  用户名：admin\n  密码：  ${password}\n  首次登录后必须修改密码。\n${line}\n`);
  if (!dataDir) return;
  const file = join(dataDir, "initial-admin-password.txt");
  writeFileSync(file, `用户名：admin\n密码：${password}\n\n首次登录修改密码后请删除本文件。\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows 等不支持 */ }
}
