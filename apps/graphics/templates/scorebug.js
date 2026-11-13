// 比分条：数据来自 match 状态（自动跟随 CS2 GSI 或手动比分）
// CS2 下额外显示：阵营色、回合计时、炸弹状态、回合历史
import { animate, fmtClock, ICON, setStyle, setText, teamColor, SIDE_COLOR } from "../lib/util.js";

export default {
  meta: { label: "比分条", layer: "scorebug", z: 10 },

  // 入场：主体从上方落下，地图/回合历史随后淡入；出场反向
  async in(el) {
    await Promise.all([
      animate(el.querySelector(".sb-main"), [{ transform: "translateY(-140%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 450 }),
      animate([el.querySelector(".sb-map"), el.querySelector(".sb-history")], [{ opacity: 0 }, { opacity: 1 }], { delay: 250, stagger: 80 }),
    ]);
  },
  async out(el) {
    await animate([el.querySelector(".sb-history"), el.querySelector(".sb-map")], [{ opacity: 1 }, { opacity: 0 }], { duration: 150 });
    await animate(el.querySelector(".sb-main"), [{ transform: "none", opacity: 1 }, { transform: "translateY(-140%)", opacity: 0 }], { duration: 300, easing: "ease-in" });
  },

  css: `
    .scorebug { position: absolute; top: 36px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; color: var(--lcg-text, #fff); }
    .sb-main { display: flex; align-items: stretch; height: 60px; font-weight: 700; box-shadow: var(--lcg-shadow, 0 8px 28px rgba(0,0,0,.4)); border-radius: var(--lcg-radius, 0); overflow: hidden; }
    .sb-team { display: flex; align-items: center; gap: 10px; padding: 0 20px; background: var(--lcg-panel, rgba(12,14,20,.88)); min-width: 220px; }
    .sb-team.home { justify-content: flex-end; border-left: 6px solid var(--c); }
    .sb-team.away { border-right: 6px solid var(--c); }
    .sb-name { font-size: 26px; letter-spacing: .04em; white-space: nowrap; }
    .sb-side { font-size: 13px; font-weight: 800; padding: 2px 6px; border-radius: 3px; background: var(--c); color: #111; }
    .sb-score { width: 68px; display: grid; place-items: center; background: var(--c); color: #111; font-size: 34px; font-variant-numeric: tabular-nums; transition: background .4s; }
    .sb-mid { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 108px; background: var(--lcg-panel-strong, rgba(0,0,0,.92)); transition: background .3s; }
    .sb-period { font-size: 14px; color: var(--lcg-muted, #aab); letter-spacing: .08em; }
    .sb-clock { font-size: 24px; font-variant-numeric: tabular-nums; }
    .sb-mid.bomb { background: #b3261e; animation: sb-pulse 1s ease-in-out infinite; }
    .sb-mid.bomb .sb-period { color: #fff; }
    @keyframes sb-pulse { 50% { background: var(--lcg-danger, #e5484d); } }
    .sb-map { margin-top: 4px; font-size: 13px; color: var(--lcg-muted, #ccd); background: var(--lcg-panel-sub, rgba(0,0,0,.7)); border-radius: var(--lcg-radius, 0); padding: 2px 12px; letter-spacing: .06em; text-transform: uppercase; }
    .sb-history { display: flex; gap: 3px; margin-top: 4px; }
    .sb-history i { width: 18px; height: 18px; display: grid; place-items: center; font-style: normal; font-size: 11px; color: #111; border-radius: 2px; }
    .sb-history i.gap { width: 8px; background: none; }
  `,

  render(el, { match }) {
    if (!el.firstChild) {
      el.innerHTML = `
        <div class="scorebug">
          <div class="sb-main">
            <div class="sb-team home"><span class="sb-side"></span><span class="sb-name"></span></div>
            <div class="sb-score home"></div>
            <div class="sb-mid"><span class="sb-period"></span><span class="sb-clock"></span></div>
            <div class="sb-score away"></div>
            <div class="sb-team away"><span class="sb-name"></span><span class="sb-side"></span></div>
          </div>
          <div class="sb-map"></div>
          <div class="sb-history"></div>
        </div>`;
    }
    const cs2 = match.sport === "cs2" ? match.extra : undefined;
    for (const key of ["home", "away"]) {
      const team = match[key];
      const c = teamColor(team, match);
      for (const node of el.querySelectorAll(`.${key}`)) setStyle(node, "--c", c);
      setText(el.querySelector(`.sb-team.${key} .sb-name`), team.shortName || team.name);
      setText(el.querySelector(`.sb-score.${key}`), team.score);
      const side = el.querySelector(`.sb-team.${key} .sb-side`);
      setText(side, cs2 ? team.side : "");
      side.hidden = !cs2;
    }
    setText(el.querySelector(".sb-period"), match.period);
    el.querySelector(".sb-mid").classList.toggle("bomb", cs2?.bomb === "planted");

    const map = el.querySelector(".sb-map");
    setText(map, cs2?.mapName?.replace(/^de_/, "") ?? "");
    map.hidden = !cs2?.mapName;

    // 回合历史：胜方阵营色 + 胜利方式图标；12 回合后留出换边间隔
    const hist = cs2?.roundHistory ?? [];
    const sig = hist.map((r) => `${r.round}${r.winner}${r.reason}`).join();
    const strip = el.querySelector(".sb-history");
    if (strip.dataset.sig !== sig) {
      strip.dataset.sig = sig;
      strip.innerHTML = hist
        .map((r) => `${r.round === 13 ? '<i class="gap"></i>' : ""}<i style="background:${SIDE_COLOR[r.winnerSide]}" title="R${r.round}">${ICON[r.reason] ?? ""}</i>`)
        .join("");
    }
  },

  tick(el, { clockMs }) {
    const ms = clockMs();
    setText(el.querySelector(".sb-clock"), ms === undefined ? "" : fmtClock(ms));
  },
};
