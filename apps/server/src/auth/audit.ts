import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEntry } from "@livecg/shared";

const DETAIL_LIMIT = 2_000;

/** 本地日期（服务器时区）→ YYYY-MM-DD；审计文件按天切分 */
export const localDate = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * 操作审计：每条一行 JSON，追加写入 <dataDir>/audit/YYYY-MM-DD.jsonl。
 * 记录所有控制指令（不含数据源推送，如 CS2 GSI / 计分器）、登录登出、账号与房间变更。
 * 追加写是同步的：事故复盘时宁可慢一点也不能丢记录。
 */
export class AuditLog {
  private dir?: string;
  /** 内存里保留最近的记录，便于无数据目录（测试）时查询 */
  private recent: AuditEntry[] = [];

  constructor(dataDir: string | undefined) {
    if (dataDir) {
      this.dir = join(dataDir, "audit");
      mkdirSync(this.dir, { recursive: true });
    }
  }

  write(entry: Omit<AuditEntry, "ts"> & { ts?: number }) {
    const e: AuditEntry = { ts: Date.now(), ...entry };
    if (e.detail !== undefined) {
      const json = JSON.stringify(e.detail);
      if (json.length > DETAIL_LIMIT) e.detail = `${json.slice(0, DETAIL_LIMIT)}…（已截断）`;
    }
    this.recent.push(e);
    if (this.recent.length > 2_000) this.recent.splice(0, this.recent.length - 2_000);
    if (this.dir) {
      try {
        appendFileSync(join(this.dir, `${localDate(e.ts)}.jsonl`), `${JSON.stringify(e)}\n`);
      } catch (err) {
        console.error("[audit] 写入失败", err);
      }
    }
  }

  /** 查询某一天（新的在前） */
  query(opts: { date?: string; room?: string; user?: string; action?: string; limit?: number }): AuditEntry[] {
    const date = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : localDate();
    let rows: AuditEntry[];
    if (this.dir) {
      const file = join(this.dir, `${date}.jsonl`);
      rows = existsSync(file)
        ? readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as AuditEntry]; } catch { return []; } })
        : [];
    } else {
      rows = this.recent.filter((e) => localDate(e.ts) === date);
    }
    const action = opts.action?.trim();
    rows = rows.filter((e) =>
      (!opts.room || e.room === opts.room) &&
      (!opts.user || e.user.toLowerCase() === opts.user.toLowerCase()) &&
      (!action || e.action.startsWith(action)),
    );
    return rows.reverse().slice(0, Math.min(Math.max(1, opts.limit ?? 200), 2_000));
  }
}
