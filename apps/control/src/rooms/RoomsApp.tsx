import { useEffect, useState, type FormEvent } from "react";
import type { RoomInfo, RoomSummary } from "@livecg/shared";
import { api } from "../lib/api.ts";
import { useInterval } from "../lib/hooks.ts";
import { useToast } from "../lib/toast.tsx";
import { PageHeader, useMe } from "../lib/auth.tsx";
import { isStandby, useNode } from "../lib/node.tsx";

const SPORT: Record<string, string> = { cs2: "CS2", football: "足球", basketball: "篮球", generic: "通用" };
const DEV: Record<string, [string, string]> = {
  disabled: ["", "未启用"], connecting: ["warn", "连接中"], connected: ["ok", "已连接"], error: ["err", "错误"],
  listening: ["warn", "等待数据"], receiving: ["ok", "接收中"], stale: ["err", "掉线"],
};

/** 房间管理：每 2 秒刷新状态；React 原地更新卡片，展开的地址栏和文本选择不会被打断 */
export function RoomsApp() {
  const toast = useToast();
  const me = useMe();
  const node = useNode();
  const isAdmin = me.user.role === "admin" && !isStandby(node);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const refresh = async () => {
    try {
      setRooms(await api<RoomSummary[]>("/api/rooms"));
    } catch (err) {
      toast(`无法获取房间列表：${(err as Error).message}`);
    }
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useInterval(refresh, 2000);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
    } catch (err) {
      toast((err as Error).message);
    }
    refresh();
  };

  return (
    <>
      <PageHeader title="LiveCG 房间" subtitle="每个房间是一场独立的赛事：独立的比分、播出单、输出地址和数据接入" />
      <main>
        {isAdmin && <CreateRoom rooms={rooms} onCreated={refresh} />}
        {!rooms.length && <p className="hint">没有可访问的房间。请联系管理员分配房间权限。</p>}
        <div id="rooms" aria-live="polite">
          {rooms.map((r) => (
            <RoomCard
              key={r.id}
              room={r}
              isAdmin={isAdmin}
              outputToken={me.outputToken}
              failover={node?.peer}
              open={open.has(r.id)}
              onToggle={(v) => setOpen((cur) => { const n = new Set(cur); v ? n.add(r.id) : n.delete(r.id); return n; })}
              onRename={() => {
                const name = prompt("新的房间名称", r.name);
                // 取消、留空或没改动都视为不改名，不发请求
                if (name === null || !name.trim() || name.trim() === r.name) return;
                act(() => api(`/api/rooms/${encodeURIComponent(r.id)}`, "PATCH", { name: name.trim() }), "已改名");
              }}
              onDelete={() => {
                if (!confirm(`删除房间「${r.name}」？\n\n房间的数据文件会保留为 .deleted 备份，但该房间的输出页、CasparCG 输出和数据接入会立即停止。`)) return;
                act(() => api(`/api/rooms/${encodeURIComponent(r.id)}`, "DELETE"), "已删除");
              }}
            />
          ))}
        </div>
      </main>
    </>
  );
}

function CreateRoom({ rooms, onCreated }: { rooms: RoomSummary[]; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const room = await api<RoomInfo>("/api/rooms", "POST", { name, ...(id.trim() ? { id: id.trim() } : {}), ...(copyFrom ? { copyFrom } : {}) });
      toast(`已创建「${room.name}」`, "ok");
      setName("");
      setId("");
      setCopyFrom("");
      onCreated();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <section>
      <h2>新建房间</h2>
      <form className="create" id="createForm" autoComplete="off" onSubmit={submit}>
        <label>名称<input name="name" required maxLength={40} placeholder="例如 二号场 · 女篮半决赛" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>标识（可选，用于网址）<input name="id" maxLength={32} pattern="[a-z0-9][a-z0-9\-]{0,31}" placeholder="court-2" value={id} onChange={(e) => setId(e.target.value)} /></label>
        <label>复制设置
          <select name="copyFrom" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">不复制（空白房间）</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button type="submit" className="primary">创建</button>
      </form>
      <p className="hint">「复制设置」会复制播出单、队伍资料和各项配置；CasparCG 和计分器连接会被关闭，以免和原房间抢同一个输出层或端口。</p>
    </section>
  );
}

function RoomCard({ room: r, isAdmin, outputToken, failover, open, onToggle, onRename, onDelete }: {
  room: RoomSummary; isAdmin: boolean; outputToken?: string; failover?: string; open: boolean; onToggle: (v: boolean) => void; onRename: () => void; onDelete: () => void;
}) {
  const toast = useToast();
  const q = encodeURIComponent(r.id);
  const origin = location.origin;
  const extra = `${outputToken ? `&token=${encodeURIComponent(outputToken)}` : ""}${failover ? `&failover=${encodeURIComponent(failover)}` : ""}`;
  const cs2Live = r.cs2LastFrameAt && Date.now() - r.cs2LastFrameAt < 15_000;
  const urls: Array<[string, string]> = [
    ["控制台", `${origin}/control/?room=${q}`],
    // 设置了输出令牌时，输出页地址要带上它（仅管理员能看到令牌）；配置了主备时带上对端，主机断线自动改连
    ["PGM 输出", `${origin}/graphics/?room=${q}&channel=pgm${extra}`],
    ["PVW 输出", `${origin}/graphics/?room=${q}&channel=pvw${extra}`],
    ["CS2 GSI", `${origin}/gsi/cs2/${q}`],
    ["指令 API", `${origin}/api/rooms/${q}/command`],
  ];
  const dev = (label: string, status: string) => {
    if (status === "disabled") return null;
    const [cls, text] = DEV[status] ?? ["", status];
    return <span className="chip"><span className={`dot ${cls}`} />{label} {text}</span>;
  };
  return (
    <article className={`room ${r.onAir ? "live" : ""}`} data-id={r.id}>
      <div className="room-head"><b>{r.name}</b><code>{r.id}</code></div>
      <div className="score">
        {r.home.name} <b>{r.home.score}</b> <span className="muted">:</span> <b>{r.away.score}</b> {r.away.name}
        <span className="muted"> · {SPORT[r.sport] ?? r.sport}{r.period ? ` · ${r.period}` : ""}</span>
      </div>
      <div className="chips">
        {r.onAir ? <span className="chip live">PGM 在播 {r.onAir}</span> : <span className="chip">PGM 无图文</span>}
        <span className="chip">控制台 {r.clients.control} · 输出页 {r.clients.graphics}</span>
        {dev("CasparCG", r.casparcg)}
        {dev("计分器", r.scoreboard)}
        {cs2Live && <span className="chip"><span className="dot ok" />CS2 数据</span>}
      </div>
      <div className="actions">
        <a className="btn primary" href={`/control/?room=${q}`}>打开控制台</a>
        <span className="grow" />
        {isAdmin && <button data-act="rename" onClick={onRename}>改名</button>}
        {isAdmin && r.id !== "default" && (
          <button data-act="delete" className="danger" disabled={r.onAir > 0} title={r.onAir ? "请先在控制台全部下屏" : undefined} onClick={onDelete}>删除</button>
        )}
      </div>
      <details open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}>
        <summary>地址（输出页 / 数据接入）</summary>
        <div className="urls">
          {urls.map(([label, u]) => [
            <span key={`l${label}`}>{label}</span>,
            <input key={`i${label}`} readOnly value={u} aria-label={label} onFocus={(e) => e.target.select()} />,
            <button
              key={`b${label}`}
              data-copy={u}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(u);
                  toast("已复制", "ok");
                } catch {
                  toast("复制失败，请手动选中地址复制");
                }
              }}
            >复制</button>,
          ])}
        </div>
      </details>
    </article>
  );
}
