// 比分条：数据直接来自 match 状态（自动跟随 CS2 GSI 或手动比分），layer.data 可覆盖
export default {
  render(el, { match }) {
    const t = (team) => `
      <div class="sb-team" style="--c:${team.color ?? "#444"}">
        <span class="sb-name">${esc(team.shortName ?? team.name)}</span>
        <span class="sb-score">${team.score}</span>
      </div>`;
    el.innerHTML = `
      <div class="scorebug">
        ${t(match.home)}
        <div class="sb-mid">${esc(match.period || match.extra?.mapName || "")}</div>
        ${t(match.away)}
      </div>`;
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
