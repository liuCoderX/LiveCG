// CS2 选手血量 / 经济条：主队在左下，客队在右下
// 按 steamid 增量更新 DOM，血条宽度走 CSS 过渡，不会被 10Hz 数据打断
import { esc, ICON, money, setStyle, setText, teamColor } from "../lib/util.js";

const WEAPON_NAME = {
  ak47: "AK-47", m4a1_silencer: "M4A1-S", m4a1: "M4A4", awp: "AWP", famas: "FAMAS", galilar: "Galil", aug: "AUG", sg556: "SG 553",
  ssg08: "SSG 08", mp9: "MP9", mac10: "MAC-10", ump45: "UMP-45", p90: "P90", deagle: "Deagle", usp_silencer: "USP-S",
  glock: "Glock", p250: "P250", fiveseven: "Five-SeveN", tec9: "Tec-9", cz75a: "CZ75", hkp2000: "P2000",
};
export const weaponLabel = (w) => (w ? WEAPON_NAME[w] ?? w.toUpperCase() : "");

export default {
  css: `
    .pb-col { position: absolute; bottom: 40px; width: 430px; display: flex; flex-direction: column; gap: 4px; color: #fff; }
    .pb-col.home { left: 40px; }
    .pb-col.away { right: 40px; }
    .pb-head { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 12px; background: var(--c); color: #111; font-weight: 800; font-size: 18px; }
    .pb-head small { font-size: 14px; font-weight: 700; opacity: .8; }
    .pb-row { position: relative; display: grid; grid-template-columns: 26px 1fr auto 52px; align-items: center; gap: 8px; height: 46px; padding: 0 10px; background: rgba(12,14,20,.86); overflow: hidden; transition: opacity .3s; }
    .pb-col.away .pb-row { grid-template-columns: 52px auto 1fr 26px; text-align: right; }
    .pb-col.away .pb-row > :nth-child(1) { order: 4; } .pb-col.away .pb-row > :nth-child(2) { order: 3; }
    .pb-col.away .pb-row > :nth-child(3) { order: 2; } .pb-col.away .pb-row > :nth-child(4) { order: 1; }
    .pb-hpbar { position: absolute; left: 0; bottom: 0; height: 4px; width: var(--hp); background: var(--c); transition: width .35s ease; }
    .pb-col.away .pb-hpbar { left: auto; right: 0; }
    .pb-row.low .pb-hpbar { background: #e5484d; }
    .pb-slot { font-size: 14px; color: #889; font-variant-numeric: tabular-nums; }
    .pb-name { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb-sub { display: block; font-size: 12px; font-weight: 500; color: #aab; }
    .pb-stats { font-size: 13px; color: #ccd; font-variant-numeric: tabular-nums; line-height: 1.25; }
    .pb-money { color: #8fd18f; }
    .pb-hp { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .pb-row.dead { opacity: .45; }
    .pb-row.dead .pb-hp { font-size: 14px; color: #e5484d; }
    .pb-row.observed { box-shadow: inset 0 0 0 2px #fff; }
    .pb-icons { display: inline-flex; gap: 3px; vertical-align: middle; color: #ccd; font-size: 14px; margin: 0 6px; }
    .pb-icons .c4 { color: #e5484d; display: inline-flex; }
  `,

  render(el, { match }) {
    const cs2 = match.extra ?? {};
    const players = cs2.players ?? [];
    const sig = players.map((p) => `${p.steamid}:${p.team}`).join();
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = ["home", "away"]
        .map((team) => `
          <div class="pb-col ${team}">
            <div class="pb-head"><span class="pb-team"></span><small class="pb-eco"></small></div>
            ${players.filter((p) => p.team === team).map((p) => `
              <div class="pb-row" data-id="${esc(p.steamid)}">
                <span class="pb-slot"></span>
                <span class="pb-name"><span class="n"></span><span class="pb-icons"></span><span class="pb-sub"></span></span>
                <span class="pb-stats"></span>
                <span class="pb-hp"></span>
                <span class="pb-hpbar"></span>
              </div>`).join("")}
          </div>`)
        .join("");
    }

    for (const team of ["home", "away"]) {
      const col = el.querySelector(`.pb-col.${team}`);
      setStyle(col, "--c", teamColor(match[team], match));
      setText(col.querySelector(".pb-team"), match[team].shortName || match[team].name);
      const eco = cs2.economy?.[team];
      setText(col.querySelector(".pb-eco"), eco ? `${money(eco.money)} · 装备 ${money(eco.equipValue)}` : "");
    }

    for (const p of players) {
      const row = el.querySelector(`.pb-row[data-id="${CSS.escape(p.steamid)}"]`);
      if (!row) continue;
      row.classList.toggle("dead", !p.alive);
      row.classList.toggle("low", p.alive && p.hp <= 30);
      row.classList.toggle("observed", p.steamid === cs2.observed);
      setStyle(row, "--hp", `${p.alive ? p.hp : 0}%`);
      setText(row.querySelector(".pb-slot"), p.slot ?? "");
      setText(row.querySelector(".n"), p.name);
      const icons = row.querySelector(".pb-icons");
      const iconHtml = p.alive ? [p.armor > 0 ? (p.helmet ? ICON.helmet : ICON.armor) : "", p.defuser ? ICON.kit : "", p.hasBomb ? `<b class="c4">${ICON.c4}</b>` : ""].join("") : "";
      if (icons.innerHTML !== iconHtml) icons.innerHTML = iconHtml;
      setText(row.querySelector(".pb-sub"), p.alive ? weaponLabel(p.weapon) : "");
      setText(row.querySelector(".pb-hp"), p.alive ? p.hp : "阵亡");
      const stats = row.querySelector(".pb-stats");
      const html = `<span class="pb-money">${money(p.money)}</span><br>${p.kills}/${p.deaths}/${p.assists}${p.adr ? ` · ${p.adr}` : ""}`;
      if (stats.innerHTML !== html) stats.innerHTML = html;
    }
  },
};
