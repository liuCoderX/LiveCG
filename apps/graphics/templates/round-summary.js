// 回合结算：回合结束由规则引擎自动上屏（也可手动 TAKE）
// 内容：胜方 + 胜利方式、比分、本回合 MVP、双方击杀/伤害、下回合经济
import { animate, esc, money, teamColor } from "../lib/util.js";

const REASON = { elimination: "全歼对手", bomb: "炸弹爆炸", defuse: "成功拆包", time: "时间耗尽", unknown: "" };

export default {
  meta: { label: "回合结算", layer: "round-summary", z: 40 },

  // 入场：面板放大淡入，胜方条从左擦出，三栏错峰上浮
  async in(el) {
    await Promise.all([
      animate(el.querySelector(".rs"), [{ opacity: 0, transform: "translateX(-50%) scale(.92)" }, { opacity: 1, transform: "translateX(-50%) scale(1)" }], { duration: 380 }),
      animate(el.querySelector(".rs-top"), [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 420, delay: 120 }),
      animate(el.querySelectorAll(".rs-body > *"), [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { delay: 250, stagger: 70 }),
    ]);
  },
  out: (el) => animate(el.querySelector(".rs"), [{ opacity: 1, transform: "translateX(-50%) scale(1)" }, { opacity: 0, transform: "translateX(-50%) scale(.96)" }], { duration: 250, easing: "ease-in" }),

  css: `
    .rs { position: absolute; left: 50%; bottom: 300px; transform: translateX(-50%); width: 760px; color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
    .rs-top { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: var(--c); color: #111; }
    .rs-win { font-size: 34px; font-weight: 900; }
    .rs-reason { font-size: 18px; font-weight: 700; opacity: .8; }
    .rs-score { font-size: 40px; font-weight: 900; font-variant-numeric: tabular-nums; }
    .rs-body { display: grid; grid-template-columns: 1fr auto 1fr; gap: 0; background: rgba(12,14,20,.92); }
    .rs-team { padding: 14px 24px; }
    .rs-team.away { text-align: right; }
    .rs-team h4 { margin: 0 0 6px; font-size: 18px; border-bottom: 3px solid var(--tc); padding-bottom: 4px; }
    .rs-team dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: 16px; }
    .rs-team.away dl { grid-template-columns: 1fr auto; }
    .rs-team dt { color: #99a; } .rs-team dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
    .rs-mvp { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px 24px; background: rgba(255,255,255,.06); min-width: 180px; }
    .rs-mvp small { color: #ffd166; font-weight: 800; letter-spacing: .1em; }
    .rs-mvp b { font-size: 26px; }
    .rs-mvp span { color: #ccd; font-size: 15px; }
  `,

  render(el, { match }) {
    const r = match.extra?.lastRound;
    if (!r) {
      el.innerHTML = "";
      return;
    }
    const sig = `${r.round}|${r.winner}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;

    const eco = match.extra?.economy ?? {};
    const win = match[r.winner];
    const team = (key) => {
      const t = r.teams[key];
      const e = eco[key] ?? {};
      const rows = [
        ["击杀", t.kills],
        ["伤害", t.dmg],
        ["下回合资金", money(e.money)],
        ...(e.lossStreak ? [["连败", `${e.lossStreak} 局`]] : []),
      ];
      const dl = rows.map(([k, v]) => (key === "home" ? `<dt>${k}</dt><dd>${v}</dd>` : `<dd>${v}</dd><dt>${k}</dt>`)).join("");
      return `<div class="rs-team ${key}" style="--tc:${teamColor(match[key], match)}"><h4>${esc(match[key].shortName || match[key].name)}</h4><dl>${dl}</dl></div>`;
    };

    el.innerHTML = `
      <div class="rs" style="--c:${teamColor(win, match)}">
        <div class="rs-top">
          <div><div class="rs-win">${esc(win.shortName || win.name)} 赢下第 ${r.round} 回合</div><div class="rs-reason">${REASON[r.reason] ?? ""}</div></div>
          <div class="rs-score">${r.score.home} : ${r.score.away}</div>
        </div>
        <div class="rs-body">
          ${team("home")}
          <div class="rs-mvp">${r.mvp ? `<small>回合 MVP</small><b>${esc(r.mvp.name)}</b><span>${r.mvp.kills} 杀 · ${r.mvp.dmg} 伤害</span>` : "<span>—</span>"}</div>
          ${team("away")}
        </div>
      </div>`;
  },
};
