import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, GameEvent, ServerMessage } from "@livecg/shared";
import { Store } from "./store.ts";
import { Cs2Adapter, type IngestResult } from "./adapters/cs2-gsi.ts";
import { DelayQueue } from "./delay-queue.ts";
import { createRules } from "./rules.ts";

const PORT = Number(process.env.PORT ?? 3000);
const CS2_GSI_TOKEN = process.env.CS2_GSI_TOKEN ?? "change-me";
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const staticRoots: Record<string, string> = {
  "/graphics/": join(root, "graphics"),
  "/control/": join(root, "control"),
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

const store = new Store();
const cs2 = new Cs2Adapter(() => ({ home: store.get().match.home.name, away: store.get().match.away.name }));
const cs2Delay = new DelayQueue(() => store.get().config.cs2DelayMs);
const rules = createRules(store);

function applyIngest(result: IngestResult | null): void {
  if (!result) return;
  store.patchMatch(result.patch);
  for (const event of result.events) {
    rules(event);
    broadcastEvent(event);
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
    if (!file.startsWith(dir)) break;
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

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
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
    if (req.method === "GET" && url === "/api/state") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(store.get()));
      return;
    }
    if (req.method === "GET" && url === "/") {
      res.writeHead(302, { location: "/control/" }).end();
      return;
    }
    if (req.method === "GET" && (await serveStatic(url, res))) return;
    res.writeHead(404).end("not found");
  } catch (err) {
    res.writeHead(400).end(String(err));
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

wss.on("connection", (ws) => {
  send(ws, { type: "state", state: store.get() });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === "cs2.swapSides") applyIngest(cs2.swapSides());
      else if (msg.type === "cs2.reset") {
        cs2Delay.clear();
        cs2.reset();
        store.patchMatch({ home: { score: 0 }, away: { score: 0 }, extra: { killfeed: [], roundHistory: [], lastRound: undefined } });
      } else store.dispatch(msg);
    } catch (err) {
      send(ws, { type: "error", message: String(err) });
    }
  });
});

function broadcastEvent(event: GameEvent): void {
  for (const ws of wss.clients) send(ws, { type: "event", event });
}

store.subscribe((state) => {
  for (const ws of wss.clients) send(ws, { type: "state", state });
});

server.listen(PORT, () => {
  console.log(`[livecg] server on http://localhost:${PORT}`);
  console.log(`[livecg] control panel : http://localhost:${PORT}/control/`);
  console.log(`[livecg] graphics out  : http://localhost:${PORT}/graphics/  (1920x1080 browser source)`);
  console.log(`[livecg] CS2 GSI       : POST http://localhost:${PORT}/gsi/cs2`);
});
