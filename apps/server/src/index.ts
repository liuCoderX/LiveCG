import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";

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
});
if (!authEnabled) console.warn("[livecg] ⚠ 鉴权已关闭（LIVECG_AUTH=off）：任何能访问本服务的人都有管理员权限，仅限本机开发使用");
const port = await app.listen(PORT);

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
