// 人名条 / 解说条：data = { title, subtitle }
export default {
  render(el, { data }) {
    el.innerHTML = `
      <div class="lower-third">
        <div class="lt-title">${esc(data.title)}</div>
        ${data.subtitle ? `<div class="lt-sub">${esc(data.subtitle)}</div>` : ""}
      </div>`;
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
