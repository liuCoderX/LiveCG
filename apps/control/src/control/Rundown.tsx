import type { AppState, ClientMessage } from "@livecg/shared";
import type { TemplateMap } from "../lib/templates.ts";

interface Props {
  state: AppState;
  templates: TemplateMap;
  send: (m: ClientMessage) => void;
  onNew: () => void;
  onSelect: () => void;
  /** 只读账号：点击条目不发「选中」指令（服务端会拒绝） */
  readOnly?: boolean;
}

/** 播出单：React 按 key 原地更新列表项，10Hz 数据刷新时按钮不会被替换，点击不会丢 */
export function Rundown({ state, templates, send, onNew, onSelect, readOnly }: Props) {
  const items = state.rundown.items;
  return (
    <section>
      <h2>播出单 <span className="grow" /><button className="sm" id="newItem" onClick={onNew}>＋ 新建</button></h2>
      <ul id="rundown">
        {items.map((it, idx) => {
          const pgm = state.layers[it.layer];
          const pvw = state.preview[it.layer];
          const onPgm = !!(pgm?.visible && pgm.itemId === it.id);
          const onPvw = !!(pvw?.visible && pvw.itemId === it.id);
          const cls = [it.id === state.rundown.selectedId ? "selected" : "", onPgm ? "on-pgm" : onPvw ? "on-pvw" : ""].join(" ").trim();
          return (
            <li
              key={it.id}
              data-id={it.id}
              className={cls}
              onClick={() => {
                if (readOnly) return;
                onSelect();
                send({ type: "rundown.select", id: it.id });
              }}
            >
              <span className="tag key">{it.hotkey?.toUpperCase() ?? ""}</span>
              <span className="label">
                {it.label}
                <small>{templates.get(it.template)?.label ?? it.template} · {it.layer}</small>
              </span>
              {/* 操作按钮阻止冒泡，避免同时触发「选中」 */}
              <span className="actions" onClick={(e) => e.stopPropagation()}>
                {onPgm && <span className="tag pgm">PGM</span>}
                {onPvw && <span className="tag pvw">PVW</span>}
                <button className="sm cue" data-act="cue" title="预备到 PVW" onClick={() => send({ type: "rundown.cue", id: it.id })}>CUE</button>
                <button className={`sm ${onPgm ? "take" : ""}`} data-act="fire" title="直接上/下 PGM" onClick={() => send({ type: "rundown.fire", id: it.id })}>
                  {onPgm ? "■" : "▶"}
                </button>
                <button className="sm" data-act="up" title="上移" aria-label="上移" onClick={() => send({ type: "rundown.move", id: it.id, to: idx - 1 })}>↑</button>
                <button className="sm" data-act="down" title="下移" aria-label="下移" onClick={() => send({ type: "rundown.move", id: it.id, to: idx + 1 })}>↓</button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint">单击选中 · <b>CUE</b> 预备到 PVW · <b>▶</b> 直接上/下 PGM（同热键）</p>
    </section>
  );
}
