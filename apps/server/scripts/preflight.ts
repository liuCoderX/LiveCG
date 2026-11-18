/**
 * 开播前自检：pnpm preflight（不能叫 doctor：pnpm 自带同名命令，会抢先执行它自己的检查）
 *
 * 在 LiveCG 服务器上运行（服务开着或关着都可以），检查版本、构建、配置、主备对端、
 * CasparCG 连通性以及常见的配错。✗ 为必须处理的问题（退出码 1），⚠ 为建议处理。
 * 只读：不修改任何配置和数据。
 */
import { existsSync, readdirSync, readFileSync, accessSync, constants } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadEnvFile } from "../src/env.ts";
import { CORE_ICON_NAMES, scanIconPack } from "../src/icons.ts";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const envFile = process.env.LIVECG_ENV_FILE ?? join(repoRoot, ".env");
const fromFile = loadEnvFile(envFile);
const env = process.env;

let errors = 0;
let warnings = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => { warnings++; console.log(`  ⚠ ${msg}`); };
const fail = (msg: string) => { errors++; console.log(`  ✗ ${msg}`); };
const section = (title: string) => console.log(`\n${title}`);

const tcpCheck = (host: string, port: number, ms = 2000) =>
  new Promise<string | undefined>((res) => {
    const sock = connect({ host, port });
    const done = (err?: string) => { sock.destroy(); res(err); };
    sock.setTimeout(ms, () => done("超时"));
    sock.once("connect", () => done());
    sock.once("error", (e) => done(e.message));
  });

const httpJson = async (url: string, headers: Record<string, string> = {}) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    return { status: r.status, body: await r.json().catch(() => null) };
  } finally {
    clearTimeout(t);
  }
};

const isLocal = (host: string) => /^(localhost|127\.|0\.0\.0\.0|::1$)/.test(host);

// ───────────── 运行环境 ─────────────
section("运行环境");
const major = Number(process.versions.node.split(".")[0]);
major >= 22 ? ok(`Node.js ${process.version}`) : fail(`Node.js ${process.version}，需要 22 或更新`);
existsSync(join(repoRoot, "apps/control/dist/index.html"))
  ? ok("控制台已构建（apps/control/dist）")
  : fail("控制台尚未构建：在项目根目录运行 pnpm build");

// ───────────── 配置 ─────────────
section("配置");
if (existsSync(envFile)) ok(`读取 ${envFile}${fromFile.length ? `（${fromFile.length} 项）` : "（全部已由环境变量提供）"}`);
else warn(`没有 ${envFile}：配置只能来自环境变量`);

const port = Number(env.PORT || 3000);
const dataDir = env.LIVECG_DATA_DIR || join(repoRoot, "data", "runtime");
ok(`端口 ${port}，数据目录 ${dataDir}`);

if (env.LIVECG_AUTH === "off") fail("LIVECG_AUTH=off：鉴权已关闭，任何人都有管理员权限，播出环境必须去掉");
if (!env.CS2_GSI_TOKEN || env.CS2_GSI_TOKEN === "change-me") warn("CS2_GSI_TOKEN 仍是默认值 change-me，建议改成随机字符串（CS2 cfg 里同步修改）");
if (env.LIVECG_ADMIN_PASSWORD && env.LIVECG_ADMIN_PASSWORD.length < 8) warn("LIVECG_ADMIN_PASSWORD 少于 8 位");
if (env.LIVECG_CS2_CAPTURE === "1") warn("LIVECG_CS2_CAPTURE=1：正在录制 CS2 原始数据，正式播出时建议关闭（文件增长很快）");

if (existsSync(dataDir)) {
  try {
    accessSync(dataDir, constants.W_OK);
    ok("数据目录可写");
  } catch {
    fail(`数据目录不可写：${dataDir}`);
  }
  if (existsSync(join(dataDir, "initial-admin-password.txt"))) warn("initial-admin-password.txt 还在：登录并修改初始密码后请删除");
} else {
  ok("数据目录尚不存在（首次启动时创建）");
}

// ───────────── 服务 ─────────────
section("服务");
let running = false;
try {
  const r = await httpJson(`http://127.0.0.1:${port}/api/presets`);
  running = r.status === 200;
} catch { /* 未运行 */ }
running ? ok(`LiveCG 正在运行（端口 ${port}）`) : warn(`本机端口 ${port} 上没有运行 LiveCG`);

// ───────────── 主备 ─────────────
section("主备");
if (!env.LIVECG_PEER_URL) {
  ok("未配置主备（单机）");
} else {
  const token = env.LIVECG_REPLICATION_TOKEN ?? "";
  if (token.length < 16) fail("LIVECG_REPLICATION_TOKEN 少于 16 位（服务会拒绝启动）");
  if (env.LIVECG_ROLE !== "primary" && env.LIVECG_ROLE !== "backup") warn(`LIVECG_ROLE=${env.LIVECG_ROLE ?? "（未设置）"}，应为 primary 或 backup（未设置时按 primary）`);
  let peerHost = "";
  try {
    peerHost = new URL(env.LIVECG_PEER_URL).hostname;
  } catch {
    fail(`LIVECG_PEER_URL 不是合法地址：${env.LIVECG_PEER_URL}`);
  }
  if (peerHost && isLocal(peerHost)) warn(`对端地址是本机（${peerHost}）：两台机器应互相填对方的局域网地址`);
  if (peerHost) {
    try {
      const r = await httpJson(`${env.LIVECG_PEER_URL.replace(/\/+$/, "")}/api/ha/status`, { authorization: `Bearer ${token}` });
      if (r.status === 401) fail(`对端 ${env.LIVECG_PEER_URL} 拒绝了复制令牌：两台的 LIVECG_REPLICATION_TOKEN 必须相同`);
      else if (r.status === 200) ok(`对端 ${env.LIVECG_PEER_URL} 在线，角色：${r.body?.role === "active" ? "主机" : "备机"}`);
      else warn(`对端返回 HTTP ${r.status}`);
    } catch (err) {
      warn(`连不上对端 ${env.LIVECG_PEER_URL}（${(err as Error).message}）：对端未启动，或网络 / 防火墙未放行`);
    }
  }
  if (running) {
    try {
      const r = await httpJson(`http://127.0.0.1:${port}/api/ha/status`, { authorization: `Bearer ${token}` });
      if (r.status === 200) ok(`本机角色：${r.body?.role === "active" ? "主机" : "备机"}${r.body?.conflict ? "（⚠ 双主告警）" : ""}`);
      if (r.body?.conflict) fail("两台都处于主机状态：请立即在不该播出的那台上降为备机");
    } catch { /* ignore */ }
  }
}

// ───────────── 房间与设备 ─────────────
section("房间与设备");
const roomsDir = join(dataDir, "rooms");
const roomFiles = existsSync(roomsDir) ? readdirSync(roomsDir).filter((f) => /^[a-z0-9][a-z0-9-]*\.json$/.test(f)) : [];
if (!roomFiles.length) ok("还没有房间配置（首次启动后会创建默认房间）");
const udpPorts = new Map<number, string>();
for (const f of roomFiles) {
  const id = f.slice(0, -5);
  let data: any;
  try {
    data = JSON.parse(readFileSync(join(roomsDir, f), "utf8"));
  } catch {
    fail(`房间 ${id}：配置文件损坏（${f}）`);
    continue;
  }
  const name = data.name ? `「${data.name}」` : ` ${id} `;
  const cg = data.config?.casparcg;
  if (cg?.enabled) {
    const outputs = (cg.outputs ?? []).filter((o: any) => o.enabled).map((o: any) => `${o.label} ${o.channel}-${o.layer}`).join("，") || "无启用的输出";
    const err = await tcpCheck(cg.host, cg.port);
    err ? fail(`房间${name}：连不上 CasparCG ${cg.host}:${cg.port}（${err}）`) : ok(`房间${name}：CasparCG ${cg.host}:${cg.port} 可连接（${outputs}）`);
    let base = "";
    try { base = new URL(cg.baseUrl).hostname; } catch { fail(`房间${name}：「LiveCG 地址」不是合法地址：${cg.baseUrl}`); }
    // 最常见的配错：CasparCG 在另一台机器上，却让它去访问 localhost
    if (base && isLocal(base) && !isLocal(cg.host)) fail(`房间${name}：「LiveCG 地址」是 ${cg.baseUrl}，但 CasparCG 在 ${cg.host}——CasparCG 会去访问它自己，加载不到画面。请改成本机的局域网地址`);
  }
  const sb = data.config?.scoreboard;
  if (sb?.enabled) {
    if (udpPorts.has(sb.port)) fail(`房间${name} 与 ${udpPorts.get(sb.port)} 使用同一个计分器 UDP 端口 ${sb.port}`);
    udpPorts.set(sb.port, name);
    ok(`房间${name}：计分器 UDP ${sb.port}（时钟来源：${sb.clockSource === "scoreboard" ? "计分器" : "内部时钟"}）`);
  }
}

// ───────────── 字体（仅本机） ─────────────
section("字体（本机；播出机需各自确认）");
try {
  const out = execFileSync("fc-list", [":lang=zh", "family"], { encoding: "utf8", timeout: 3000 });
  const families = [...new Set(out.split("\n").flatMap((l) => l.split(",")).map((s) => s.trim().replace(/\\/g, "")).filter(Boolean))];
  const preferred = families.filter((f) => /HarmonyOS Sans SC|Noto Sans SC|Noto Sans CJK SC|Source Han Sans SC/i.test(f));
  if (preferred.length) ok(`已安装：${preferred.slice(0, 4).join("，")}`);
  else if (families.length) warn(`没有 HarmonyOS Sans SC / Noto Sans SC，输出页会用系统字体（现有：${families.slice(0, 3).join("，")}…）`);
  else warn("没有找到中文字体");
} catch {
  console.log("  · 本机没有 fc-list（Windows / macOS 请在系统字体设置里确认）");
}

section("CS2 图标包（游戏原版图标）");
{
  const iconDir = join(dataDir, "icons", "cs2");
  const pack = await scanIconPack(iconDir);
  const have = Object.keys(pack);
  if (!have.length) {
    warn(`${iconDir} 里没有图标：武器显示为文字、其它用内置图标。从游戏导出后用 pnpm icons:import <导出目录> 导入，步骤见 docs/ICONS-CS2.md`);
  } else {
    const missing = CORE_ICON_NAMES.filter((n) => !pack[n]);
    ok(`${have.length} 个图标`);
    if (missing.length) warn(`缺少 ${missing.length} 个常用图标（会显示为文字 / 内置图标）：${missing.join("、")}`);
    else ok("常用武器、道具、爆头、C4、拆弹器都齐了");
    const odd = have.filter((n) => pack[n].ratio === 1 && !/^(headshot|elimination|bomb|defuse|time|c4|defuser|armor|armor_helmet|hegrenade|flashbang|smokegrenade|molotov|incgrenade|decoy)$/.test(n));
    if (odd.length) warn(`这些武器图标读不出宽高比（会按正方形显示）：${odd.slice(0, 8).join("、")}`);
  }
}

console.log(`\n结果：${errors} 个问题，${warnings} 个提醒`);
process.exit(errors ? 1 : 0);
