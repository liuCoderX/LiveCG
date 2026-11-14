// 击杀信息：右上角，新条目滑入，按本机接收时间 7 秒后淡出
import { esc, SIDE_COLOR } from "../lib/util.js";
import { statusIcon, weaponIcon } from "../lib/icons.js";

const TTL = 7000;

export default {
  meta: { label: "击杀信息", layer: "killfeed", z: 30 },

  css: `
    .kf { position: absolute; top: 36px; right: 40px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .kf-item { display: flex; align-items: center; gap: 10px; padding: 6px 14px; background: var(--lcg-panel, rgba(12,14,20,.86)); color: var(--lcg-text, #fff); border-radius: var(--lcg-radius, 0); font-size: 18px; font-weight: 700;
      animation: kf-in .25s ease-out; transition: opacity .5s, transform .5s; }
    .kf-item.hs { box-shadow: inset 0 0 0 2px var(--lcg-danger, #e5484d); }
    .kf-item.out { opacity: 0; transform: translateX(30px); }
    .kf-w { display: inline-flex; align-items: center; font-size: 24px; line-height: 1; color: var(--lcg-text, #fff); }
    .kf-hs { display: inline-flex; align-items: center; font-size: 20px; line-height: 1; color: var(--lcg-text, #fff); margin-left: -4px; }
    @keyframes kf-in { from { opacity: 0; transform: translateX(40px); } }
  `,

  render(el, { match }) {
    if (!el.firstChild) el.innerHTML = `<div class="kf"></div>`;
    const box = el.firstChild;
    const feed = match.extra?.killfeed ?? [];
    const ids = new Set(feed.map((k) => k.id));
    for (const node of [...box.children]) if (!ids.has(node.dataset.id)) node.remove();
    for (const k of feed) {
      if (box.querySelector(`[data-id="${k.id}"]`)) continue;
      const who = (p) => (p ? `<span style="color:${SIDE_COLOR[p.side]}">${esc(p.name)}</span>` : "");
      const item = document.createElement("div");
      item.className = `kf-item${k.headshot ? " hs" : ""}`;
      item.dataset.id = k.id;
      item.dataset.at = String(Date.now());
      // 击杀者 · 武器 · 爆头 · 被杀者；没有击杀者（自杀、炸弹、坠落）只显示骷髅
      item.innerHTML = `${who(k.killer)}<span class="kf-w">${k.killer ? weaponIcon(k.weapon) : statusIcon("elimination")}</span>${k.headshot ? `<span class="kf-hs">${statusIcon("headshot")}</span>` : ""}${who(k.victim)}`;
      box.appendChild(item);
    }
  },

  tick(el) {
    const now = Date.now();
    for (const item of el.querySelectorAll(".kf-item:not(.out)")) {
      if (now - Number(item.dataset.at) > TTL) item.classList.add("out");
    }
  },
};
