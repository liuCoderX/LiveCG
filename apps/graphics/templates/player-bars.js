// CS2 选手血量 / 经济条：主队在左下，客队在右下
// 按 steamid 增量更新 DOM，血条宽度走 CSS 过渡，不会被 10Hz 数据打断
import { animate, esc, money, setStyle, setText, teamColor } from "../lib/util.js";
import { statusIcon, weaponIcon } from "../lib/icons.js";

// 兼容旧引用
export { weaponLabel } from "../lib/icons.js";

const slide = (el, dir) => {
  const rows = (side) => el.querySelectorAll(`.pb-col.${side} > *`);
  const from = { home: "translateX(-110%)", away: "translateX(110%)" };
  const frames = (side) => (dir === "in" ? [{ transform: from[side], opacity: 0 }, { transform: "none", opacity: 1 }] : [{ transform: "none", opacity: 1 }, { transform: from[side], opacity: 0 }]);
  const opts = dir === "in" ? { duration: 380, stagger: 45 } : { duration: 240, stagger: 25, easing: "ease-in" };
  return Promise.all([animate(rows("home"), frames("home"), opts), animate(rows("away"), frames("away"), opts)]);
};

export default {
  meta: { label: "选手血量/经济", layer: "player-bars", z: 20 },
  // 入场：两侧逐行滑入；出场：逐行滑出
  in: (el) => slide(el, "in"),
  out: (el) => slide(el, "out"),

  css: `
    .pb-col { position: absolute; bottom: 40px; width: 430px; display: flex; flex-direction: column; gap: 4px; color: var(--lcg-text, #fff); }
    .pb-col.home { left: 40px; }
    .pb-col.away { right: 40px; }
    .pb-head { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 12px; border-radius: var(--lcg-radius, 0); background: var(--c); color: #111; font-weight: 800; font-size: 18px; }
    .pb-head small { font-size: 14px; font-weight: 700; opacity: .8; }
    .pb-row { position: relative; display: grid; grid-template-columns: 26px 1fr auto 52px; align-items: center; gap: 8px; height: 50px; padding: 0 10px 3px; background: var(--lcg-panel, rgba(12,14,20,.86)); border-radius: var(--lcg-radius, 0); overflow: hidden; transition: opacity .3s; }
    .pb-col.away .pb-row { grid-template-columns: 52px auto 1fr 26px; text-align: right; }
    .pb-col.away .pb-row > :nth-child(1) { order: 4; } .pb-col.away .pb-row > :nth-child(2) { order: 3; }
    .pb-col.away .pb-row > :nth-child(3) { order: 2; } .pb-col.away .pb-row > :nth-child(4) { order: 1; }
    .pb-hpbar { position: absolute; left: 0; bottom: 0; height: 4px; width: var(--hp); background: var(--c); transition: width .35s ease; }
    .pb-col.away .pb-hpbar { left: auto; right: 0; }
    .pb-row.low .pb-hpbar { background: var(--lcg-danger, #e5484d); }
    .pb-slot { font-size: 14px; color: var(--lcg-muted, #889); font-variant-numeric: tabular-nums; }
    .pb-name { font-size: 20px; line-height: 1.15; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb-sub { display: flex; align-items: center; gap: 6px; height: 18px; margin-top: 2px; font-size: 18px; line-height: 1; color: var(--lcg-muted, #ccd); }
    .pb-col.away .pb-sub { justify-content: flex-end; }
    .pb-gren { display: inline-flex; gap: 2px; font-size: 13px; opacity: .85; }
    .pb-stats { font-size: 13px; color: var(--lcg-muted, #ccd); font-variant-numeric: tabular-nums; line-height: 1.25; }
    .pb-money { color: var(--lcg-positive, #8fd18f); }
    .pb-hp { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .pb-row.dead { opacity: .45; }
    .pb-row.dead .pb-hp { display: grid; place-items: center; font-size: 22px; color: var(--lcg-danger, #e5484d); }
    .pb-row.observed { box-shadow: inset 0 0 0 2px var(--lcg-text, #fff); }
    .pb-icons { display: inline-flex; gap: 3px; vertical-align: middle; color: var(--lcg-muted, #ccd); font-size: 14px; margin: 0 6px; }
    .pb-icons .c4 { color: var(--lcg-danger, #e5484d); display: inline-flex; }
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
      const iconHtml = p.alive ? [p.armor > 0 ? statusIcon(p.helmet ? "armor_helmet" : "armor") : "", p.defuser ? statusIcon("defuser") : "", p.hasBomb ? `<b class="c4">${statusIcon("c4")}</b>` : ""].join("") : "";
      if (icons.innerHTML !== iconHtml) icons.innerHTML = iconHtml;
      // 第二行：主武器 + 道具；客队一侧镜像排列（道具在外侧）
      const sub = row.querySelector(".pb-sub");
      const gren = (p.grenades ?? []).map((g) => statusIcon(g)).join("");
      const parts = p.alive ? [weaponIcon(p.weapon), gren ? `<span class="pb-gren">${gren}</span>` : ""] : [];
      const subHtml = (p.team === "away" ? parts.reverse() : parts).join("");
      if (sub.innerHTML !== subHtml) sub.innerHTML = subHtml;
      // 阵亡：骷髅图标代替血量
      const hp = row.querySelector(".pb-hp");
      if (p.alive) setText(hp, p.hp);
      else if (!hp.querySelector("svg, .lcg-ico")) hp.innerHTML = statusIcon("elimination");
      const stats = row.querySelector(".pb-stats");
      const html = `<span class="pb-money">${money(p.money)}</span><br>${p.kills}/${p.deaths}/${p.assists}${p.adr ? ` · ${p.adr}` : ""}`;
      if (stats.innerHTML !== html) stats.innerHTML = html;
    }
  },
};
