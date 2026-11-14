// 人名条 / 解说条：data = { title, subtitle }
import { animate } from "../lib/util.js";

export default {
  meta: {
    label: "人名条",
    layer: "lt",
    z: 50,
    fields: [
      { key: "title", label: "主标题", type: "text", placeholder: "解说 张三" },
      { key: "subtitle", label: "副标题", type: "text", placeholder: "LiveCG 电竞频道" },
    ],
  },

  css: `
    .lower-third { position: absolute; left: 120px; bottom: 120px; color: var(--lcg-text, #fff); display: flex; flex-direction: column; align-items: flex-start; }
    .lt-title { background: var(--lcg-accent, #2f6bff); color: var(--lcg-on-accent, #fff); box-shadow: var(--lcg-shadow, none); border-radius: var(--lcg-radius, 0); padding: 12px 28px; font-size: 40px; font-weight: 800; }
    .lt-sub { background: var(--lcg-panel-sub, rgba(0,0,0,.8)); border-radius: var(--lcg-radius, 0); padding: 8px 28px; font-size: 24px; }
  `,

  // 入场：主标题从左擦出，副标题从主标题下方滑出；出场反向
  async in(el) {
    await animate(el.querySelector(".lt-title"), [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 420 });
    await animate(el.querySelector(".lt-sub"), [{ clipPath: "inset(0 0 100% 0)", transform: "translateY(-100%)" }, { clipPath: "inset(0 0 0 0)", transform: "none" }], { duration: 300 });
  },
  async out(el) {
    await animate(el.querySelector(".lt-sub"), [{ opacity: 1 }, { opacity: 0 }], { duration: 150 });
    await animate(el.querySelector(".lt-title"), [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], { duration: 300, easing: "ease-in" });
  },

  render(el, { data }) {
    if (!el.firstChild) el.innerHTML = `<div class="lower-third"><div class="lt-title"></div><div class="lt-sub"></div></div>`;
    const title = el.querySelector(".lt-title");
    const sub = el.querySelector(".lt-sub");
    // 只改文字、保留节点：在播时更新数据不会打断动画或闪烁
    if (title.textContent !== String(data.title ?? "")) title.textContent = data.title ?? "";
    if (sub.textContent !== String(data.subtitle ?? "")) sub.textContent = data.subtitle ?? "";
    sub.hidden = !data.subtitle;
  },
};
