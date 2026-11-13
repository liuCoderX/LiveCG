// 足球比分条（左上角）：队名 + 比分 + 比赛时钟 + 节次 + 补时 + 红牌
// 数据全部来自 match 状态（时钟由服务端锚点 + 本机插值，不需要逐秒推送）
import { animate, fmtMatchClock, setStyle, setText } from "../lib/util.js";

export default {
  meta: { label: "足球比分条", layer: "scorebug", z: 10 },

  css: `
    .fsb { position: absolute; top: 48px; left: 96px; display: flex; align-items: stretch; height: 52px; color: #fff; font-weight: 700;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); font-variant-numeric: tabular-nums; }
    .fsb-period { display: grid; place-items: center; padding: 0 12px; background: #0b0d12; color: #9aa3b5; font-size: 16px; letter-spacing: .06em; }
    .fsb-team { display: flex; align-items: center; gap: 8px; padding: 0 16px; background: rgba(16,18,26,.92); font-size: 24px; letter-spacing: .04em; border-bottom: 4px solid var(--c); }
    .fsb-reds { display: inline-flex; gap: 3px; }
    .fsb-reds i { width: 10px; height: 14px; background: #e5484d; border-radius: 1px; }
    .fsb-score { display: flex; align-items: center; gap: 10px; padding: 0 16px; background: #fff; color: #111; font-size: 30px; }
    .fsb-score span:nth-child(2) { color: #999; font-size: 22px; }
    .fsb-clock { display: grid; place-items: center; min-width: 96px; padding: 0 14px; background: #0b0d12; font-size: 26px; }
    .fsb-added { display: grid; place-items: center; padding: 0 12px; background: #3fb950; color: #08140b; font-size: 22px; font-weight: 800; }
    .fsb [hidden] { display: none !important; }
  `,

  async in(el) {
    await animate(el.querySelectorAll(".fsb > *"), [{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "none" }], { duration: 320, stagger: 50 });
  },
  out: (el) => animate(el.querySelector(".fsb"), [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-16px)" }], { duration: 250, easing: "ease-in" }),

  render(el, { match }) {
    if (!el.firstChild) {
      el.innerHTML = `
        <div class="fsb">
          <div class="fsb-period"></div>
          <div class="fsb-team home"><span class="n"></span><span class="fsb-reds"></span></div>
          <div class="fsb-score"><span class="h"></span><span>-</span><span class="a"></span></div>
          <div class="fsb-team away"><span class="fsb-reds"></span><span class="n"></span></div>
          <div class="fsb-clock"></div>
          <div class="fsb-added"></div>
        </div>`;
    }
    const x = match.extra ?? {};
    for (const key of ["home", "away"]) {
      const t = match[key];
      const box = el.querySelector(`.fsb-team.${key}`);
      setStyle(box, "--c", t.color ?? "#555");
      setText(box.querySelector(".n"), t.shortName || t.name);
      const reds = x.redCards?.[key] ?? 0;
      const redBox = box.querySelector(".fsb-reds");
      if (redBox.childElementCount !== reds) redBox.innerHTML = "<i></i>".repeat(reds);
    }
    setText(el.querySelector(".fsb-score .h"), match.home.score);
    setText(el.querySelector(".fsb-score .a"), match.away.score);
    setText(el.querySelector(".fsb-period"), match.periodShort ?? "");
    const added = el.querySelector(".fsb-added");
    setText(added, x.addedTime ? `+${x.addedTime}` : "");
    added.hidden = !x.addedTime;
  },

  tick(el, { clockMs }) {
    setText(el.querySelector(".fsb-clock"), fmtMatchClock(clockMs()));
  },
};
