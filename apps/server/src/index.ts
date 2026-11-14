import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { loadEnvFile } from "./env.ts";

// 项目根目录的 .env（或 LIVECG_ENV_FILE 指定的文件）；已设置的环境变量优先
const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const envFile = process.env.LIVECG_ENV_FILE ?? join(repoRoot, ".env");
const loadedEnv = loadEnvFile(envFile);
if (loadedEnv.length) console.log(`[livecg] 从 ${envFile} 读取了 ${loadedEnv.length} 个配置：${loadedEnv.join(", ")}`);

const PORT = Number(process.env.PORT ?? 3000);
const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const dataDir = process.env.LIVECG_DATA_DIR ?? join(appsDir, "..", "data", "runtime");

const authEnabled = process.env.LIVECG_AUTH !== "off";
const app = createApp({
  appsDir,
  dataDir,
  gsiToken: process.env.CS2_GSI_TOKEN ?? "change-me",
  auth: {
    enabled: authEnabled,
    initialAdminPassword: process.env.LIVECG_ADMIN_PASSWORD,
    outputToken: process.env.LIVECG_OUTPUT_TOKEN,
  },
  ...(process.env.LIVECG_PEER_URL
    ? {
        ha: {
          peerUrl: process.env.LIVECG_PEER_URL,
          token: process.env.LIVECG_REPLICATION_TOKEN ?? "",
          role: process.env.LIVECG_ROLE === "backup" ? ("backup" as const) : ("primary" as const),
        },
      }
    : {}),
  captureCs2: process.env.LIVECG_CS2_CAPTURE === "1",
});
if (process.env.LIVECG_CS2_CAPTURE === "1") console.log(`[livecg] 正在录制 CS2 原始数据到 ${join(dataDir, "captures")}（联调结束后请关闭）`);
if (process.env.LIVECG_PEER_URL &&(process.env.LIVECG_REPLICATION_TOKEN ?? "").length < 16) {
  console.error("[livecg] 配置了 LIVECG_PEER_URL 时必须设置至少 16 位的 LIVECG_REPLICATION_TOKEN（两台机器相同）");
  process.exit(1);
}
if (!authEnabled) console.warn("[livecg] ⚠ 鉴权已关闭（LIVECG_AUTH=off）：任何能访问本服务的人都有管理员权限，仅限本机开发使用");
const port = await app.listen(PORT);
await app.ha.start();

console.log(`[livecg] server on http://localhost:${port}`);
console.log(`[livecg] rooms         : http://localhost:${port}/control/rooms.html  (${app.rooms.ids().join(", ")})`);
console.log(`[livecg] control panel : http://localhost:${port}/control/?room=<房间>`);
console.log(`[livecg] graphics      : http://localhost:${port}/graphics/?room=<房间>&channel=pgm|pvw`);
console.log(`[livecg] command API   : POST http://localhost:${port}/api/rooms/<房间>/command`);
console.log(`[livecg] CS2 GSI       : POST http://localhost:${port}/gsi/cs2/<房间>`);
console.log(`[livecg] data dir      : ${dataDir}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
