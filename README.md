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
- 图文输出：http://localhost:3000/graphics/（1920×1080，透明背景；加 `?preview` 显示棋盘格，加 `?layers=scorebug` 只输出指定图层）
- 状态接口：`GET /api/state`

## 接入 CS2

1. 将 `integrations/cs2/gamestate_integration_livecg.cfg` 复制到 CS2 的 `game/csgo/cfg/` 目录（建议在 OB 观察者机器上）。
2. 修改其中的 `uri` 指向 LiveCG 服务地址，`token` 与环境变量 `CS2_GSI_TOKEN` 保持一致。
3. 重启游戏，比分、回合、选手数据会自动跟随比赛更新。
4. 在控制台 TAKE「比分条 / 选手血量经济 / 击杀信息」；回合结算默认在回合结束时自动上屏。
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
