/**
 * 生成 OB 机用的 CS2 GSI 配置文件，uri 和 token 自动填好：
 *
 *   pnpm cs2:cfg                                   # 默认房间，地址取本机局域网 IP
 *   pnpm cs2:cfg --room final --url http://10.0.0.5:3000
 *
 * token 取自 .env 的 CS2_GSI_TOKEN。生成的文件拷到 OB 机 CS2 的 game/csgo/cfg/ 下，重启游戏生效。
 */
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/env.ts";
import { checkCs2CfgOptions, gsiUri, lanAddresses, renderCs2Cfg } from "../src/cs2-cfg.ts";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
loadEnvFile(process.env.LIVECG_ENV_FILE ?? join(repoRoot, ".env"));

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    room: { type: "string" },
    out: { type: "string" },
  },
});

const port = process.env.PORT || "3000";
const ips = lanAddresses();
let url = values.url;
if (!url) {
  if (!ips.length) {
    console.error("✗ 找不到本机局域网 IP，请用 --url http://<LiveCG 服务器 IP>:" + port + " 指定");
    process.exit(1);
  }
  url = `http://${ips[0]}:${port}`;
  if (ips.length > 1) console.log(`⚠ 本机有多个 IP（${ips.join("、")}），用了 ${ips[0]}；OB 机连不到的话用 --url 指定`);
}

const opts = { url, room: values.room, token: process.env.CS2_GSI_TOKEN ?? "" };
const { errors, warns } = checkCs2CfgOptions(opts);
for (const w of warns) console.log(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}

const template = readFileSync(join(repoRoot, "integrations/cs2/gamestate_integration_livecg.cfg"), "utf8");
// pnpm 运行脚本时 cwd 是 apps/server，相对路径按用户所在目录（INIT_CWD）解析
const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out ?? join(repoRoot, "cs2-cfg", "gamestate_integration_livecg.cfg"));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderCs2Cfg(template, opts));

console.log(`✓ 已生成 ${out}`);
console.log(`  uri   ${gsiUri(opts.url, opts.room)}`);
console.log(`  token 与本机 .env 的 CS2_GSI_TOKEN 一致`);
console.log("\n拷到 OB 机：<Steam 库>/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/，然后重启 CS2。");
console.log("OB 机上可先在浏览器打开 " + opts.url + "/ ，能打开说明网络通。");
