// 首发名单（足球 / 篮球通用）：每行「号码 姓名 位置」，位置可省略
import { animate, esc } from "../lib/util.js";

export default {
  meta: {
    label: "首发名单",
    layer: "fullscreen",
    z: 80,
    fields: [
      { key: "team", label: "球队（home / away）", type: "text", placeholder: "home" },
      { key: "title", label: "标题", type: "text", placeholder: "首发阵容" },
      { key: "players", label: "球员（每行：号码 姓名 位置）", type: "textarea", placeholder: "10 张三 前锋" },
      { key: "coach", label: "主教练", type: "text" },
    ],
  },

  css: `
    .lu { position: absolute; top: 120px; bottom: 120px; left: 140px; width: 620px; display: flex; flex-direction: column; color: var(--lcg-text, #fff);
      background: var(--lcg-panel, rgba(12,14,20,.92)); box-shadow: var(--lcg-shadow, 0 16px 48px rgba(0,0,0,.5)); border-radius: var(--lcg-radius, 0); overflow: hidden; }
    .lu-head { padding: 22px 32px; background: var(--c); }
    .lu-head small { display: block; font-size: 20px; font-weight: 700; opacity: .85; letter-spacing: .08em; }
    .lu-head b { font-size: 44px; font-weight: 900; }
    .lu-list { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 12px 32px; gap: 4px; overflow: hidden; }
    .lu-row { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 16px; font-size: 28px; font-weight: 700; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.08); }
    .lu-num { text-align: center; color: var(--c); font-size: 30px; font-weight: 900; font-variant-numeric: tabular-nums; }
    .lu-pos { color: var(--lcg-muted, #9aa3b5); font-size: 20px; font-weight: 600; }
    .lu-coach { padding: 16px 32px; font-size: 22px; color: var(--lcg-muted, #ccd); background: var(--lcg-panel-sub, rgba(0,0,0,.35)); }
  `,

  async in(el) {
    await animate(el.querySelector(".lu"), [{ opacity: 0, transform: "translateX(-60px)" }, { opacity: 1, transform: "none" }], { duration: 380 });
    await animate(el.querySelectorAll(".lu-row"), [{ opacity: 0, transform: "translateX(-16px)" }, { opacity: 1, transform: "none" }], { duration: 220, stagger: 40 });
  },
  out: (el) => animate(el.querySelector(".lu"), [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-60px)" }], { duration: 280, easing: "ease-in" }),

  render(el, { match, data }) {
    const team = match[data.team === "away" ? "away" : "home"];
    const sig = JSON.stringify([data, team.name, team.color]);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const rows = String(data.players ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [num, name = "", ...pos] = l.split(/\s+/);
        return /^\d+$/.test(num) ? { num, name, pos: pos.join(" ") } : { num: "", name: l, pos: "" };
      });
    el.innerHTML = `
      <div class="lu" style="--c:${esc(team.color ?? "#2f6bff")}">
        <div class="lu-head"><small>${esc(data.title || "首发阵容")}</small><b>${esc(team.name)}</b></div>
        <div class="lu-list">${rows.map((r) => `<div class="lu-row"><span class="lu-num">${esc(r.num)}</span><span>${esc(r.name)}</span><span class="lu-pos">${esc(r.pos)}</span></div>`).join("")}</div>
        ${data.coach ? `<div class="lu-coach">主教练　${esc(data.coach)}</div>` : ""}
      </div>`;
  },
};
