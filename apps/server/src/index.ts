import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, GameEvent, ServerMessage } from "@livecg/shared";
import { Store } from "./store.ts";
import { Cs2Adapter, type IngestResult } from "./adapters/cs2-gsi.ts";
import { DelayQueue } from "./delay-queue.ts";
import { createRules } from "./rules.ts";
import { loadSeed, persistTo } from "./persist.ts";
import { CasparClient } from "./casparcg.ts";
import { isSportsMessage, SportsController } from "./sports/controller.ts";
import { ScoreboardInput } from "./sports/scoreboard.ts";
import { PRESETS, periodAt } from "./sports/presets.ts";

const PORT = Number(process.env.PORT ?? 3000);
const CS2_GSI_TOKEN = process.env.CS2_GSI_TOKEN ?? "change-me";
const appsDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DATA_FILE = join(process.env.LIVECG_DATA_DIR ?? join(appsDir, "..", "data", "runtime"), "livecg.json");
const staticRoots: Record<string, string> = {
  "/graphics/": join(appsDir, "graphics"),
  "/control/": join(appsDir, "control"),
};
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
};

const store = new Store(loadSeed(DATA_FILE));
const stopPersist = persistTo(store, DATA_FILE);
const cs2 = new Cs2Adapter(() => ({ home: store.get().match.home.name, away: store.get().match.away.name }));
const cs2Delay = new DelayQueue(() => store.get().config.cs2DelayMs);
const rules = createRules(store);
const caspar = new CasparClient(store);

/** 所有数据源推导出的事件：先给规则引擎，再广播给控制台/模板 */
function emit(event: GameEvent): void {
  rules(event);
  broadcastEvent(event);
}

const sports = new SportsController(store, emit);
const scoreboard = new ScoreboardInput(store, (i) => (sports.preset ? periodAt(sports.preset, i) : undefined));

function applyIngest(result: IngestResult | null): void {
  if (!result) return;
  store.patchMatch(result.patch);
  for (const event of result.events) emit(event);
}

/** 所有控制指令的唯一入口：WebSocket、HTTP API、热键设备都走这里 */
function handleCommand(msg: ClientMessage): void {
  switch (msg.type) {
    case "hello":
      return;
    case "cs2.swapSides":
      return applyIngest(cs2.swapSides());
    case "cs2.reset":
      cs2Delay.clear();
      cs2.reset();
      return store.patchMatch({ home: { score: 0 }, away: { score: 0 }, extra: { killfeed: [], roundHistory: [], lastRound: undefined } });
    case "casparcg.reconnect":
      return caspar.reconnect();
    default:
      if (isSportsMessage(msg)) return sports.handle(msg);
      return store.dispatch(msg);
  }
}

function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new Error("body too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

async function serveStatic(url: string, res: ServerResponse): Promise<boolean> {
  for (const [prefix, dir] of Object.entries(staticRoots)) {
    if (!url.startsWith(prefix)) continue;
    let rel = decodeURIComponent(url.slice(prefix.length).split("?")[0]);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(dir, rel));
    // 带分隔符比较，防止 ../graphicsX 之类的同前缀目录穿越
    if (!file.startsWith(dir + sep)) break;
    try {
      if (!(await stat(file)).isFile()) break;
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(await readFile(file));
      return true;
    } catch {
      break;
    }
  }
  return false;
}

const json = (res: ServerResponse, code: number, body: unknown) =>
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  try {
    if (req.method === "POST" && url === "/gsi/cs2") {
      const payload = JSON.parse(await readBody(req));
      if (payload?.auth?.token !== CS2_GSI_TOKEN) {
        res.writeHead(401).end();
        return;
      }
      // 先进延迟缓冲再解析，保证事件与状态同步延迟
      cs2Delay.push(() => applyIngest(cs2.ingest(payload)));
      res.writeHead(200).end();
      return;
    }
    // 外部控制（Stream Deck / Bitfocus Companion / 脚本）：body 即 ClientMessage
    if (req.method === "POST" && url === "/api/command") {
      const msg = JSON.parse(await readBody(req)) as ClientMessage;
      if (!msg || typeof msg.type !== "string") return json(res, 400, { ok: false, error: "missing type" });
      handleCommand(msg);
      return json(res, 200, { ok: true, rev: store.get().rev });
    }
    if (req.method === "GET" && url === "/api/state") return json(res, 200, store.get());
    if (req.method === "GET" && url === "/api/presets") return json(res, 200, Object.values(PRESETS));
    if (req.method === "GET" && url === "/api/templates") {
      const files = await readdir(join(staticRoots["/graphics/"], "templates"));
      return json(res, 200, files.filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort());
    }
    if (req.method === "GET" && url === "/") {
      res.writeHead(302, { location: "/control/" }).end();
      return;
    }
    if (req.method === "GET" && (await serveStatic(req.url ?? "/", res))) return;
    res.writeHead(404).end("not found");
  } catch (err) {
    json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

wss.on("connection", (ws) => {
  send(ws, { type: "state", state: store.get() });
  ws.on("message", (raw) => {
    try {
      handleCommand(JSON.parse(raw.toString()) as ClientMessage);
    } catch (err) {
      send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
});

function broadcastEvent(event: GameEvent): void {
  for (const ws of wss.clients) send(ws, { type: "event", event });
}

store.subscribe((state) => {
  for (const ws of wss.clients) send(ws, { type: "state", state });
});

caspar.start();
scoreboard.start();

server.listen(PORT, () => {
  console.log(`[livecg] server on http://localhost:${PORT}`);
  console.log(`[livecg] control panel : http://localhost:${PORT}/control/`);
  console.log(`[livecg] graphics PGM  : http://localhost:${PORT}/graphics/?channel=pgm  (1920x1080 browser source)`);
  console.log(`[livecg] graphics PVW  : http://localhost:${PORT}/graphics/?channel=pvw`);
  console.log(`[livecg] command API   : POST http://localhost:${PORT}/api/command`);
  console.log(`[livecg] CS2 GSI       : POST http://localhost:${PORT}/gsi/cs2`);
  console.log(`[livecg] data file     : ${DATA_FILE}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopPersist();
    caspar.stop();
    scoreboard.stop();
    sports.dispose();
    process.exit(0);
  });
}
