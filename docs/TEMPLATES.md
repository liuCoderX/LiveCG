# 图文模板开发规范

模板是 `apps/graphics/templates/<name>.js` 下的一个 ES Module，默认导出一个对象。
输出页（`/graphics/`）和控制台都直接加载这同一个文件：输出页用它渲染，控制台读取 `meta` 生成播出单编辑表单。
新增模板只需放一个文件，**无需改服务端或控制台代码**。

## 接口

```js
import { animate } from "../lib/util.js";

export default {
  // 必填：控制台显示名、默认图层、叠放顺序；fields 决定播出单里可编辑的字段
  meta: {
    label: "人名条",
    layer: "lt",
    z: 50,
    fields: [
      { key: "title", label: "主标题", type: "text", placeholder: "解说 张三" },
      { key: "subtitle", label: "副标题", type: "text" },
    ],
  },

  // 可选：首次加载时注入一次的样式
  css: `.lower-third { ... }`,

  // 必填：每次数据变化都会调用。必须是幂等的增量更新（见下文）
  render(el, ctx) {},

  // 可选：每帧调用（只在图层 on 时），用于时钟、限时淡出等不依赖推送的动画
  tick(el, ctx) {},

  // 可选：入场 / 出场动画，返回 Promise，resolve 后才算完成
  in(el, ctx) { return animate(...); },
  out(el, ctx) { return animate(...); },
};
```

`ctx` 内容：

| 字段 | 说明 |
|---|---|
| `match` | 通用赛况（比分、队伍、`extra` 中的项目数据，如 CS2 选手/经济） |
| `data` | 本图层的数据（播出单条目里填写的字段，或 `graphic.update` 推送的数据） |
| `state` | 完整状态（一般用不到） |
| `channel` | `"pgm"` 或 `"pvw"` |
| `clockMs(name?)` | 本机插值后的时钟毫秒数：默认主时钟，`clockMs("shotClock")` 为进攻时钟；没有时为 `undefined` |

## 生命周期（输出页状态机保证）

| 情况 | 调用 |
|---|---|
| 上屏（show / take） | `render` → `tick` → `in` |
| 在播时数据更新（`graphic.update`、比赛数据变化） | 仅 `render`，**不重播入场** |
| 同一图层重新上屏（新的 takeId，如热键换下一位解说） | `out` 播完 → `render` → `in` |
| 换模板 | 旧模板 `out` → 清空图层 → 新模板 `render` → `in` |
| 下屏 | `out`，结束后图层隐藏 |

- 动画是**串行**的：入场没播完时收到下屏，会等入场结束再出场；期间到来的多次更新会合并为最后一次。
- 没有提供 `in` / `out` 的模板使用默认动画（整体淡入上移 300ms / 淡出 250ms）。
- 模板抛出的异常会被捕获并打印，不会影响其它图层。

## 编写要求

1. **`render` 必须增量更新。** 首次调用时搭建 DOM，之后只改变化的文字/样式（用 `setText`、`setStyle`）。
   每次 `innerHTML` 重建会打断正在进行的 CSS 过渡和入场动画，在 CS2 10Hz 数据下还会造成闪烁。
   只有低频且整块替换的内容（如回合结算）可以在签名变化时重建。
2. **动画用 `animate()`**（Web Animations API 封装，`util.js`）。它会先取消该元素上一轮脚本动画，避免 `fill` 叠加；CSS 关键帧动画（如炸弹闪烁）不受影响。
   如果元素本身有 `transform`（如居中用的 `translateX(-50%)`），关键帧里要带上它。
3. **不要依赖系统字体里的符号/emoji。** 图标用 `util.js` 的 `ICON`（内联 SVG），播出机字体千差万别。
4. **画布固定 1920×1080、透明背景。** 重要信息放在字幕安全区内（输出页加 `?safe` 可看参考线）。
5. **用户输入一律转义**（`esc()` 或 `textContent`），播出单字段可能来自任何操作员。
6. **`z`** 约定：比分条 10、选手条 20、击杀 30、结算 40、人名条 50、比赛事件 55、字幕 60、全屏类（首发名单等）80。
7. **时钟只在 `tick` 里读。** `render` 只在数据变化时调用，时钟走表靠每帧的 `tick` + `clockMs()`；格式化用 `util.js` 的 `fmtGameClock`（篮球，最后一分钟带十分之一秒）、`fmtMatchClock`（足球 mm:ss）、`fmtShotClock`。

## 兼容性

输出页使用现代浏览器特性（ES Module、可选链 `?.`、Web Animations API）。OBS、vMix、Chrome 均可直接使用。
CasparCG 的 HTML producer 内置 Chromium（CEF），**较老版本的 CasparCG 内置的 Chromium 版本较旧，可能不支持以上语法**；
建议使用 CasparCG 2.4 或更新版本，并在上线前用实际播出机版本完整验证一遍所有模板。
