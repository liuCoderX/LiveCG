// 比赛事件条：进球 / 点球 / 乌龙 / 黄牌 / 红牌 / 换人
// 由规则引擎在事件发生时自动上屏（data = { event, score }），也可在播出单里手动填写
import { animate, esc } from "../lib/util.js";

const svg = (d, vb = "0 0 24 24") => `<svg viewBox="${vb}" width="1em" height="1em" aria-hidden="true">${d}</svg>`;
const ICONS = {
  ball: svg('<circle cx="12" cy="12" r="10" fill="#fff"/><path fill="#111" d="M12 7.2l3.6 2.6-1.4 4.2H9.8L8.4 9.8z"/><path fill="none" stroke="#111" stroke-width="1.2" d="M12 7.2V2.5M15.6 9.8l4.4-1.6M14.2 14l2.8 3.8M9.8 14L7 17.8M8.4 9.8L4 8.2"/>'),
  // 卡片底色与事件色块相同，靠白色描边 + 投影区分
  yellow: svg('<rect x="6" y="2.5" width="12" height="19" rx="1.5" fill="#ffd60a" stroke="#fff" stroke-width="1.6" transform="rotate(8 12 12)" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"/>'),
  red: svg('<rect x="6" y="2.5" width="12" height="19" rx="1.5" fill="#e5484d" stroke="#fff" stroke-width="1.6" transform="rotate(8 12 12)" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"/>'),
  sub: svg('<path fill="#3fb950" d="M7 3l5 6H9v6H5V9H2z"/><path fill="#e5484d" d="M17 21l-5-6h3V9h4v6h3z"/>'),
};
const KIND = {
  goal: { title: "进球", icon: "ball", color: "#3fb950" },
  penaltyGoal: { title: "点球命中", icon: "ball", color: "#3fb950" },
  ownGoal: { title: "乌龙球", icon: "ball", color: "#8b949e" },
  yellow: { title: "黄牌", icon: "yellow", color: "#d4a20a" },
  red: { title: "红牌", icon: "red", color: "#e5484d" },
  sub: { title: "换人", icon: "sub", color: "#2f6bff" },
};

export default {
  meta: {
    label: "比赛事件",
    layer: "match-event",
    z: 55,
    // 手动使用时的字段（自动上屏时由事件填充 data.event）
    fields: [
      { key: "type", label: "类型（goal / yellow / red / sub / ownGoal / penaltyGoal）", type: "text", placeholder: "goal" },
      { key: "team", label: "球队（home / away）", type: "text", placeholder: "home" },
      { key: "player", label: "球员", type: "text" },
      { key: "playerOut", label: "换下球员（换人时）", type: "text" },
      { key: "minute", label: "时间", type: "text", placeholder: "23'" },
    ],
  },

  css: `
    .mev { position: absolute; left: 96px; bottom: 120px; display: flex; align-items: stretch; color: var(--lcg-text, #fff); box-shadow: var(--lcg-shadow, 0 10px 28px rgba(0,0,0,.4)); border-radius: var(--lcg-radius, 0); overflow: hidden; }
    .mev-kind { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 112px; background: var(--k); font-size: 18px; font-weight: 800; }
    .mev-kind svg { font-size: 40px; }
    .mev-body { display: flex; flex-direction: column; justify-content: center; padding: 10px 26px; min-width: 360px; background: var(--lcg-panel, rgba(14,16,24,.94)); border-bottom: 4px solid var(--c); }
    .mev-player { font-size: 38px; font-weight: 800; line-height: 1.2; }
    .mev-out { font-size: 22px; color: var(--lcg-muted, #aab); font-weight: 600; }
    .mev-out b { color: #e5484d; margin-right: 6px; } .mev-player b { color: #3fb950; margin-right: 6px; font-size: .7em; vertical-align: middle; }
    .mev-sub { font-size: 20px; color: var(--lcg-muted, #ccd); font-weight: 600; }
    .mev-minute { display: grid; place-items: center; padding: 0 22px; background: var(--lcg-panel-strong, #0b0d12); font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  `,

  async in(el) {
    await animate(el.querySelector(".mev-kind"), [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, easing: "cubic-bezier(.3,1.5,.6,1)" });
    await animate([el.querySelector(".mev-body"), el.querySelector(".mev-minute")], [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 360, stagger: 120 });
  },
  out: (el) => animate(el.querySelector(".mev"), [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-30px)" }], { duration: 260, easing: "ease-in" }),

  render(el, { match, data }) {
    const ev = data.event ?? data; // 自动上屏：data.event；手动：字段直接在 data 上
    const sig = JSON.stringify([ev, data.score, match.home.shortName, match.away.shortName]);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const kind = KIND[ev.type] ?? KIND.goal;
    const team = match[ev.team === "away" ? "away" : "home"];
    const score = data.score ?? { home: match.home.score, away: match.away.score };
    const isGoal = ["goal", "penaltyGoal", "ownGoal"].includes(ev.type);
    const sub = isGoal
      ? `${esc(match.home.shortName || match.home.name)} ${score.home} - ${score.away} ${esc(match.away.shortName || match.away.name)}`
      : esc(team.shortName || team.name);
    el.innerHTML = `
      <div class="mev" style="--k:${kind.color};--c:${esc(team.color ?? "#555")}">
        <div class="mev-kind">${ICONS[kind.icon]}<span>${kind.title}</span></div>
        <div class="mev-body">
          <div class="mev-player">${ev.type === "sub" ? "<b>▲</b>" : ""}${esc(ev.player)}</div>
          ${ev.type === "sub" && ev.playerOut ? `<div class="mev-out"><b>▼</b>${esc(ev.playerOut)}</div>` : ""}
          <div class="mev-sub">${sub}</div>
        </div>
        ${ev.minute ? `<div class="mev-minute">${esc(ev.minute)}</div>` : ""}
      </div>`;
  },
};
