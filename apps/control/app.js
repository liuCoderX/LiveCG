import { connect, currentRoom } from "/graphics/lib/livecg-client.js";
import { initSports } from "./sports.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let state;

// ───────────── 模板元数据（与输出端同一份模块，单一来源） ─────────────
const templates = new Map();
async function loadTemplates() {
  const names = await fetch("/api/templates").then((r) => r.json());
  await Promise.all(names.map(async (name) => {
    try {
      const mod = await import(`/graphics/templates/${name}.js`);
      templates.set(name, mod.default.meta ?? { label: name, layer: name, z: 0 });
    } catch (err) {
      console.error(`template ${name} failed to load`, err);
    }
  }));
  const sel = $("editor").elements.template;
  sel.innerHTML = [...templates].map(([name, m]) => `<option value="${esc(name)}">${esc(m.label)}（${esc(name)}）</option>`).join("");
}

// ───────────── 提示 ─────────────
let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.display = "none"), 5000);
}

const ROOM = currentRoom();

// 监视器加载本房间的输出页
for (const f of document.querySelectorAll("iframe[data-channel]")) {
  f.src = `/graphics/?room=${encodeURIComponent(ROOM)}&channel=${f.dataset.channel}${f.dataset.params ?? ""}`;
}

for (const el of document.querySelectorAll(".room-id")) el.textContent = ROOM;

// 房间切换：下拉列出所有房间，切换即跳转（每个房间是独立的控制台页面）
async function loadRooms() {
  try {
    const rooms = await fetch("/api/rooms").then((r) => r.json());
    const sel = $("roomSel");
    const html = rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}${r.id === "default" ? "" : `（${esc(r.id)}）`}</option>`).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = ROOM;
    $("roomGone").style.display = rooms.some((r) => r.id === ROOM) ? "none" : "block";
  } catch {}
}
$("roomSel").addEventListener("change", (e) => {
  const u = new URL(location.href);
  u.searchParams.set("room", e.target.value);
  location.href = u.toString();
});
loadRooms();
setInterval(loadRooms, 5000);

const client = connect({
  role: "control",
  room: ROOM,
  onState: render,
  onEvent: logEvent,
  onError: toast,
  onConnection(ok, reason) {
    if (reason === "room-gone") $("roomGone").style.display = "block";
    $("connDot").className = `dot ${ok ? "ok" : "err"}`;
    if (!ok) $("conn").textContent = "连接断开，正在重连…";
  },
});
const send = (msg) => client.send(msg);
const sportsUI = initSports({ send, toast });

// ───────────── 标签页（记住上次打开的页，仅本机） ─────────────
function showTab(name) {
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
  try { localStorage.setItem("livecg.tab", name); } catch {}
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]")?.dataset.tab;
  if (t) showTab(t);
});
try { const t = localStorage.getItem("livecg.tab"); if (t && document.querySelector(`[data-tab="${t}"]`)) showTab(t); } catch {}

// ───────────── 渲染 ─────────────
const sigs = {};
/** 只有内容签名变化才重建列表，避免 10Hz 数据刷新时按钮被替换导致点击丢失 */
const changed = (key, value) => {
  const s = JSON.stringify(value);
  if (sigs[key] === s) return false;
  sigs[key] = s;
  return true;
};

function render(s) {
  state = s;
  if (document.title !== `${s.room.name} · LiveCG 控制台`) document.title = `${s.room.name} · LiveCG 控制台`;
  $("roomGone").style.display = "none";
  $("conn").textContent = `已连接 · rev ${s.rev} · ${s.match.sport}`;
  renderRundown(s);
  renderOnAir(s);
  renderMatch(s);
  renderCs2(s);
  renderCaspar(s);
  renderScoreboard(s);
  sportsUI.render(s);
  syncEditor(s);
}

function renderRundown(s) {
  const status = (it) => {
    const pgm = s.layers[it.layer];
    const pvw = s.preview[it.layer];
    return { pgm: !!(pgm?.visible && pgm.itemId === it.id), pvw: !!(pvw?.visible && pvw.itemId === it.id) };
  };
  const view = s.rundown.items.map((it) => ({ ...it, ...status(it) }));
  if (!changed("rundown", [view, s.rundown.selectedId, [...templates.keys()]])) return;
  $("rundown").innerHTML = view.map((it) => `
    <li data-id="${esc(it.id)}" class="${it.id === s.rundown.selectedId ? "selected" : ""} ${it.pgm ? "on-pgm" : it.pvw ? "on-pvw" : ""}">
      <span class="tag key">${esc(it.hotkey?.toUpperCase() ?? "")}</span>
      <span class="label">${esc(it.label)}<small>${esc(templates.get(it.template)?.label ?? it.template)} · ${esc(it.layer)}</small></span>
      <span class="actions">
        ${it.pgm ? '<span class="tag pgm">PGM</span>' : ""}${it.pvw ? '<span class="tag pvw">PVW</span>' : ""}
        <button class="sm cue" data-act="cue" title="预备到 PVW">CUE</button>
        <button class="sm ${it.pgm ? "take" : ""}" data-act="fire" title="直接上/下 PGM">${it.pgm ? "■" : "▶"}</button>
        <button class="sm" data-act="up" title="上移" aria-label="上移">↑</button>
        <button class="sm" data-act="down" title="下移" aria-label="下移">↓</button>
      </span>
    </li>`).join("");
}

$("rundown").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const id = li.dataset.id;
  const act = e.target.closest("button")?.dataset.act;
  const idx = state.rundown.items.findIndex((it) => it.id === id);
  if (act === "cue") send({ type: "rundown.cue", id });
  else if (act === "fire") send({ type: "rundown.fire", id });
  else if (act === "up") send({ type: "rundown.move", id, to: idx - 1 });
  else if (act === "down") send({ type: "rundown.move", id, to: idx + 1 });
  else {
    editor.mode = "edit";
    send({ type: "rundown.select", id });
  }
});

function renderOnAir(s) {
  const on = Object.values(s.layers).filter((l) => l.visible);
  const label = (l) => s.rundown.items.find((it) => it.id === l.itemId)?.label ?? templates.get(l.template)?.label ?? l.template;
  const view = on.map((l) => [l.layer, label(l)]);
  $("take").disabled = !Object.values(s.preview).some((l) => l.visible);
  if (!changed("onair", view)) return;
  $("onair").innerHTML = view.length
    ? view.map(([layer, name]) => `<li><span class="tag pgm">ON AIR</span><span class="grow">${esc(name)} <span class="hint">· ${esc(layer)}</span></span><button class="sm" data-out="${esc(layer)}">OUT</button></li>`).join("")
    : '<li><span class="hint" style="margin:0">PGM 上没有图文</span></li>';
}
$("onair").addEventListener("click", (e) => {
  const layer = e.target.closest("[data-out]")?.dataset.out;
  if (layer) send({ type: "graphic.hide", layer });
});

const setVal = (el, v) => { if (document.activeElement !== el) el.value = v ?? ""; };

function renderMatch(s) {
  setVal($("homeName"), s.match.home.shortName); setVal($("awayName"), s.match.away.shortName);
  setVal($("homeColor"), s.match.home.color ?? "#2f6bff"); setVal($("awayColor"), s.match.away.color ?? "#ff5a36");
  setVal($("homeScore"), s.match.home.score); setVal($("awayScore"), s.match.away.score);
  setVal($("period"), s.match.period);
}

function renderCs2(s) {
  setVal($("eventMs"), s.config.automation.matchEventMs);
  $("autoEvents").checked = s.config.automation.matchEvents;
  setVal($("delay"), s.config.cs2DelayMs);
  setVal($("summaryMs"), s.config.automation.roundSummaryMs);
  $("autoSummary").checked = s.config.automation.roundSummary;
  const x = s.match.sport === "cs2" ? s.match.extra : null;
  $("csMap").textContent = x?.mapName ?? "—";
  $("csRound").textContent = x ? `R${x.round}` : "—";
  $("csPhase").textContent = x ? `${x.mapPhase} / ${x.roundPhase}` : "—";
  $("csBomb").textContent = x?.bomb ?? "—";
  $("csSide").textContent = x ? x.sides.home : "—";
}

// GSI 心跳：超过 15 秒没有数据视为离线（cfg 中 heartbeat 为 10 秒）
setInterval(() => {
  const at = state?.match.extra?.lastFrameAt;
  const age = at ? (Date.now() - at) / 1000 : Infinity;
  $("gsiDot").className = `dot ${age < 15 ? "ok" : at ? "warn" : ""}`;
  $("csAge").textContent = at ? `${age.toFixed(0)} 秒前` : "—";
}, 1000);

// ───────────── 计分器 ─────────────
const SB_STATUS = { disabled: ["未启用", ""], listening: ["等待数据", "warn"], receiving: ["接收中", "ok"], stale: ["掉线", "err"], error: ["错误", "err"] };
let sbDirty = false;
$("sbForm").addEventListener("input", () => (sbDirty = true));

function renderScoreboard(s) {
  const st = s.outputs.scoreboard;
  const [text, cls] = SB_STATUS[st.status] ?? [st.status, ""];
  $("sbDot").className = `dot ${cls}`;
  $("sbStatus").textContent = text;
  $("sbMessage").textContent = st.message ?? "—";
  // 掉线时顶栏常亮告警：操作员可能正停在别的标签页
  $("sbAlert").hidden = st.status !== "stale" && st.status !== "error";
  $("sbAlert").textContent = st.status === "error" ? "计分器错误" : "计分器掉线";
  if (sbDirty || !changed("sbForm", s.config.scoreboard)) return;
  const f = $("sbForm").elements;
  f.enabled.checked = s.config.scoreboard.enabled;
  f.port.value = s.config.scoreboard.port;
  f.clockSource.value = s.config.scoreboard.clockSource;
  f.staleMs.value = s.config.scoreboard.staleMs;
}
setInterval(() => {
  const at = state?.outputs.scoreboard.lastAt;
  $("sbAge").textContent = at ? `${Math.max(0, (Date.now() - at) / 1000).toFixed(0)} 秒前` : "—";
}, 1000);
$("sbForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target.elements;
  send({ type: "config.set", patch: { scoreboard: {
    enabled: f.enabled.checked,
    port: Number(f.port.value) || 5300,
    clockSource: f.clockSource.value,
    staleMs: Math.max(500, Number(f.staleMs.value) || 3000),
  } } });
  sbDirty = false;
  sigs.sbForm = undefined;
});
$("autoEvents").onchange = () => send({ type: "config.set", patch: { automation: { matchEvents: $("autoEvents").checked } } });
$("eventMs").onchange = () => send({ type: "config.set", patch: { automation: { matchEventMs: Math.max(1000, Number($("eventMs").value) || 8000) } } });

// ───────────── CasparCG ─────────────
const CG_STATUS = { disabled: ["未启用", ""], connecting: ["连接中", "warn"], connected: ["已连接", "ok"], error: ["错误", "err"] };
let casparDirty = false;
$("casparForm").addEventListener("input", () => (casparDirty = true));

function renderCaspar(s) {
  const st = s.outputs.casparcg;
  const [text, cls] = CG_STATUS[st.status] ?? [st.status, ""];
  for (const id of ["casparDot", "casparDot2"]) $(id).className = `dot ${cls}`;
  $("casparChip").textContent = `CasparCG ${text}${st.status === "connected" ? ` · 已加载 ${st.loaded.length} 路` : ""}`;
  $("cgStatus").textContent = text;
  $("cgVersion").textContent = st.version ?? "—";
  $("cgLoaded").textContent = st.loaded.length ? st.loaded.join(", ") : "—";
  $("cgMessage").textContent = st.message ?? "—";
  $("cgMessage").title = st.message ?? "";
  if (casparDirty || !changed("casparForm", s.config.casparcg)) return;
  const cfg = s.config.casparcg;
  const f = $("casparForm").elements;
  f.enabled.checked = cfg.enabled;
  f.host.value = cfg.host;
  f.port.value = cfg.port;
  f.baseUrl.value = cfg.baseUrl;
  $("cgOutputs").innerHTML = cfg.outputs.map((o) => `
    <tr data-id="${esc(o.id)}">
      <td><input type="checkbox" data-k="enabled" ${o.enabled ? "checked" : ""} aria-label="启用 ${esc(o.label)}"></td>
      <td><input data-k="label" value="${esc(o.label)}" aria-label="名称"></td>
      <td><input data-k="channel" type="number" min="1" value="${o.channel}" aria-label="通道"></td>
      <td><input data-k="layer" type="number" min="0" value="${o.layer}" aria-label="层"></td>
      <td><select data-k="source" aria-label="信号"><option value="pgm" ${o.source === "pgm" ? "selected" : ""}>PGM</option><option value="pvw" ${o.source === "pvw" ? "selected" : ""}>PVW</option></select></td>
    </tr>`).join("");
}

$("casparForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const outputs = [...$("cgOutputs").querySelectorAll("tr")].map((tr) => {
    const v = (k) => tr.querySelector(`[data-k="${k}"]`);
    return { id: tr.dataset.id, label: v("label").value, channel: Number(v("channel").value), layer: Number(v("layer").value), source: v("source").value, enabled: v("enabled").checked };
  });
  send({ type: "config.set", patch: { casparcg: { enabled: f.enabled.checked, host: f.host.value.trim(), port: Number(f.port.value) || 5250, baseUrl: f.baseUrl.value.trim(), outputs } } });
  casparDirty = false;
  sigs.casparForm = undefined;
});
$("casparReconnect").onclick = () => send({ type: "casparcg.reconnect" });

// ───────────── 条目编辑器 ─────────────
const editor = { mode: "edit", itemId: undefined, dirty: false };
const form = $("editor");
form.addEventListener("input", () => (editor.dirty = true));

function renderFields(template, data = {}) {
  const meta = templates.get(template);
  $("fields").innerHTML = (meta?.fields ?? []).map((f) => {
    const v = esc(data[f.key] ?? "");
    const input = f.type === "textarea"
      ? `<textarea data-field="${esc(f.key)}" placeholder="${esc(f.placeholder ?? "")}">${v}</textarea>`
      : `<input data-field="${esc(f.key)}" type="${f.type === "number" ? "number" : "text"}" value="${v}" placeholder="${esc(f.placeholder ?? "")}">`;
    return `<label class="field">${esc(f.label)}${input}</label>`;
  }).join("") || '<p class="hint">此模板的数据来自比赛状态，无需填写字段。</p>';
}

function loadItem(item) {
  editor.mode = item ? "edit" : "new";
  editor.itemId = item?.id;
  editor.dirty = false;
  $("editorTitle").textContent = item ? "编辑条目" : "新建条目";
  const template = item?.template ?? (templates.has("lower-third") ? "lower-third" : [...templates.keys()][0]);
  form.elements.label.value = item?.label ?? "";
  form.elements.template.value = template;
  form.elements.layer.value = item?.layer ?? templates.get(template)?.layer ?? "";
  form.elements.hotkey.value = item?.hotkey ?? "";
  renderFields(template, item?.data);
  $("deleteItem").disabled = !item;
  $("saveAsNew").disabled = !item;
}

function syncEditor(s) {
  if (editor.mode === "new" || !templates.size) return;
  const item = s.rundown.items.find((it) => it.id === s.rundown.selectedId);
  // 选中项变了 → 载入；同一项被别处修改且本地没有未保存的改动 → 刷新
  if (item?.id !== editor.itemId || (!editor.dirty && changed("editorItem", item))) {
    sigs.editorItem = JSON.stringify(item);
    loadItem(item);
  }
}

form.elements.template.addEventListener("change", (e) => {
  const meta = templates.get(e.target.value);
  form.elements.layer.value = meta?.layer ?? form.elements.layer.value;
  renderFields(e.target.value);
});

function readForm() {
  const data = {};
  for (const el of $("fields").querySelectorAll("[data-field]")) data[el.dataset.field] = el.type === "number" ? Number(el.value) : el.value;
  return {
    label: form.elements.label.value.trim() || "未命名",
    template: form.elements.template.value,
    layer: form.elements.layer.value.trim(),
    hotkey: form.elements.hotkey.value.trim().toLowerCase() || undefined,
    data,
  };
}

function save(asNew) {
  const item = readForm();
  const id = asNew ? undefined : editor.itemId;
  send({ type: "rundown.upsert", item: { ...item, id } });
  // 在播 / 预备中的同一条目：只刷新数据，不重播入场
  if (id && form.elements.liveUpdate.checked) {
    const pgm = state.layers[item.layer];
    const pvw = state.preview[item.layer];
    if (pgm?.visible && pgm.itemId === id && pgm.template === item.template) send({ type: "graphic.update", layer: item.layer, data: item.data });
    if (pvw?.visible && pvw.itemId === id && pvw.template === item.template) send({ type: "graphic.update", layer: item.layer, data: item.data, channel: "pvw" });
  }
  editor.mode = "edit";
  editor.dirty = false;
  editor.itemId = asNew ? undefined : id; // 新条目保存后由服务端选中，syncEditor 会载入
}

form.addEventListener("submit", (e) => { e.preventDefault(); save(false); });
$("saveAsNew").onclick = () => save(true);
$("newItem").onclick = () => loadItem(undefined);
$("deleteItem").onclick = () => {
  const item = state.rundown.items.find((it) => it.id === editor.itemId);
  if (item && confirm(`删除「${item.label}」？`)) send({ type: "rundown.remove", id: item.id });
};

// ───────────── PVW / PGM 操作 ─────────────
$("take").onclick = () => send({ type: "graphic.take" });
$("cueSelected").onclick = () => send({ type: "rundown.cue" });
$("clearPvw").onclick = () => send({ type: "preview.clear" });
$("clearAll").onclick = () => send({ type: "graphic.clearAll" });

// ───────────── 赛况 / CS2 ─────────────
$("applyMatch").onclick = () => send({ type: "match.patch", patch: {
  period: $("period").value,
  home: { shortName: $("homeName").value, name: $("homeName").value, color: $("homeColor").value, score: Number($("homeScore").value) },
  away: { shortName: $("awayName").value, name: $("awayName").value, color: $("awayColor").value, score: Number($("awayScore").value) },
}});
document.querySelectorAll("[data-score]").forEach((b) => (b.onclick = () => {
  const [side, d] = b.dataset.score.split(":");
  send({ type: "match.patch", patch: { [side]: { score: Math.max(0, state.match[side].score + Number(d)) } } });
}));
$("applyDelay").onclick = () => send({ type: "config.set", patch: { cs2DelayMs: Math.max(0, Number($("delay").value) || 0) } });
$("autoSummary").onchange = () => send({ type: "config.set", patch: { automation: { roundSummary: $("autoSummary").checked } } });
$("summaryMs").onchange = () => send({ type: "config.set", patch: { automation: { roundSummaryMs: Math.max(1000, Number($("summaryMs").value) || 7000) } } });
$("swapSides").onclick = () => send({ type: "cs2.swapSides" });
$("resetCs2").onclick = () => confirm("清空阵容识别、回合历史和统计？") && send({ type: "cs2.reset" });

// ───────────── 事件日志 ─────────────
const REASON = { elimination: "全歼", bomb: "爆炸", defuse: "拆包", time: "超时", unknown: "" };
const teamName = (key) => state?.match[key]?.shortName || key;
function describe(e) {
  switch (e.type) {
    case "cs2.kill": return `${e.kill.killer?.name ?? "☠"} → ${e.kill.victim.name}${e.kill.headshot ? "（爆头）" : ""}`;
    case "cs2.roundStart": return `第 ${e.round} 回合开始`;
    case "cs2.roundEnd": return `${teamName(e.result.winner)} 赢下第 ${e.result.round} 回合（${REASON[e.result.reason]}）${e.result.score.home}:${e.result.score.away}`;
    case "cs2.bombPlanted": return "炸弹已安放";
    case "cs2.bombDefused": return "炸弹已拆除";
    case "cs2.bombExploded": return "炸弹爆炸";
    case "cs2.clutch": return `残局 1v${e.vs}：${e.player}（${teamName(e.team)}）`;
    case "cs2.halftime": return "半场换边";
    case "cs2.matchEnd": return `比赛结束${e.winner ? `，${teamName(e.winner)} 获胜` : ""}`;
    default: return e.type;
  }
}
function logEvent(e) {
  const li = document.createElement("li");
  li.innerHTML = `<time>${new Date().toLocaleTimeString()}</time><span></span>`;
  li.lastChild.textContent = describe(e);
  $("log").prepend(li);
  while ($("log").children.length > 50) $("log").lastChild.remove();
}

// ───────────── 热键 ─────────────
const typing = (el) => el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
document.addEventListener("keydown", (e) => {
  if (!state || e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(document.activeElement)) return;
  // Shift + 空格：比赛时钟开始/停止（必须在「空格 = TAKE」之前判断）
  if (e.key === " " && e.shiftKey) { e.preventDefault(); sportsUI.toggleClock(); return; }
  const items = state.rundown.items;
  const idx = items.findIndex((it) => it.id === state.rundown.selectedId);
  const handled = () => e.preventDefault();
  if (e.key === " ") { handled(); send({ type: "graphic.take" }); }
  else if (e.key === "Enter") { handled(); send({ type: "rundown.cue" }); }
  else if (e.key === "Escape") { handled(); send(e.shiftKey ? { type: "graphic.clearAll" } : { type: "preview.clear" }); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    handled();
    const next = items[Math.max(0, Math.min(items.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) { editor.mode = "edit"; send({ type: "rundown.select", id: next.id }); }
  } else if (!e.shiftKey && /^[0-9a-z]$/i.test(e.key)) {
    const item = items.find((it) => it.hotkey === e.key.toLowerCase());
    if (item) { handled(); send({ type: "rundown.fire", id: item.id }); }
  }
});

// ───────────── 监视器缩放 ─────────────
for (const id of ["pvwMon", "pgmMon"]) {
  const mon = $(id);
  new ResizeObserver(() => (mon.querySelector("iframe").style.transform = `scale(${mon.clientWidth / 1920})`)).observe(mon);
}

await loadTemplates();
if (state) render(state);
