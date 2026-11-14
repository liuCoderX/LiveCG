import { useEffect, useState } from "react";
import type { AppState, RoomSummary } from "@livecg/shared";
import { ROOM } from "../lib/live.ts";
import { useInterval } from "../lib/hooks.ts";
import { UserMenu } from "../lib/auth.tsx";

const CG_STATUS: Record<string, [string, string]> = { disabled: ["未启用", ""], connecting: ["连接中", "warn"], connected: ["已连接", "ok"], error: ["错误", "err"] };
export const casparStatus = (s: string) => CG_STATUS[s] ?? [s, ""];

/** 顶栏：房间切换、连接状态、计分器掉线告警、CasparCG 状态 */
export function Header({ state, connected, onRoomsLoaded }: { state?: AppState; connected: boolean; onRoomsLoaded: (exists: boolean) => void }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const load = async () => {
    try {
      const list: RoomSummary[] = await fetch("/api/rooms").then((r) => r.json());
      setRooms(list);
      onRoomsLoaded(list.some((r) => r.id === ROOM));
    } catch { /* 下次重试 */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useInterval(load, 5000);

  const sb = state?.outputs.scoreboard.status;
  const cg = state?.outputs.casparcg;
  const [cgText, cgCls] = casparStatus(cg?.status ?? "disabled");

  return (
    <header>
      <h1>LiveCG 控制台</h1>
      <label className="room-switch">
        <span className="sr-only">房间</span>
        <select
          id="roomSel"
          aria-label="切换房间"
          value={ROOM}
          onChange={(e) => {
            const u = new URL(location.href);
            u.searchParams.set("room", e.target.value);
            location.href = u.toString();
          }}
        >
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.id === "default" ? "" : `（${r.id}）`}</option>)}
          {!rooms.some((r) => r.id === ROOM) && <option value={ROOM}>{ROOM}</option>}
        </select>
      </label>
      <span className={`dot ${connected ? "ok" : "err"}`} id="connDot" />
      <span id="conn" className="hint" style={{ margin: 0 }}>
        {!state ? "连接中…" : connected ? `已连接 · rev ${state.rev} · ${state.match.sport}` : "连接断开，正在重连…"}
      </span>
      <span className="spacer" />
      {/* 掉线时顶栏常亮告警：操作员可能正停在别的标签页 */}
      <span className="alert-chip" id="sbAlert" hidden={sb !== "stale" && sb !== "error"}>{sb === "error" ? "计分器错误" : "计分器掉线"}</span>
      <span className={`dot ${cgCls}`} id="casparDot" />
      <span id="casparChip" className="hint" style={{ margin: 0 }}>
        CasparCG {cgText}{cg?.status === "connected" ? ` · 已加载 ${cg.loaded.length} 路` : ""}
      </span>
      <UserMenu />
    </header>
  );
}
