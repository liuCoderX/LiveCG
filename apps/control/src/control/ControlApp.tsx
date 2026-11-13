import { useEffect, useRef, useState } from "react";
import type { AppState, ClientMessage, GameEvent } from "@livecg/shared";
import { useLive } from "../lib/live.ts";
import { useTemplates } from "../lib/templates.ts";
import { storage } from "../lib/hooks.ts";
import { useToast } from "../lib/toast.tsx";
import { roleLabel, useMe } from "../lib/auth.tsx";
import { ROOM } from "../lib/live.ts";
import { describeEvent } from "./describe.ts";
import { Header } from "./Header.tsx";
import { Rundown } from "./Rundown.tsx";
import { Editor } from "./Editor.tsx";
import { Keys, Monitors, OnAir } from "./Monitors.tsx";
import { MatchTab } from "./MatchTab.tsx";
import { Cs2Tab, DevicesTab, EventsTab, type LogLine } from "./OtherTabs.tsx";

const TABS = [["match", "赛况"], ["cs2", "CS2"], ["devices", "设备"], ["events", "事件"]] as const;
type Tab = (typeof TABS)[number][0];

export function ControlApp() {
  const toast = useToast();
  const me = useMe();
  const role = me.user.role;
  const inScope = role === "admin" || me.user.rooms === "*" || me.user.rooms.includes(ROOM);
  const readOnly = role === "viewer" || !inScope;
  const templates = useTemplates();
  const [log, setLog] = useState<LogLine[]>([]);
  const stateRef = useRef<AppState>();
  const logSeq = useRef(0);

  const live = useLive({
    onError: toast,
    onEvent: (e: GameEvent) => {
      const text = describeEvent(e, stateRef.current);
      if (!text) return;
      setLog((cur) => [{ id: ++logSeq.current, time: new Date().toLocaleTimeString(), text }, ...cur].slice(0, 50));
    },
  });
  const { state, send } = live;
  stateRef.current = state;

  const [tab, setTab] = useState<Tab>(() => {
    const t = storage.get("livecg.tab");
    return TABS.some(([k]) => k === t) ? (t as Tab) : "match";
  });
  const showTab = (t: Tab) => {
    setTab(t);
    storage.set("livecg.tab", t);
  };

  const [editorMode, setEditorMode] = useState<"edit" | "new">("edit");
  const [newSeq, setNewSeq] = useState(0);
  const [roomExists, setRoomExists] = useState(true);

  useEffect(() => {
    if (state) document.title = `${state.room.name} · LiveCG 控制台`;
  }, [state?.room.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkeys(readOnly ? undefined : state, send, () => setEditorMode("edit"));

  const roomGone = inScope && (live.roomGone || !roomExists);

  return (
    <>
      <Header state={state} connected={live.connected} onRoomsLoaded={setRoomExists} />
      <div id="roomGone" role="alert" style={{ display: roomGone ? "block" : "none" }}>
        这个房间不存在或已被删除。<a href="/control/rooms.html" style={{ color: "#fff" }}>去房间管理</a>
      </div>
      {readOnly && (
        <div className="readonly-note" id="readonlyNote" role="status">
          {inScope ? `当前账号为${roleLabel(role)}，只能查看，不能操作。` : `账号「${me.user.username}」没有房间「${ROOM}」的权限，只能查看画面。`}
        </div>
      )}
      {state && (
        <main>
          {/* 只读账号：禁用所有操作控件，但标签页切换（只是查看）保持可用 */}
          <fieldset className="bare col" disabled={readOnly}>
            <Rundown
              state={state}
              templates={templates}
              send={send}
              readOnly={readOnly}
              onNew={() => {
                setEditorMode("new");
                setNewSeq((n) => n + 1);
              }}
              onSelect={() => setEditorMode("edit")}
            />
            <Editor state={state} templates={templates} send={send} mode={editorMode} setMode={setEditorMode} newSeq={newSeq} />
          </fieldset>
          <fieldset className="bare col" disabled={readOnly}>
            <Monitors state={state} send={send} />
            <OnAir state={state} templates={templates} send={send} />
            <Keys />
          </fieldset>
          <div className="col col-c">
            <nav className="tabs" role="tablist" aria-label="面板">
              {TABS.map(([k, label]) => (
                <button key={k} role="tab" data-tab={k} aria-selected={tab === k} onClick={() => showTab(k)}>{label}</button>
              ))}
            </nav>
            <fieldset className="bare col" disabled={readOnly}>
              <MatchTab state={state} send={send} hidden={tab !== "match"} />
              <Cs2Tab state={state} send={send} hidden={tab !== "cs2"} />
              <DevicesTab state={state} send={send} hidden={tab !== "devices"} canEditDevices={role === "admin"} />
              <EventsTab log={log} hidden={tab !== "events"} />
            </fieldset>
          </div>
        </main>
      )}
    </>
  );
}

const typing = (el: Element | null) =>
  !!el && ((el as HTMLElement).isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * 全局热键（光标在输入框内时不生效）：
 * 空格 TAKE · Shift+空格 时钟启停 · 回车 CUE · ↑↓ 选择 · Esc 清 PVW · Shift+Esc 全部下屏 · 条目热键
 */
function useHotkeys(state: AppState | undefined, send: (m: ClientMessage) => void, onSelect: () => void) {
  const ref = useRef({ state, send, onSelect });
  ref.current = { state, send, onSelect };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { state, send, onSelect } = ref.current;
      if (!state || e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(document.activeElement)) return;
      const handled = () => e.preventDefault();
      // Shift + 空格：比赛时钟开始/停止（必须在「空格 = TAKE」之前判断）
      if (e.key === " " && e.shiftKey) {
        handled();
        if (state.match.sport === "football" || state.match.sport === "basketball") send({ type: "clock.toggle" });
        return;
      }
      const items = state.rundown.items;
      const idx = items.findIndex((it) => it.id === state.rundown.selectedId);
      if (e.key === " ") { handled(); send({ type: "graphic.take" }); }
      else if (e.key === "Enter") { handled(); send({ type: "rundown.cue" }); }
      else if (e.key === "Escape") { handled(); send(e.shiftKey ? { type: "graphic.clearAll" } : { type: "preview.clear" }); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        handled();
        const next = items[Math.max(0, Math.min(items.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) {
          onSelect();
          send({ type: "rundown.select", id: next.id });
        }
      } else if (!e.shiftKey && /^[0-9a-z]$/i.test(e.key)) {
        const item = items.find((it) => it.hotkey === e.key.toLowerCase());
        if (item) { handled(); send({ type: "rundown.fire", id: item.id }); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
