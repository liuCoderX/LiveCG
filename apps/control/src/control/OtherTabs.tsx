import { useState, type FormEvent } from "react";
import type { AppState, CasparOutput, ClientMessage, Cs2Extra, ScoreboardConfig } from "@livecg/shared";
import { useDraft, useInterval, useServerField } from "../lib/hooks.ts";
import { ageText } from "../lib/format.ts";
import { ROOM } from "../lib/live.ts";
import { casparStatus } from "./Header.tsx";

type Send = (m: ClientMessage) => void;

// ───────────── CS2 ─────────────

export function Cs2Tab({ state, send, hidden }: { state: AppState; send: Send; hidden: boolean }) {
  const [, force] = useState(0);
  useInterval(() => force((n) => n + 1), 1000); // 「最近数据 N 秒前」
  const x = state.match.sport === "cs2" ? (state.match.extra as unknown as Cs2Extra) : null;
  const at = (state.match.extra as { lastFrameAt?: number }).lastFrameAt;
  const age = at ? (Date.now() - at) / 1000 : Infinity;
  const delay = useServerField(state.config.cs2DelayMs);
  const summaryMs = useServerField(state.config.automation.roundSummaryMs);
  return (
    <div className="tabpanel" data-panel="cs2" hidden={hidden}>
      <section>
        <h2><span className={`dot ${age < 15 ? "ok" : at ? "warn" : ""}`} id="gsiDot" />CS2 数据</h2>
        <dl className="kv">
          <dt>地图</dt><dd id="csMap">{x?.mapName ?? "—"}</dd>
          <dt>回合</dt><dd id="csRound">{x ? `R${x.round}` : "—"}</dd>
          <dt>阶段</dt><dd id="csPhase">{x ? `${x.mapPhase} / ${x.roundPhase}` : "—"}</dd>
          <dt>炸弹</dt><dd id="csBomb">{x?.bomb ?? "—"}</dd>
          <dt>主队阵营</dt><dd id="csSide">{x ? x.sides.home : "—"}</dd>
          <dt>最近数据</dt><dd id="csAge">{ageText(at)}</dd>
        </dl>
        <div className="row">
          <label htmlFor="delay">数据延迟 (ms)</label>
          <input className="num" id="delay" type="number" min={0} step={500} {...delay} />
          <button id="applyDelay" onClick={() => send({ type: "config.set", patch: { cs2DelayMs: Math.max(0, Number(delay.value) || 0) } })}>应用</button>
        </div>
        <div className="row">
          <input
            type="checkbox"
            id="autoSummary"
            checked={state.config.automation.roundSummary}
            onChange={(e) => send({ type: "config.set", patch: { automation: { roundSummary: e.target.checked } } })}
          />
          <label htmlFor="autoSummary">回合结束自动弹出结算</label>
          <input
            className="num"
            id="summaryMs"
            type="number"
            min={1000}
            step={500}
            aria-label="结算停留毫秒"
            {...summaryMs}
            onBlur={(e) => {
              summaryMs.onBlur();
              send({ type: "config.set", patch: { automation: { roundSummaryMs: Math.max(1000, Number(e.target.value) || 7000) } } });
            }}
          />
          <label htmlFor="summaryMs">ms</label>
        </div>
        <div className="row">
          <button id="swapSides" onClick={() => send({ type: "cs2.swapSides" })}>交换主客队阵营</button>
          <button id="resetCs2" className="danger" onClick={() => confirm("清空阵容识别、回合历史和统计？") && send({ type: "cs2.reset" })}>重置（换图/新比赛）</button>
        </div>
      </section>
    </div>
  );
}

// ───────────── 设备：计分器 / CasparCG / 自动上屏 ─────────────

const SB_STATUS: Record<string, [string, string]> = { disabled: ["未启用", ""], listening: ["等待数据", "warn"], receiving: ["接收中", "ok"], stale: ["掉线", "err"], error: ["错误", "err"] };

export function DevicesTab({ state, send, hidden, canEditDevices }: { state: AppState; send: Send; hidden: boolean; canEditDevices: boolean }) {
  return (
    <div className="tabpanel" data-panel="devices" hidden={hidden}>
      {!canEditDevices && <p className="hint" id="devicesLocked" style={{ margin: 0 }}>设备配置（计分器、CasparCG）只有管理员可以修改；状态可以正常查看。</p>}
      <fieldset className="bare tabpanel" disabled={!canEditDevices}>
        <ScoreboardSection state={state} send={send} />
        <CasparSection state={state} send={send} />
      </fieldset>
      <AutomationSection state={state} send={send} />
    </div>
  );
}

function ScoreboardSection({ state, send }: { state: AppState; send: Send }) {
  const [, force] = useState(0);
  useInterval(() => force((n) => n + 1), 1000);
  const st = state.outputs.scoreboard;
  const [text, cls] = SB_STATUS[st.status] ?? [st.status, ""];
  const [draft, setDraft, commit] = useDraft<ScoreboardConfig>(state.config.scoreboard);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({ type: "config.set", patch: { scoreboard: {
      enabled: draft.enabled,
      port: Number(draft.port) || 5300,
      clockSource: draft.clockSource,
      staleMs: Math.max(500, Number(draft.staleMs) || 3000),
    } } });
    commit();
  };
  return (
    <section>
      <h2><span className={`dot ${cls}`} id="sbDot" />计分器输入（UDP）</h2>
      <dl className="kv">
        <dt>状态</dt><dd id="sbStatus">{text}</dd>
        <dt>最近数据</dt><dd id="sbAge">{ageText(st.lastAt)}</dd>
        <dt>信息</dt><dd id="sbMessage" style={{ gridColumn: "span 3" }}>{st.message ?? "—"}</dd>
      </dl>
      <form id="sbForm" autoComplete="off" onSubmit={submit}>
        <div className="row">
          <label><input type="checkbox" name="enabled" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> 启用</label>
          <label htmlFor="sbPort">UDP 端口</label>
          <input className="num" id="sbPort" name="port" type="number" min={1} max={65535} value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value as unknown as number })} />
        </div>
        <div className="row">
          <label htmlFor="sbSource">时钟来源</label>
          <select id="sbSource" name="clockSource" value={draft.clockSource} onChange={(e) => setDraft({ ...draft, clockSource: e.target.value as ScoreboardConfig["clockSource"] })}>
            <option value="internal">内部时钟（LiveCG 计时）</option>
            <option value="scoreboard">计分器</option>
          </select>
        </div>
        <div className="row">
          <label htmlFor="sbStale">掉线告警 (ms)</label>
          <input className="num" id="sbStale" name="staleMs" type="number" min={500} step={500} value={draft.staleMs} onChange={(e) => setDraft({ ...draft, staleMs: e.target.value as unknown as number })} />
        </div>
        <button type="submit" className="primary">保存并应用</button>
      </form>
      <p className="hint">计分器数据格式见 README「接入场馆计分器」。计分器掉线时把时钟来源切回「内部时钟」即可从最后读数继续计时。</p>
    </section>
  );
}

function CasparSection({ state, send }: { state: AppState; send: Send }) {
  const st = state.outputs.casparcg;
  const [text, cls] = casparStatus(st.status);
  const [draft, setDraft, commit] = useDraft(state.config.casparcg);
  const setOutput = (id: string, patch: Partial<CasparOutput>) =>
    setDraft({ ...draft, outputs: draft.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({ type: "config.set", patch: { casparcg: {
      enabled: draft.enabled,
      host: String(draft.host).trim(),
      port: Number(draft.port) || 5250,
      baseUrl: String(draft.baseUrl).trim(),
      outputs: draft.outputs.map((o) => ({ ...o, channel: Number(o.channel), layer: Number(o.layer) })),
    } } });
    commit();
  };
  return (
    <section>
      <h2><span className={`dot ${cls}`} id="casparDot2" />CasparCG <span className="grow" /><button className="sm" id="casparReconnect" onClick={() => send({ type: "casparcg.reconnect" })}>重连</button></h2>
      <dl className="kv">
        <dt>状态</dt><dd id="cgStatus">{text}</dd>
        <dt>版本</dt><dd id="cgVersion">{st.version ?? "—"}</dd>
        <dt>已加载</dt><dd id="cgLoaded">{st.loaded.length ? st.loaded.join(", ") : "—"}</dd>
        <dt>信息</dt><dd id="cgMessage" title={st.message ?? ""}>{st.message ?? "—"}</dd>
      </dl>
      <form id="casparForm" autoComplete="off" onSubmit={submit}>
        <div className="row">
          <label><input type="checkbox" name="enabled" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> 启用</label>
          <input name="host" placeholder="CasparCG 地址" aria-label="CasparCG 地址" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
          <input className="num" name="port" type="number" aria-label="AMCP 端口" value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value as unknown as number })} />
        </div>
        <label className="field">LiveCG 地址（CasparCG 访问本服务用，跨机器时不能填 localhost）
          <input name="baseUrl" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
        </label>
        <table className="outputs">
          <thead><tr><th>启用</th><th>输出</th><th>通道</th><th>层</th><th>信号</th></tr></thead>
          <tbody id="cgOutputs">
            {draft.outputs.map((o) => (
              <tr data-id={o.id} key={o.id}>
                <td><input type="checkbox" data-k="enabled" checked={o.enabled} aria-label={`启用 ${o.label}`} onChange={(e) => setOutput(o.id, { enabled: e.target.checked })} /></td>
                <td><input data-k="label" value={o.label} aria-label="名称" onChange={(e) => setOutput(o.id, { label: e.target.value })} /></td>
                <td><input data-k="channel" type="number" min={1} value={o.channel} aria-label="通道" onChange={(e) => setOutput(o.id, { channel: e.target.value as unknown as number })} /></td>
                <td><input data-k="layer" type="number" min={0} value={o.layer} aria-label="层" onChange={(e) => setOutput(o.id, { layer: e.target.value as unknown as number })} /></td>
                <td>
                  <select data-k="source" aria-label="信号" value={o.source} onChange={(e) => setOutput(o.id, { source: e.target.value as CasparOutput["source"] })}>
                    <option value="pgm">PGM</option>
                    <option value="pvw">PVW</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="submit" className="primary">保存并应用</button>
      </form>
      <p className="hint">CasparCG 以 HTML producer 加载输出页（<code>PLAY ch-layer [HTML] "…/graphics/?room={ROOM}&amp;channel=pgm"</code>），断线重连后会自动重新加载。</p>
    </section>
  );
}

function AutomationSection({ state, send }: { state: AppState; send: Send }) {
  const eventMs = useServerField(state.config.automation.matchEventMs);
  return (
    <section>
      <h2>自动上屏</h2>
      <div className="row">
        <input type="checkbox" id="autoEvents" checked={state.config.automation.matchEvents} onChange={(e) => send({ type: "config.set", patch: { automation: { matchEvents: e.target.checked } } })} />
        <label htmlFor="autoEvents">足球事件（进球/红黄牌/换人）自动上屏</label>
        <input
          className="num"
          id="eventMs"
          type="number"
          min={1000}
          step={500}
          aria-label="事件停留毫秒"
          {...eventMs}
          onBlur={(e) => {
            eventMs.onBlur();
            send({ type: "config.set", patch: { automation: { matchEventMs: Math.max(1000, Number(e.target.value) || 8000) } } });
          }}
        />
        <label htmlFor="eventMs">ms</label>
      </div>
    </section>
  );
}

// ───────────── 事件日志 ─────────────

export interface LogLine {
  id: number;
  time: string;
  text: string;
}

export function EventsTab({ log, hidden }: { log: LogLine[]; hidden: boolean }) {
  return (
    <div className="tabpanel" data-panel="events" hidden={hidden}>
      <section>
        <h2>事件</h2>
        <ul id="log">
          {log.map((l) => (
            <li key={l.id}><time>{l.time}</time><span>{l.text}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
