import { memo, useEffect, useRef } from "react";
import type { AppState, ClientMessage } from "@livecg/shared";
import { ROOM } from "../lib/live.ts";
import type { TemplateMap } from "../lib/templates.ts";

/** 一路监视器：iframe 按容器宽度等比缩放；不接收鼠标和焦点，避免点画面后热键失效 */
const Monitor = memo(function Monitor({ id, channel, params, title }: { id: string; channel: "pvw" | "pgm"; params: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (box.current && frame.current) frame.current.style.transform = `scale(${box.current.clientWidth / 1920})`;
    });
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={`monitor ${channel}`} id={id} ref={box}>
      <span className={`tag ${channel} badge`}>{channel.toUpperCase()}</span>
      <iframe ref={frame} src={`/graphics/?room=${encodeURIComponent(ROOM)}&channel=${channel}${params}`} title={title} tabIndex={-1} />
    </div>
  );
});

export function Monitors({ state, send }: { state: AppState; send: (m: ClientMessage) => void }) {
  const canTake = Object.values(state.preview).some((l) => l.visible);
  return (
    <section>
      <h2>PVW 预监 <span className="grow" /><button className="sm" id="clearPvw" onClick={() => send({ type: "preview.clear" })}>清空 PVW</button></h2>
      <Monitor id="pvwMon" channel="pvw" params="&preview&safe" title="PVW 预监" />
      <div className="switcher">
        <button className="take" id="take" disabled={!canTake} onClick={() => send({ type: "graphic.take" })}>TAKE</button>
        <button className="cue" id="cueSelected" onClick={() => send({ type: "rundown.cue" })}>CUE 选中项</button>
        <span className="hint" style={{ margin: 0 }}>空格 = TAKE · 回车 = CUE</span>
      </div>
      <h2>PGM 播出 <span className="grow" /><button className="sm danger" id="clearAll" onClick={() => send({ type: "graphic.clearAll" })}>全部下屏</button></h2>
      <Monitor id="pgmMon" channel="pgm" params="&preview" title="PGM 播出" />
    </section>
  );
}

export function OnAir({ state, templates, send }: { state: AppState; templates: TemplateMap; send: (m: ClientMessage) => void }) {
  const on = Object.values(state.layers).filter((l) => l.visible);
  const label = (itemId: string | undefined, template: string) =>
    state.rundown.items.find((it) => it.id === itemId)?.label ?? templates.get(template)?.label ?? template;
  return (
    <section>
      <h2>在播图层</h2>
      <ul id="onair">
        {on.length ? (
          on.map((l) => (
            <li key={l.layer}>
              <span className="tag pgm">ON AIR</span>
              <span className="grow">{label(l.itemId, l.template)} <span className="hint">· {l.layer}</span></span>
              <button className="sm" data-out={l.layer} onClick={() => send({ type: "graphic.hide", layer: l.layer })}>OUT</button>
            </li>
          ))
        ) : (
          <li><span className="hint" style={{ margin: 0 }}>PGM 上没有图文</span></li>
        )}
      </ul>
    </section>
  );
}

export function Keys() {
  const keys: Array<[string, string]> = [
    ["空格", "TAKE：PVW → PGM"],
    ["回车", "CUE 选中条目到 PVW，并选中下一条"],
    ["↑ / ↓", "选择播出单条目"],
    ["1–9 / A–Z", "条目热键：直接上屏，再按一次下屏"],
    ["Esc", "清空 PVW"],
    ["Shift + Esc", "PGM 全部下屏"],
    ["Shift + 空格", "比赛时钟 开始 / 停止"],
  ];
  return (
    <section>
      <h2>热键</h2>
      <div className="keys">
        {keys.map(([k, v]) => [<kbd key={`k${k}`}>{k}</kbd>, <span key={`v${k}`}>{v}</span>])}
      </div>
      <p className="hint">光标在输入框内时热键不生效。外部设备（Stream Deck / Companion）可调用 <code>POST /api/rooms/{ROOM}/command</code>。</p>
    </section>
  );
}
