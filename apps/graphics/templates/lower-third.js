// 人名条 / 解说条：data = { title, subtitle }
import { esc } from "../lib/util.js";

export default {
  css: `
    .lower-third { position: absolute; left: 120px; bottom: 120px; color: #fff; }
    .lt-title { background: #2f6bff; padding: 12px 28px; font-size: 40px; font-weight: 800; }
    .lt-sub { background: rgba(0,0,0,.8); padding: 8px 28px; font-size: 24px; display: inline-block; }
  `,
  render(el, { data }) {
    el.innerHTML = `
      <div class="lower-third">
        <div class="lt-title">${esc(data.title)}</div>
        ${data.subtitle ? `<div class="lt-sub">${esc(data.subtitle)}</div>` : ""}
      </div>`;
  },
};
