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
3. 重启游戏，比分条会自动跟随比赛数据更新。

## 目录

| 路径 | 说明 |
|---|---|
| `apps/server` | 核心服务：状态中心、WebSocket、数据适配器 |
| `apps/graphics` | 图文输出页与模板 |
| `apps/control` | 操作员控制台 |
| `packages/shared` | 共享类型与协议 |
| `integrations/` | 第三方接入配置 |
| `docs/` | 设计文档 |
