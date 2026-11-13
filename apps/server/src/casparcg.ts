import { connect, type Socket } from "node:net";
import type { CasparConfig, CasparOutput } from "@livecg/shared";
import type { Store } from "./store.ts";

/**
 * CasparCG AMCP 客户端。
 *
 * LiveCG 的图文页面自己通过 WebSocket 订阅状态，所以 CasparCG 只需要把输出页
 * 作为 HTML producer 加载一次：
 *     PLAY 1-20 [HTML] "http://<livecg>/graphics/?channel=pgm"
 * 之后所有上/下屏都在页面内完成，不再走 AMCP（避免 AMCP 往返延迟，也不依赖 CG ADD 模板体系）。
 *
 * 本类做的是「期望状态 → 实际状态」的对账：
 *  - 配置里启用的输出都应被加载，被删除/禁用的输出要 CLEAR；
 *  - 断线自动重连（退避），重连或 CasparCG 重启后重新 PLAY。
 */
export class CasparClient {
  private sock?: Socket;
  private connKey = "";
  /** outputId → 已加载的 "channel-layer url" */
  private loaded = new Map<string, { target: string; url: string }>();
  private pending: string[] = [];
  private buf = "";
  private awaitingVersion = false;
  private retryTimer?: NodeJS.Timeout;
  private retryMs = 1000;
  private stopped = false;
  private unsubscribe?: () => void;

  constructor(private store: Store) {}

  start(): void {
    this.unsubscribe = this.store.subscribe(() => this.sync());
    this.sync();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    clearTimeout(this.retryTimer);
    this.sock?.destroy();
  }

  /** 控制台「重连」：断开后立即重连，并重新加载全部输出 */
  reconnect(): void {
    this.connKey = "";
    this.sock?.destroy();
    this.sync();
  }

  private get cfg(): CasparConfig {
    return this.store.get().config.casparcg;
  }

  static urlFor(cfg: CasparConfig, out: CasparOutput, roomId: string): string {
    return `${cfg.baseUrl.replace(/\/+$/, "")}/graphics/?room=${encodeURIComponent(roomId)}&channel=${out.source}`;
  }

  private sync(): void {
    if (this.stopped) return;
    const cfg = this.cfg;
    const key = cfg.enabled ? `${cfg.host}:${cfg.port}` : "";
    if (key !== this.connKey) {
      this.connKey = key;
      clearTimeout(this.retryTimer);
      this.teardown();
      if (!cfg.enabled) {
        this.setStatus({ status: "disabled", message: undefined, version: undefined, loaded: [] });
        return;
      }
      this.retryMs = 1000;
      this.open();
      return;
    }
    if (this.sock && !this.sock.connecting && !this.sock.destroyed) this.reconcile();
  }

  private open(): void {
    const { host, port } = this.cfg;
    this.setStatus({ status: "connecting", message: `${host}:${port}` });
    const sock = connect({ host, port });
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.setKeepAlive(true, 5000);
    sock.on("connect", () => {
      this.retryMs = 1000;
      this.loaded.clear();
      this.pending = [];
      this.buf = "";
      this.setStatus({ status: "connected", message: undefined });
      this.send("VERSION");
      this.reconcile();
    });
    sock.on("data", (chunk: string) => this.onData(chunk));
    sock.on("error", (err) => this.setStatus({ status: "error", message: err.message }));
    sock.on("close", () => {
      if (this.sock !== sock) return; // 已被新连接替换
      this.sock = undefined;
      this.loaded.clear();
      this.setStatus({ loaded: [] });
      if (this.stopped || !this.cfg.enabled) return;
      if (this.store.get().outputs.casparcg.status !== "error") this.setStatus({ status: "connecting", message: "连接断开，正在重连" });
      this.retryTimer = setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10_000);
    });
  }

  private teardown(): void {
    const sock = this.sock;
    this.sock = undefined;
    this.loaded.clear();
    sock?.destroy();
  }

  /** 对账：只发送差异指令 */
  private reconcile(): void {
    const cfg = this.cfg;
    const roomId = this.store.get().room.id;
    const desired = new Map(
      cfg.outputs.filter((o) => o.enabled).map((o) => [o.id, { target: `${o.channel}-${o.layer}`, url: CasparClient.urlFor(cfg, o, roomId) }]),
    );
    const desiredTargets = new Set([...desired.values()].map((d) => d.target));
    for (const [id, cur] of this.loaded) {
      const want = desired.get(id);
      if (want && want.target === cur.target && want.url === cur.url) continue;
      // 旧的 channel-layer 不再被任何输出使用时才 CLEAR；仍会被 PLAY 覆盖的层不必先清
      if (!desiredTargets.has(cur.target)) this.send(`CLEAR ${cur.target}`);
      this.loaded.delete(id);
    }
    for (const [id, want] of desired) {
      if (this.loaded.has(id)) continue;
      this.send(`PLAY ${want.target} [HTML] "${want.url}"`);
      this.loaded.set(id, want);
    }
    const loaded = [...this.loaded.keys()];
    if (loaded.join() !== this.store.get().outputs.casparcg.loaded.join()) this.setStatus({ loaded });
  }

  private send(cmd: string): void {
    if (!this.sock || this.sock.destroyed) return;
    this.pending.push(cmd.split(" ")[0]);
    this.sock.write(`${cmd}\r\n`);
  }

  /** AMCP 应答：每条指令一行「状态码 指令 描述」；201 后面跟一行数据 */
  private onData(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\r\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      if (this.awaitingVersion) {
        this.awaitingVersion = false;
        this.setStatus({ version: line.trim() });
        continue;
      }
      const m = /^(\d{3})\s/.exec(line);
      if (!m) continue;
      const code = Number(m[1]);
      const cmd = this.pending.shift();
      if (code === 201 && cmd === "VERSION") this.awaitingVersion = true;
      // 指令级错误（如 404 文件不存在）不代表断线：保持 connected，只记录信息
      else if (code >= 400) this.setStatus({ message: `${cmd ?? "AMCP"} 失败：${line}` });
      else if (cmd === "PLAY" && this.store.get().outputs.casparcg.message?.startsWith("PLAY")) this.setStatus({ message: undefined });
    }
  }

  private setStatus(patch: Partial<ReturnType<Store["get"]>["outputs"]["casparcg"]>): void {
    const cur = this.store.get().outputs.casparcg;
    if (Object.entries(patch).every(([k, v]) => JSON.stringify((cur as any)[k]) === JSON.stringify(v))) return;
    this.store.setOutputs({ casparcg: patch });
  }
}
