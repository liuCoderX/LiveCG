// 模板共用工具
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// 阵营色走主题变量（内联 style 同样生效），回退值为默认配色
export const SIDE_COLOR = { CT: "var(--lcg-ct, #5b9bf0)", T: "var(--lcg-t, #e8b04b)" };

/** 队伍主色：CS2 下跟随阵营，其它项目用队伍配置色 */
export const teamColor = (team, match) =>
  (match.sport === "cs2" && team.side && SIDE_COLOR[team.side]) || team.color || "#555";

export const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** 篮球等倒计时：最后一分钟显示十分之一秒（58.3），否则 m:ss */
export const fmtGameClock = (ms, { tenthsUnderMs = 60_000 } = {}) => {
  if (ms === undefined) return "";
  if (ms < tenthsUnderMs) return (Math.floor(ms / 100) / 10).toFixed(1);
  // 与十分之一秒段保持一致地截断（不能向上取整，否则会从 1:01 直接跳到 59.9）
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** 足球正计时：mm:ss，分钟不封顶（90:00、105:00） */
export const fmtMatchClock = (ms) => {
  if (ms === undefined) return "";
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** 进攻时钟：5 秒以下显示十分之一秒，否则整数秒（向上取整，与场馆计时器一致） */
export const fmtShotClock = (ms) => (ms === undefined ? "" : ms < 5_000 ? (Math.floor(ms / 100) / 10).toFixed(1) : String(Math.ceil(ms / 1000)));

export const money =(n) => `$${Number(n ?? 0).toLocaleString("en-US")}`;

/** 只在值变化时写 DOM，避免高频数据打断 CSS 过渡 */
export const setText = (el, v) => {
  const s = String(v ?? "");
  if (el.textContent !== s) el.textContent = s;
};

/**
 * 内联 SVG 图标：不依赖播出机字体（emoji/特殊符号在不同系统上可能显示为方框）
 * 统一 viewBox 16x16，颜色跟随 currentColor
 */
const svg = (d) => `<svg class="ico" viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" aria-hidden="true">${d}</svg>`;
export const ICON = {
  // 全歼：骷髅
  elimination: svg('<path d="M8 1.5C4.6 1.5 2.5 3.8 2.5 6.6c0 1.7.8 3 2 3.8V13h2v-1.5h1V13h1v-1.5h1V13h2v-2.6c1.2-.8 2-2.1 2-3.8 0-2.8-2.1-5.1-5.5-5.1zM5.8 8.7a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/>'),
  // 爆炸
  bomb: svg('<path d="M8 .5l1.4 4 3.9-1.9-1.9 3.9 4 1.5-4 1.4 1.9 3.9-3.9-1.9L8 15.5l-1.4-4.1-3.9 1.9 1.9-3.9-4-1.4 4-1.5-1.9-3.9 3.9 1.9z"/>'),
  // 拆包：钳子
  defuse: svg('<path d="M3 2l4.2 5.2L3.6 13 5 14l3-4.7 3 4.7 1.4-1-3.6-5.8L13 2l-1.4-.9L8 6.2 4.4 1.1z"/>'),
  // 超时：时钟
  time: svg('<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 1.8a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4zM7.2 4.5v4.1l3.2 1.9.8-1.3-2.4-1.4V4.5z"/>'),
  // 护甲 / 头盔 / 拆弹器 / C4
  armor: svg('<path d="M8 1L2.5 3v4.2c0 3.5 2.4 6.4 5.5 7.8 3.1-1.4 5.5-4.3 5.5-7.8V3z"/>'),
  helmet: svg('<path d="M8 2.5C4.4 2.5 2 5.1 2 8.5V11h12V8.5c0-3.4-2.4-6-6-6zM1 12h14v1.5H1z"/>'),
  // 拆弹器：工具包
  kit: svg('<path fill-rule="evenodd" d="M2 5h12v9H2zm4.2 2.4v1.8h-1.8v1.6h1.8v1.8h1.6v-1.8h1.8V9.2H7.8V7.4z"/><path d="M5.5 2.2h5v2.3H9.2v-1H6.8v1H5.5z"/>'),
  c4: svg('<path d="M2 4h12v9H2zM4 6v2h2V6zm3 0v2h2V6zm3 0v2h2V6zM4 9.5V11h8V9.5zM6 1.5h4V3H6z"/>'),
  // 爆头：准星
  headshot: svg('<path fill-rule="evenodd" d="M8 2.2a5.8 5.8 0 1 1 0 11.6A5.8 5.8 0 0 1 8 2.2zm0 1.5a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6z"/><path d="M7.3 0h1.4v4.6H7.3zm0 11.4h1.4V16H7.3zM0 7.3h4.6v1.4H0zm11.4 0H16v1.4h-4.6z"/><circle cx="8" cy="8" r="1.5"/>'),
  // 道具（内置的简化图形；放了图标包时用游戏原版图标）
  hegrenade: svg('<circle cx="8" cy="9.6" r="5"/><path d="M6.4 2.2h3.2v2.6H6.4zm3.6.3 3.1-1.2.5 1.3-3.1 1.2z"/>'),
  flashbang: svg('<path fill-rule="evenodd" d="M5 4.2h6v10.6H5zM6 8.6h4v1.2H6z"/><path d="M6.2 1.4h3.6v2.2H6.2zm3.9.4 2.6-.9.4 1.1-2.6 1z"/>'),
  smokegrenade: svg('<path fill-rule="evenodd" d="M4.2 4.2h7.6v10.6H4.2zm1.2 2.6h5.2v1.1H5.4zm0 2.6h5.2v1.1H5.4z"/><path d="M6.2 1.4h3.6v2.2H6.2z"/>'),
  molotov: svg('<path d="M6.4 6.2h3.2v1.5l1.6 2.1v5.2H4.8V9.8l1.6-2.1zM7.6 4.6h.8v1.2h-.8zM8 .6c1.4 1.3 1.6 2.4.8 3.6H7.2C6.4 3 6.6 1.9 8 .6z"/>'),
  incgrenade: svg('<path d="M4.8 7h6.4v7.8H4.8zM8 .8c2 1.8 2.4 3.4 1.3 5.2H6.7C5.6 4.2 6 2.6 8 .8z"/>'),
  decoy: svg('<path fill-rule="evenodd" d="M8 4a5.2 5.2 0 1 1 0 10.4A5.2 5.2 0 0 1 8 4zm0 2.9a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z"/><path d="M7 1.4h2v2.2H7z"/>'),
  unknown: "",
};

/**
 * 入/出场动画工具（Web Animations API，无第三方依赖）。
 * 返回 Promise，所有元素动画完成后 resolve；stagger 为相邻元素的错峰毫秒数。
 */
export const animate = (targets, keyframes, { duration = 350, easing = "cubic-bezier(.2,.8,.2,1)", delay = 0, stagger = 0 } = {}) => {
  const list = [].concat(targets instanceof NodeList ? [...targets] : targets).filter(Boolean);
  return Promise.all(
    list.map((node, i) => {
      // 取消该元素上一轮由脚本创建的入/出场动画（保留 CSS 动画如闪烁），避免 fill 叠加
      for (const a of node.getAnimations()) if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) a.cancel();
      return node.animate(keyframes, { duration, easing, delay: delay + i * stagger, fill: "both" }).finished.catch(() => {});
    }),
  );
};

export const setStyle = (el, prop, v) => {
  if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v);
};
