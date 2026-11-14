// 篮球比分条（底部居中）：比分、节次、比赛时钟、进攻时钟、全队犯规、剩余暂停、球权
import { animate, fmtGameClock, fmtShotClock, setStyle, setText } from "../lib/util.js";

export default {
  meta: { label: "篮球比分条", layer: "scorebug", z: 10 },

  css: `
    .bsb { position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%); display: flex; align-items: stretch; color: var(--lcg-text, #fff);
      font-weight: 700; font-variant-numeric: tabular-nums; box-shadow: var(--lcg-shadow, 0 10px 28px rgba(0,0,0,.4)); border-radius: var(--lcg-radius, 0); overflow: hidden; }
    .bsb [hidden] { display: none !important; }
    .bsb-team { display: grid; grid-template-columns: auto auto; grid-template-rows: 48px 22px; min-width: 300px; background: var(--lcg-panel, rgba(14,16,24,.94)); }
    .bsb-team.home { grid-template-columns: 1fr auto; }
    .bsb-team.away { grid-template-columns: auto 1fr; }
    .bsb-name { display: flex; align-items: center; gap: 8px; padding: 0 16px; font-size: 26px; letter-spacing: .04em; border-top: 4px solid var(--c); }
    .bsb-team.home .bsb-name { justify-content: flex-end; }
    .bsb-score { display: grid; place-items: center; min-width: 84px; background: var(--c); color: #fff; font-size: 36px; text-shadow: 0 1px 2px rgba(0,0,0,.35); }
    .bsb-team.away .bsb-score { order: -1; }
    .bsb-meta { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 0 12px; font-size: 13px; color: var(--lcg-muted, #aab); background: var(--lcg-panel-sub, rgba(0,0,0,.55)); }
    .bsb-team.home .bsb-meta { justify-content: flex-end; }
    .bsb-fouls.pen { color: #fff; background: var(--lcg-danger, #e5484d); padding: 0 6px; border-radius: 3px; }
    .bsb-to { display: inline-flex; gap: 3px; }
    .bsb-to i { width: 12px; height: 4px; background: var(--lcg-highlight, #ffd166); border-radius: 1px; }
    .bsb-to i.used { background: rgba(255,255,255,.18); }
    .bsb-poss { width: 0; height: 0; border-top: 9px solid transparent; border-bottom: 9px solid transparent; visibility: hidden; }
    .bsb-team.home .bsb-poss { border-right: 12px solid var(--lcg-highlight, #ffd166); }
    .bsb-team.away .bsb-poss { border-left: 12px solid var(--lcg-highlight, #ffd166); }
    .bsb-poss.on { visibility: visible; }
    .bsb-mid { display: flex; align-items: center; background: var(--lcg-panel-strong, #05060a); }
    .bsb-period { padding: 0 12px; font-size: 18px; color: var(--lcg-muted, #aab); }
    .bsb-clock { min-width: 108px; padding-right: 12px; font-size: 34px; text-align: right; }
    .bsb-clock.last { color: var(--lcg-highlight, #ffd166); }
    .bsb-shot { display: grid; place-items: center; min-width: 56px; align-self: stretch; background: var(--lcg-panel-strong, #1a1d26); color: var(--lcg-highlight, #ffd166); font-size: 28px; }
    .bsb-shot.low { color: #fff; background: var(--lcg-danger, #e5484d); }
  `,

  async in(el) {
    await Promise.all([
      animate(el.querySelector(".bsb-mid"), [{ opacity: 0, transform: "scaleX(.6)" }, { opacity: 1, transform: "none" }], { duration: 300 }),
      animate(el.querySelector(".bsb-team.home"), [{ opacity: 0, transform: "translateX(40px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 120 }),
      animate(el.querySelector(".bsb-team.away"), [{ opacity: 0, transform: "translateX(-40px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 120 }),
    ]);
  },
  out: (el) => animate(el.querySelector(".bsb"), [{ opacity: 1, transform: "translateX(-50%)" }, { opacity: 0, transform: "translateX(-50%) translateY(20px)" }], { duration: 250, easing: "ease-in" }),

  render(el, { match }) {
    if (!el.firstChild) {
      const team = (k) => `
        <div class="bsb-team ${k}">
          <div class="bsb-name">${k === "home" ? '<span class="bsb-poss"></span><span class="n"></span>' : '<span class="n"></span><span class="bsb-poss"></span>'}</div>
          <div class="bsb-score"></div>
          <div class="bsb-meta"><span class="bsb-to"></span><span class="bsb-fouls"></span></div>
        </div>`;
      el.innerHTML = `
        <div class="bsb">
          ${team("home")}
          <div class="bsb-mid"><span class="bsb-period"></span><span class="bsb-clock"></span><span class="bsb-shot"></span></div>
          ${team("away")}
        </div>`;
    }
    const x = match.extra ?? {};
    const penalty = x.penaltyFouls ?? 4;
    // 暂停格数取赛制上限（FIBA 3、NBA 7）；手动加到超过上限时跟着变多
    const toMax = Math.max(x.timeoutsMax ?? 0, x.timeouts?.home ?? 0, x.timeouts?.away ?? 0);
    for (const key of ["home", "away"]) {
      const t = match[key];
      const box = el.querySelector(`.bsb-team.${key}`);
      setStyle(box, "--c", t.color ?? "#555");
      setText(box.querySelector(".n"), t.shortName || t.name);
      setText(box.querySelector(".bsb-score"), t.score);
      const fouls = x.fouls?.[key] ?? 0;
      const f = box.querySelector(".bsb-fouls");
      setText(f, `犯规 ${fouls}`);
      f.classList.toggle("pen", fouls >= penalty);
      const left = x.timeouts?.[key] ?? 0;
      const html = Array.from({ length: toMax }, (_, i) => `<i class="${i < left ? "" : "used"}"></i>`).join("");
      const to = box.querySelector(".bsb-to");
      if (to.innerHTML !== html) to.innerHTML = html;
      box.querySelector(".bsb-poss").classList.toggle("on", x.possession === key);
    }
    setText(el.querySelector(".bsb-period"), match.periodShort ?? match.period ?? "");
  },

  tick(el, { clockMs }) {
    const game = clockMs("clock");
    const shot = clockMs("shotClock");
    const clock = el.querySelector(".bsb-clock");
    setText(clock, fmtGameClock(game));
    clock.classList.toggle("last", game !== undefined && game < 60_000);
    // 比赛时钟剩余少于进攻时钟时，进攻时钟关闭（与场馆显示一致）
    const shotEl = el.querySelector(".bsb-shot");
    const off = shot === undefined || (game !== undefined && game < shot);
    shotEl.hidden = off;
    if (!off) {
      setText(shotEl, fmtShotClock(shot));
      shotEl.classList.toggle("low", shot < 5_000);
    }
  },
};
