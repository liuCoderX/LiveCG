/**
 * 回放 CS2 GSI 录制文件（LIVECG_CS2_CAPTURE=1 录下的 captures/cs2-*.jsonl）。
 * 按原始时间间隔把每一帧重新 POST 给 LiveCG，用来复现真机比赛中的问题。
 *
 *   pnpm replay:cs2 data/runtime/captures/cs2-default-2026-11-20.jsonl
 *   pnpm replay:cs2 <文件> --speed 8 --room test --url http://localhost:3000
 *   pnpm replay:cs2 <文件> --from 1800      # 从录制开始后第 30 分钟开始回放
 */
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readCapture } from "../src/capture.ts";
import { loadEnvFile } from "../src/env.ts";

// 与服务端读同一个 .env（拿到 CS2_GSI_TOKEN、PORT）
loadEnvFile(process.env.LIVECG_ENV_FILE ?? resolve(fileURLToPath(new URL("../../../", import.meta.url)), ".env"));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: `http://localhost:${process.env.PORT ?? 3000}` },
    token: { type: "string", default: process.env.CS2_GSI_TOKEN ?? "change-me" },
    room: { type: "string" },
    speed: { type: "string", default: "1" },
    from: { type: "string", default: "0" },
    "max-gap": { type: "string", default: "5" },
  },
});

// 脚本实际在 apps/server 下执行；相对路径一律按项目根目录解析（pnpm 设置的 INIT_CWD），也可以给绝对路径
const file = positionals[0] && resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]);
if (!file) {
  console.error("用法：pnpm replay:cs2 <录制文件.jsonl> [--speed 1] [--room 房间] [--from 秒] [--url http://localhost:3000]");
  console.error("      相对路径从项目根目录算，例如 data/runtime/captures/cs2-default-2026-11-20.jsonl；也可以给绝对路径");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`[cs2-replay] 找不到文件：${file}（相对路径从项目根目录算，也可以给绝对路径）`);
  process.exit(1);
}

const frames = readCapture(file);
if (!frames.length) {
  console.error(`[cs2-replay] 文件里没有可用的帧：${file}`);
  process.exit(1);
}
const speed = Math.max(0.1, Number(values.speed));
const maxGap = Math.max(0.1, Number(values["max-gap"])) * 1000;
const t0 = frames[0].t;
const start = frames.findIndex((f) => f.t - t0 >= Number(values.from) * 1000);
const room = values.room ?? frames[0].room;
const endpoint = `${values.url.replace(/\/+$/, "")}/gsi/cs2/${encodeURIComponent(room)}`;
const span = ((frames.at(-1)!.t - t0) / 1000).toFixed(0);
console.log(`[cs2-replay] ${frames.length} 帧，录制时长 ${span} 秒 → ${endpoint}  x${speed}${start > 0 ? `，从第 ${start} 帧开始` : ""}`);

for (let i = Math.max(0, start); i < frames.length; i++) {
  const { payload, t } = frames[i];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, auth: { token: values.token } }),
  }).catch((e) => e as Error);
  if (res instanceof Error || !res.ok) {
    console.error(`[cs2-replay] 第 ${i} 帧发送失败：${res instanceof Error ? res.message : `HTTP ${res.status}`}`);
    process.exit(1);
  }
  const map = (payload as { map?: { round?: number; phase?: string } }).map;
  const phase = (payload as { round?: { phase?: string } }).round?.phase;
  if (i % 50 === 0 || phase === "over") {
    console.log(`  #${i}  +${((t - t0) / 1000).toFixed(1)}s  R${map?.round ?? "?"} ${map?.phase ?? ""}/${phase ?? ""}`);
  }
  const next = frames[i + 1];
  // 比赛暂停等长空档压缩到 max-gap 秒，避免回放时干等
  if (next) await sleep(Math.min(next.t - t, maxGap) / speed);
}
console.log("[cs2-replay] 回放完成");
