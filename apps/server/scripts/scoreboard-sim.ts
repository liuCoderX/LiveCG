/**
 * 场馆计分器模拟器：按通用 UDP 格式（见 src/sports/scoreboard.ts）每 100ms 发一帧篮球数据。
 * 用于不接真实计分器时联调「计分器 → LiveCG → 图文」整条链路。
 *
 *   pnpm sim:scoreboard                        # 发到 127.0.0.1:5300，4 倍速
 *   pnpm sim:scoreboard --speed 1 --format kv  # 实时速度、key=value 文本格式
 *   pnpm sim:scoreboard --stop-after 20        # 20 秒后停止发送（演练掉线告警）
 */
import { createSocket } from "node:dgram";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "5300" },
    speed: { type: "string", default: "4" },
    format: { type: "string", default: "json" },
    "quarter-min": { type: "string", default: "10" },
    "stop-after": { type: "string" },
    seed: { type: "string", default: String(Date.now() % 100000) },
  },
});

let seed = Number(values.seed);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const speed = Math.max(0.1, Number(values.speed));
const QUARTER = Number(values["quarter-min"]) * 60_000;
const port = Number(values.port);

const st = { period: 1, clock: QUARTER, shot: 24_000, running: true, home: 0, away: 0, homeFouls: 0, awayFouls: 0, homeTimeouts: 2, awayTimeouts: 2, pauseLeft: 0 };
const sock = createSocket("udp4");
const startedAt = Date.now();
const fmt = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}` : (Math.floor(ms / 100) / 10).toFixed(1));

console.log(`[scoreboard-sim] → udp://${values.host}:${port}  x${speed}  format=${values.format}`);

const TICK = 100;
setInterval(() => {
  if (values["stop-after"] && Date.now() - startedAt > Number(values["stop-after"]) * 1000) {
    console.log("[scoreboard-sim] stop-after reached, going silent");
    process.exit(0);
  }
  const dt = TICK * speed;
  if (st.running) {
    st.clock = Math.max(0, st.clock - dt);
    st.shot = Math.max(0, st.shot - dt);
    // 随机事件：投篮得分 / 犯规停表 / 换球权
    const r = rnd();
    const team = rnd() < 0.5 ? "home" : "away";
    if (r < 0.02 * speed) {
      st[team] += rnd() < 0.3 ? 3 : 2;
      st.shot = 24_000;
    } else if (r < 0.028 * speed) {
      st[`${team}Fouls` as "homeFouls"]++;
      st.running = false;
      st.pauseLeft = 3_000 + rnd() * 4_000;
    } else if (st.shot === 0) {
      st.shot = 24_000;
    }
    if (st.clock === 0) {
      st.running = false;
      st.pauseLeft = 8_000;
    }
  } else {
    st.pauseLeft -= dt;
    if (st.pauseLeft <= 0) {
      if (st.clock === 0) {
        if (st.period >= 4) {
          console.log(`[scoreboard-sim] final ${st.home}:${st.away}`);
          process.exit(0);
        }
        st.period++;
        st.clock = QUARTER;
        st.homeFouls = st.awayFouls = 0;
        if (st.period === 3) st.homeTimeouts = st.awayTimeouts = 3;
      }
      // 罚球后：两罚中一到两个
      st.running = true;
      st.shot = rnd() < 0.5 ? 24_000 : 14_000;
      if (rnd() < 0.5) st[rnd() < 0.5 ? "home" : "away"] += 1;
    }
  }
  const frame = {
    clock: fmt(st.clock), running: st.running, period: st.period, home: st.home, away: st.away,
    shot: st.clock < st.shot ? "off" : (Math.floor(st.shot / 100) / 10).toFixed(1),
    homeFouls: st.homeFouls, awayFouls: st.awayFouls, homeTimeouts: st.homeTimeouts, awayTimeouts: st.awayTimeouts,
  };
  const text = values.format === "kv" ? Object.entries(frame).map(([k, v]) => `${k}=${v === true ? 1 : v === false ? 0 : v}`).join(";") : JSON.stringify(frame);
  sock.send(text, port, values.host);
}, TICK);
