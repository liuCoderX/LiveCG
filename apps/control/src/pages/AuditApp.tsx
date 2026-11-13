import { useEffect, useState } from "react";
import type { AuditEntry, RoomSummary } from "@livecg/shared";
import { api } from "../lib/api.ts";
import { PageHeader } from "../lib/auth.tsx";
import { useInterval } from "../lib/hooks.ts";
import { useToast } from "../lib/toast.tsx";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 操作审计：按天查看谁在什么时候对哪个房间做了什么（含被拒绝的操作） */
export function AuditApp() {
  const toast = useToast();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [f, setF] = useState({ date: today(), room: "", user: "", action: "", limit: "200" });
  const [auto, setAuto] = useState(true);

  const load = async () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    try {
      setRows(await api<AuditEntry[]>(`/api/audit?${q}`));
    } catch (err) {
      toast((err as Error).message);
    }
  };
  useEffect(() => { load(); }, [f.date, f.room, f.limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api<RoomSummary[]>("/api/rooms").then(setRooms).catch(() => {}); }, []);
  useInterval(() => auto && load(), 5000);

  return (
    <>
      <PageHeader title="操作审计" subtitle="所有控制指令、登录、账号与房间变更（含被拒绝的操作），按天保存在 data/runtime/audit/" />
      <main>
        <section>
          <div className="filters" id="auditFilters">
            <label>日期<input type="date" name="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label>房间
              <select name="room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })}>
                <option value="">全部</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label>账号<input name="user" placeholder="全部" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} onBlur={load} onKeyDown={(e) => e.key === "Enter" && load()} /></label>
            <label>操作（前缀）<input name="action" placeholder="如 graphic. / auth." value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} onBlur={load} onKeyDown={(e) => e.key === "Enter" && load()} /></label>
            <label>条数
              <select name="limit" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })}>
                {["100", "200", "500", "2000"].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />每 5 秒刷新</label>
          </div>
        </section>
        <section>
          <div className="table-wrap">
            <table className="grid" id="auditTable">
              <thead><tr><th>时间</th><th>账号</th><th>方式</th><th>房间</th><th>操作</th><th>结果</th><th>详情</th></tr></thead>
              <tbody>
                {rows.length ? rows.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className={e.ok ? "" : "fail"}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(e.ts).toLocaleTimeString()}</td>
                    <td>{e.user}</td>
                    <td><code>{e.via}</code>{e.ip ? <><br /><code>{e.ip}</code></> : null}</td>
                    <td>{e.room ?? "—"}</td>
                    <td><code>{e.action}</code></td>
                    <td>{e.ok ? <span className="tag ok">成功</span> : <span className="tag err" title={e.error}>失败</span>}{!e.ok && e.error ? <div className="hint">{e.error}</div> : null}</td>
                    <td><code>{e.detail === undefined ? "" : typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}</code></td>
                  </tr>
                )) : <tr><td colSpan={7} className="hint">这一天没有符合条件的记录</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
