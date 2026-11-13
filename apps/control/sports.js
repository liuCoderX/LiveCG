// 控制台 · 传统体育面板：赛制、节次、时钟、足球事件、篮球犯规/暂停/球权
import { fmtGameClock, fmtMatchClock, fmtShotClock } from "/graphics/lib/util.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const EVENT_LABEL = { goal: "进球", penaltyGoal: "点球", ownGoal: "乌龙", yellow: "黄牌", red: "红牌", sub: "换人" };
const ADJUST = {
  football: [["−1分", -60_000], ["−1秒", -1_000], ["+1秒", 1_000], ["+1分", 60_000]],
  basketball: [["−1秒", -1_000], ["−0.1", -100], ["+0.1", 100], ["+1秒", 1_000]],
};

/** "mm:ss" / "mm:ss.t" / "ss.t" → 毫秒 */
export function parseClockInput(text) {
  const m = /^\s*(?:(\d{1,3}):)?(\d{1,2}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const sec = Number(m[2]);
  if (m[1] && sec >= 60) return undefined;
  return Math.round(((m[1] ? Number(m[1]) : 0) * 60 + sec) * 1000);
}

export function initSports({ send, toast }) {
  let state;
  const sigs = {};
  const changed = (k, v) => {
    const s = JSON.stringify(v);
    if (sigs[k] === s) return false;
    sigs[k] = s;
    return true;
  };

  // 赛制列表
  fetch("/api/presets").then((r) => r.json()).then((presets) => {
    $("presetSel").innerHTML = presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
    if (state) render(state);
  });

  const sport = () => (state && ["football", "basketball"].includes(state.match.sport) ? state.match.sport : undefined);
  const external = () => state?.config.scoreboard.enabled && state.config.scoreboard.clockSource === "scoreboard";

  // ───── 时钟本地插值（与输出页同一做法） ─────
  const refs = {};
  const track = (name, c) => {
    const key = c ? `${c.ms}|${c.updatedAt}|${c.running}` : "";
    if (refs[name]?.key !== key) refs[name] = { key, at: Date.now() };
  };
  const now = (name, c) => {
    if (!c) return undefined;
    if (!c.running) return c.ms;
    const d = Date.now() - refs[name].at;
    return c.direction === "down" ? Math.max(0, c.ms - d) : c.ms + d;
  };

  const tick = () => {
    if (state && sport()) {
      const m = state.match;
      const game = now("clock", m.clock);
      const fmt = sport() === "basketball" ? fmtGameClock : fmtMatchClock;
      const text = game === undefined ? "--:--" : fmt(game);
      if ($("clockReadout").textContent !== text) $("clockReadout").textContent = text;
      $("clockReadout").classList.toggle("running", !!m.clock?.running);
      const shot = now("shotClock", m.shotClock);
      const off = shot === undefined || (game !== undefined && game < shot);
      $("shotReadout").hidden = off || sport() !== "basketball";
      if (!off) {
        const st = fmtShotClock(shot);
        if ($("shotReadout").textContent !== st) $("shotReadout").textContent = st;
        $("shotReadout").classList.toggle("low", shot < 5_000);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ───── 渲染 ─────
  function render(s) {
    state = s;
    const m = s.match;
    track("clock", m.clock);
    track("shotClock", m.shotClock);
    const sp = sport();

    if (document.activeElement !== $("presetSel") && m.extra?.preset && changed("preset", m.extra.preset)) $("presetSel").value = m.extra.preset;
    $("periodLabel").textContent = sp ? m.period : "未开始";
    $("periodPrev").disabled = $("periodNext").disabled = !sp;

    for (const id of ["clockPanel"]) $(id).hidden = !sp;
    $("footballPanel").hidden = sp !== "football";
    $("basketballPanel").hidden = sp !== "basketball";
    if (!sp) return;

    const ext = external();
    $("clockSourceTag").textContent = ext ? "计分器驱动" : "内部时钟";
    $("clockSourceTag").className = `tag ${ext ? "pvw" : ""}`;
    const running = !!m.clock?.running;
    $("clockToggle").textContent = running ? "停止" : "开始";
    $("clockToggle").classList.toggle("stop", running);
    for (const el of [$("clockToggle"), $("clockSet"), $("clockSetInput"), ...$("clockAdjust").querySelectorAll("button"), ...$("shotRow").querySelectorAll("button")]) el.disabled = ext;

    if (changed("adjust", sp)) {
      $("clockAdjust").innerHTML = ADJUST[sp].map(([label, d]) => `<button data-adjust="${d}">${label}</button>`).join("");
      $("clockSetInput").placeholder = sp === "football" ? "例如 45:00" : "例如 2:35.4";
    }
    $("shotRow").hidden = sp !== "basketball";
    $("addedRow").hidden = sp !== "football";

    const names = { home: m.home.shortName || m.home.name, away: m.away.shortName || m.away.name };
    if (sp === "football") renderFootball(m, names);
    if (sp === "basketball") renderBasketball(m, names);
  }

  function renderFootball(m, names) {
    const x = m.extra;
    if (document.activeElement !== $("addedInput")) $("addedInput").value = x.addedTime || "";
    if (changed("fbTeams", names)) {
      const sel = $("fbForm").elements.team;
      sel.options[0].textContent = names.home;
      sel.options[1].textContent = names.away;
    }
    if (!changed("fbEvents", [x.events, names])) return;
    $("fbEvents").innerHTML = [...x.events].reverse().map((e) => `
      <li>
        <b>${esc(e.minute)}</b>
        <span class="tag ${e.type === "red" ? "pgm" : ["goal", "penaltyGoal", "ownGoal"].includes(e.type) ? "pvw" : ""}">${EVENT_LABEL[e.type] ?? e.type}</span>
        <span class="who">${esc(names[e.team])} · ${esc(e.player)}${e.playerOut ? ` ↔ ${esc(e.playerOut)}` : ""}</span>
        <button class="sm danger" data-undo="${esc(e.id)}">撤销</button>
      </li>`).join("") || '<li style="grid-template-columns:1fr"><span class="hint" style="margin:0">还没有事件</span></li>';
  }

  function renderBasketball(m, names) {
    const x = m.extra;
    for (const team of ["home", "away"]) {
      const row = document.querySelector(`table.bb tr[data-team="${team}"]`);
      row.querySelector(".tn").textContent = names[team];
      row.querySelector(".fouls").textContent = x.fouls?.[team] ?? 0;
      row.querySelector(".fouls").style.color = (x.fouls?.[team] ?? 0) >= (x.penaltyFouls ?? 4) ? "var(--live)" : "";
      row.querySelector(".tos").textContent = x.timeouts?.[team] ?? 0;
      row.querySelector(".poss").classList.toggle("on", x.possession === team);
    }
    $("bbHomeName").textContent = names.home;
    $("bbAwayName").textContent = names.away;
  }

  // ───── 操作 ─────
  $("setupMatch").onclick = () => {
    const id = $("presetSel").value;
    const label = $("presetSel").selectedOptions[0]?.textContent ?? id;
    if (confirm(`开始新比赛「${label}」？比分、时钟、犯规/暂停和事件将清零。`)) send({ type: "match.setup", preset: id });
  };
  $("periodPrev").onclick = () => send({ type: "period.prev" });
  $("periodNext").onclick = () => {
    if (state?.match.clock?.running && !confirm("比赛时钟还在走，确定切到下一节？")) return;
    send({ type: "period.next" });
  };
  $("clockToggle").onclick = () => send({ type: "clock.toggle" });
  const doSet = () => {
    const ms = parseClockInput($("clockSetInput").value);
    if (ms === undefined) return toast("时间格式应为 mm:ss、mm:ss.t 或 ss.t");
    send({ type: "clock.set", ms });
    $("clockSetInput").value = "";
  };
  $("clockSet").onclick = doSet;
  $("clockSetInput").addEventListener("keydown", (e) => e.key === "Enter" && doSet());
  $("clockAdjust").addEventListener("click", (e) => {
    const d = e.target.closest("[data-adjust]")?.dataset.adjust;
    if (d) send({ type: "clock.adjust", deltaMs: Number(d) });
  });
  $("shotRow").addEventListener("click", (e) => {
    const ms = e.target.closest("[data-shot]")?.dataset.shot;
    if (ms) send({ type: "shotclock.reset", ms: Number(ms) });
  });
  $("addedSet").onclick = () => send({ type: "football.addedTime", minutes: Number($("addedInput").value) || 0 });

  const fb = $("fbForm");
  const syncFbType = () => {
    const t = fb.elements.type.value;
    $("fbOutRow").hidden = t !== "sub";
    $("fbHint").textContent = t === "ownGoal" ? "乌龙球的「球队」选得分方" : t === "sub" ? "球员填换上的，下面填换下的" : "时间留空按比赛时钟自动计算";
  };
  fb.elements.type.addEventListener("change", syncFbType);
  syncFbType();
  fb.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = fb.elements;
    send({ type: "football.event", event: {
      type: f.type.value,
      team: f.team.value,
      player: f.player.value,
      ...(f.type.value === "sub" ? { playerOut: f.playerOut.value } : {}),
      ...(f.minute.value.trim() ? { minute: f.minute.value.trim() } : {}),
    } });
    f.player.value = f.playerOut.value = f.minute.value = "";
    f.player.focus();
  });
  $("fbEvents").addEventListener("click", (e) => {
    const id = e.target.closest("[data-undo]")?.dataset.undo;
    const ev = state?.match.extra?.events?.find((x) => x.id === id);
    if (ev && confirm(`撤销 ${ev.minute} ${EVENT_LABEL[ev.type]} · ${ev.player}？`)) send({ type: "football.undo", id });
  });

  document.querySelector("table.bb").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const team = b.closest("tr").dataset.team;
    if (b.dataset.bb) {
      const [kind, d] = b.dataset.bb.split(":");
      send({ type: `basketball.${kind}`, team, delta: Number(d) });
    } else if (b.dataset.poss) send({ type: "basketball.possession", team: b.dataset.poss });
  });
  $("basketballPanel").addEventListener("click", (e) => {
    const p = e.target.closest("[data-pts]")?.dataset.pts;
    if (!p || !state) return;
    const [team, d] = p.split(":");
    send({ type: "match.patch", patch: { [team]: { score: Math.max(0, state.match[team].score + Number(d)) } } });
  });

  return { render, toggleClock: () => sport() && send({ type: "clock.toggle" }) };
}
