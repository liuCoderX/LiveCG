# LiveCG

实时字幕图文系统：面向**电竞**（CS2 等）与**传统体育**直转播的在线包装（CG）平台。
数据自动驱动 + 操作员手动控制，输出透明 HTML5 图文，可在 CasparCG / OBS / vMix 中作为 Browser Source 叠加。

设计文档见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

需要 Node.js 22+ 与 pnpm。

```bash
pnpm install
pnpm dev
```

- 控制台：http://localhost:3000/control/
- 图文输出（PGM）：http://localhost:3000/graphics/?channel=pgm
- 图文输出（PVW）：http://localhost:3000/graphics/?channel=pvw

输出页为 1920×1080 透明背景，在 OBS / vMix 中作为 Browser Source 加载，或由 LiveCG 自动加载到 CasparCG（见下文）。
监看参数：`?preview` 棋盘格背景、`?safe` 安全区参考线、`?layers=scorebug,lt` 只输出指定图层。

配置、播出单和队伍资料保存在 `data/runtime/livecg.json`，重启不丢（可用 `LIVECG_DATA_DIR` 指定目录）。

## 播出操作

1. **播出单**：左侧列出预先编排好的图文。点「＋ 新建」选择模板、填写字段、设置热键；模板决定有哪些字段。
2. **CUE → TAKE**：选中条目按 **回车**（或点 CUE）预备到 PVW，确认画面后按 **空格**（或点 TAKE）切到 PGM。
3. **热键直出**：条目的单键热键（1–9 / A–Z）直接上 PGM，再按一次下屏；同图层换另一条会自动先出场再入场。
4. **在播修改**：编辑正在播出的条目并保存，画面只更新文字、不重播入场（适合实时字幕）。
5. **紧急下屏**：Esc 清空 PVW，Shift + Esc 让 PGM 全部下屏。

| 热键 | 作用 |
|---|---|
| 空格 | TAKE：PVW → PGM |
| 回车 | CUE 选中条目到 PVW，并选中下一条 |
| ↑ / ↓ | 选择播出单条目 |
| 1–9 / A–Z | 条目热键：上屏 / 再按下屏 |
| Esc / Shift + Esc | 清空 PVW / PGM 全部下屏 |

## 外部控制（Stream Deck / Companion / 脚本）

所有控制台操作都可以通过 HTTP 调用，body 与控制台发出的指令相同：

```bash
curl -X POST http://localhost:3000/api/command -d '{"type":"graphic.take"}'
```

常用指令：`{"type":"rundown.fire","id":"<条目 id>"}`（热键同款上/下屏）、`{"type":"rundown.cue"}`、`{"type":"graphic.take"}`、`{"type":"graphic.clearAll"}`、`{"type":"graphic.update","layer":"caption","data":{"text":"…"}}`。
条目 id 可在 `GET /api/state` 的 `rundown.items` 中查到。Bitfocus Companion 用「Generic HTTP → POST」动作即可绑定到 Stream Deck 按键。

> 控制接口没有鉴权，只应在制作内网使用，不要暴露到公网。

## 接入 CasparCG

1. 控制台右侧「CasparCG」中勾选启用，填写 CasparCG 地址和 AMCP 端口（默认 5250）。
2. 「LiveCG 地址」填 **CasparCG 那台机器能访问到的** LiveCG 地址（如 `http://192.168.1.20:3000`），不同机器时不能用 localhost。
3. 设置每路输出的通道 / 层：默认 PGM → 通道 1 层 20；PVW → 通道 2 层 20（默认关闭）。
4. 保存后 LiveCG 会发送 `PLAY 1-20 [HTML] "…/graphics/?channel=pgm"`，之后的上下屏全部在页面内完成；CasparCG 重启后会自动重新加载。

> CasparCG 较老版本内置的 Chromium 可能不支持输出页使用的现代 JS 语法，建议 2.4 或更新版本，上线前在实际版本上完整验证。模板开发见 [docs/TEMPLATES.md](docs/TEMPLATES.md)。

## 接入 CS2

1. 将 `integrations/cs2/gamestate_integration_livecg.cfg` 复制到 CS2 的 `game/csgo/cfg/` 目录（建议在 OB 观察者机器上）。
2. 修改其中的 `uri` 指向 LiveCG 服务地址，`token` 与环境变量 `CS2_GSI_TOKEN` 保持一致。
3. 重启游戏，比分、回合、选手数据会自动跟随比赛更新。
4. 用播出单热键 1 / 2 / 3 上屏「比分条 / 选手血量经济 / 击杀信息」；回合结算默认在回合结束时自动上屏、下一回合开始自动下屏。
5. 有播出延迟时，在控制台「CS2 数据 → 数据延迟」填入相同毫秒数（也可用环境变量 `CS2_DELAY_MS`）。

### 不开游戏联调：模拟器

服务启动后，在另一个终端运行：

```bash
pnpm sim:cs2
```

会按 4 倍速推送一整场模拟比赛（含换边、炸弹、经济）。常用参数：`--speed 1`（实时）、`--seed 7`（复现同一场）、`--rounds 6`、`--no-players`（模拟非 OB 客户端）、`--url http://<服务地址>:3000`。

## 测试

```bash
pnpm test
```

## 目录

| 路径 | 说明 |
|---|---|
| `apps/server` | 核心服务：状态中心、WebSocket、数据适配器 |
| `apps/graphics` | 图文输出页与模板 |
| `apps/control` | 操作员控制台 |
| `packages/shared` | 共享类型与协议 |
| `integrations/` | 第三方接入配置 |
| `docs/` | 设计文档 |
