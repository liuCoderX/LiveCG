/**
 * 把模拟比赛的 GSI 帧按实时节奏 POST 到 LiveCG 服务端。
 *
 *   pnpm sim:cs2                       # 默认 http://localhost:3000, 4 倍速
 *   pnpm sim:cs2 --speed 1 --seed 7    # 实时速度、指定随机种子
 *   pnpm sim:cs2 --url http://10.0.0.5:3000 --no-players
 */
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { simulateMatch } from "../src/sim/cs2-sim.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: `http://localhost:${process.env.PORT ?? 3000}` },
    token: { type: "string", default: process.env.CS2_GSI_TOKEN ?? "change-me" },
    speed: { type: "string", default: "4" },
    seed: { type: "string", default: String(Date.now() % 100000) },
    rounds: { type: "string", default: "24" },
    "no-players": { type: "boolean", default: false },
  },
});

const speed = Math.max(0.1, Number(values.speed));
const endpoint = `${values.url}/gsi/cs2`;
console.log(`[cs2-sim] → ${endpoint}  speed x${speed}  seed ${values.seed}`);

for (const { payload, waitMs } of simulateMatch({
  seed: Number(values.seed),
  token: values.token,
  allPlayers: !values["no-players"],
  maxRounds: Number(values.rounds),
})) {
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch((e) => e as Error);
  if (res instanceof Error || !res.ok) {
    console.error(`[cs2-sim] POST failed: ${res instanceof Error ? res.message : res.status}`);
    process.exit(1);
  }
  const ct = payload.map.team_ct;
  const t = payload.map.team_t;
  console.log(`R${payload.map.round} ${payload.map.phase}/${payload.round.phase}  CT ${ct.name} ${ct.score} : ${t.score} ${t.name} T`);
  await sleep(waitMs / speed);
}
console.log("[cs2-sim] match finished");
