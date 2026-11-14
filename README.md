# LiveCG

实时字幕图文系统：面向**电竞**（CS2 等）与**传统体育**直转播的在线包装（CG）平台。
数据自动驱动 + 操作员手动控制，输出透明 HTML5 图文，可在 CasparCG / OBS / vMix 中作为 Browser Source 叠加。

设计文档见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；上线前的真机联调按 [docs/DEPLOYMENT-CHECKLIST.md](docs/DEPLOYMENT-CHECKLIST.md) 逐项演练。

## 快速开始

需要 Node.js 22+ 与 pnpm。

```bash
pnpm install
```

```bash
pnpm start
```

`pnpm start` 会先构建控制台（React，产物在 `apps/control/dist`）再启动服务。开发时用 `pnpm dev`：控制台改动自动重新构建，服务端改动自动重启（刷新浏览器即可看到）。

- 房间列表：http://localhost:3000/ （自动跳转到 `/control/rooms.html`）
- 控制台：http://localhost:3000/control/?room=default
- 图文输出（PGM）：http://localhost:3000/graphics/?room=default&channel=pgm
- 图文输出（PVW）：http://localhost:3000/graphics/?room=default&channel=pvw

输出页为 1920×1080 透明背景，在 OBS / vMix 中作为 Browser Source 加载，或由 LiveCG 自动加载到 CasparCG（见下文）。
监看参数：`?preview` 棋盘格背景、`?safe` 安全区参考线、`?layers=scorebug,lt` 只输出指定图层。
不带 `room` 的地址一律指向默认房间，旧版本配好的 OBS / CasparCG 地址无需修改。

## 多房间（同时转播多场比赛）

一台 LiveCG 服务可以同时承载多场比赛，每个**房间**是一场独立的赛事：比分、时钟、播出单、PVW/PGM、CS2 接入、计分器和 CasparCG 连接都互不影响。

1. 打开房间列表页，填写名称（标识可选，用于网址，如 `court-2`）创建房间；「复制设置」可以从已有房间复制播出单、队伍资料和配置。
2. 每张房间卡片上有该房间的控制台入口，以及所有地址（输出页、CS2 GSI、指令 API），可直接复制。
3. 控制台顶栏可以在房间之间切换。
4. 删除房间前需要先让该房间的 PGM 全部下屏；数据文件会保留为 `.deleted-时间戳` 备份，不做物理删除。默认房间不能删除。

为避免两场比赛互相覆盖，LiveCG 会拒绝以下配置：两个房间监听同一个计分器 UDP 端口；任意两路输出占用同一台 CasparCG 的同一「通道-层」。
复制房间时 CasparCG 和计分器连接默认关闭，需要在新房间里配好各自的端口 / 层再启用。

每个房间的配置、播出单和队伍资料保存在 `data/runtime/rooms/<房间>.json`，重启不丢（可用 `LIVECG_DATA_DIR` 指定数据目录）。
从单房间版本升级时，原来的 `data/runtime/livecg.json` 会自动迁移为默认房间。

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
| Shift + 空格 | 比赛时钟 开始 / 停止（传统体育） |

## 登录与权限

控制台、房间管理和 API 都需要登录；**输出页不需要登录**（只读），OBS / vMix / CasparCG 的地址不受影响。

- **首次启动**会创建管理员 `admin`：密码取环境变量 `LIVECG_ADMIN_PASSWORD`；没设置时随机生成，打印在服务端控制台，并写入 `data/runtime/initial-admin-password.txt`（仅本机可读）。用随机密码首次登录时必须改密码，改完请删除该文件。
- **角色**：

  | 角色 | 能做什么 |
  |---|---|
  | 管理员 | 全部：房间管理、设备配置（CasparCG / 计分器）、账号管理、操作审计 |
  | 导播 | 播出与赛况操作（上下屏、播出单、比分、时钟、事件、CS2 设置）；不能改设备配置、不能管理房间和账号 |
  | 只读 | 只能查看 |

  导播和只读账号可以限定只能访问某些房间。
- **账号管理**：右上角「账号与权限」。新账号的初始密码需本人首次登录后修改；管理员可重置密码、调整角色和房间范围，改动立即生效（已打开的控制台也会立刻失去对应权限）。
- **操作审计**：右上角「操作审计」（仅管理员），按天查看谁在什么时候对哪个房间做了什么，包括被拒绝的操作和登录失败。记录保存在 `data/runtime/audit/YYYY-MM-DD.jsonl`。
- **输出页令牌（可选）**：设置环境变量 `LIVECG_OUTPUT_TOKEN` 后，未登录的输出页地址必须带 `&token=<令牌>`；房间页上复制的地址和 CasparCG 自动加载的地址会自动带上。
- 连续输错 5 次密码会锁定 1 分钟。本地开发可用 `LIVECG_AUTH=off` 关闭鉴权（所有人都是管理员），**不要在播出环境使用**。

> LiveCG 没有内置 HTTPS。跨网络访问时请放在带 HTTPS 的反向代理后面，或只在制作内网使用。

## 外部控制（Stream Deck / Companion / 脚本）

所有控制台操作都可以通过 HTTP 调用，body 与控制台发出的指令相同，路径里带上房间。先在「我的账号 → API 令牌」创建一个令牌（权限与你的账号相同，只显示一次）：

```bash
curl -X POST http://localhost:3000/api/rooms/default/command -H "Authorization: Bearer lcg_xxxxxxxx" -d '{"type":"graphic.take"}'
```

常用指令：`{"type":"rundown.fire","id":"<条目 id>"}`（热键同款上/下屏）、`{"type":"rundown.cue"}`、`{"type":"graphic.take"}`、`{"type":"graphic.clearAll"}`、`{"type":"graphic.update","layer":"caption","data":{"text":"…"}}`。
条目 id 可在 `GET /api/rooms/<房间>/state` 的 `rundown.items` 中查到（不带房间的 `/api/command`、`/api/state` 仍可用，作用于默认房间）。Bitfocus Companion 用「Generic HTTP → POST」动作，加上 `Authorization: Bearer <令牌>` 请求头即可绑定到 Stream Deck 按键。令牌可随时在「我的账号」吊销。

## 外观（换皮）

控制台「外观」页：为本房间选择主题（默认、明亮、电竞霓虹、体育经典），再按需覆盖强调色、面板色、文字色、字体、圆角等。点「应用到本房间」后，本房间所有输出（包括 CasparCG / OBS 上正在运行的页面）立即换皮，在屏图文不重播入场。

- 主题包是 `apps/graphics/themes/` 下的 JSON 文件，放进去就能选，格式见 [docs/TEMPLATES.md](docs/TEMPLATES.md)。
- 字体需要在**播出机**上已安装，否则会退回默认字体。
- 队伍颜色在「赛况 → 比分 / 队伍」里设置，不随主题变化。

## 主备容灾（双机热备）

两台机器各跑一个 LiveCG，互相指向对方：

| 环境变量 | 主机（10.0.0.5） | 备机（10.0.0.6） |
|---|---|---|
| `LIVECG_PEER_URL` | `http://10.0.0.6:3000` | `http://10.0.0.5:3000` |
| `LIVECG_REPLICATION_TOKEN` | 两台相同，至少 16 位 | 同左 |
| `LIVECG_ROLE` | `primary` | `backup` |

- **备机实时镜像主机**：所有房间的比分、播出单、在播图层、配置和账号。备机只读，不连 CasparCG、不监听计分器、不计时、不处理 CS2 数据。
- **输出页自动切换**：主机生成的输出地址（房间页复制的、CasparCG 自动加载的）带 `&failover=<备机地址>`。主机宕机时，已经在 CasparCG / OBS 里运行的输出页会自动改连备机，画面不掉、不重播入场；模板在打开页面时就全部预加载好。
- **接管是人工操作**：控制台顶部出现红色「备机 · 主机失联」时，由管理员在备机上点「接管为主机」。备机接管后开始驱动 CasparCG（沿用输出页的现有连接，不重新加载画面）、接收计分器和 CS2 数据。
  不做自动接管：网络抖动或主机自行恢复时，自动接管容易造成两台同时驱动 CasparCG。
- **原主机恢复**：重启后发现对端已是主机，会自动以备机身份加入并同步，不会出现双主。之后可在任一台的横幅上把播出「交给备机」，计划内倒换不中断。
- **双主告警**：两台都处于主机状态时，控制台顶部会出现红色告警。
- **数据源双发**：CS2 可以同时向两台发数据——把 `integrations/cs2/gamestate_integration_livecg_backup.cfg` 也放进 cfg 目录并改成备机地址（备机在接管前会忽略这些数据）。计分器桥接程序同样建议同时发到两台的 UDP 端口。

> 备机上不能修改账号和密码（账号从主机同步）；登录会话不同步，切到备机的控制台需要重新登录。

## 接入 CasparCG

1. 控制台右侧「CasparCG」中勾选启用，填写 CasparCG 地址和 AMCP 端口（默认 5250）。
2. 「LiveCG 地址」填 **CasparCG 那台机器能访问到的** LiveCG 地址（如 `http://192.168.1.20:3000`），不同机器时不能用 localhost。
3. 设置每路输出的通道 / 层：默认 PGM → 通道 1 层 20；PVW → 通道 2 层 20（默认关闭）。
4. 保存后 LiveCG 会发送 `PLAY 1-20 [HTML] "…/graphics/?room=<房间>&channel=pgm"`，之后的上下屏全部在页面内完成；CasparCG 重启后会自动重新加载。

> CasparCG 较老版本内置的 Chromium 可能不支持输出页使用的现代 JS 语法，建议 2.4 或更新版本，上线前在实际版本上完整验证。模板开发见 [docs/TEMPLATES.md](docs/TEMPLATES.md)。

## 传统体育（足球 / 篮球）

1. 控制台右侧「赛况」页：选择赛制（足球 / 篮球 FIBA / 篮球 NBA），点「开始新比赛」。比分、时钟、犯规/暂停、事件清零，队名和队色保留。
2. 在播出单里上屏「足球比分条」或「篮球比分条」（两者与 CS2 比分条共用 `scorebug` 图层，同时只会有一个在屏）。
   升级前已保存过的播出单不会自动出现这些条目：点「＋ 新建」，模板选 `football-scorebug` / `basketball-scorebug` / `lineup` 即可。
3. **比赛时钟**：「开始/停止」按钮或 **Shift + 空格**；可直接输入时间校时（`45:00`、`2:35.4`），或用 ±1 秒 / ±0.1 秒微调。时钟由服务端统一计时，所有输出与控制台同步。
4. **节次**：◀ ▶ 切换上/下半场、节次、加时；切换后时钟按该节起始值重置并停止，篮球全队犯规按节清零、暂停按规则重置。
5. **足球事件**：选类型、球队、填球员后「记录事件」，时间留空则按比赛时钟自动计算（补时显示为 `45+2'`）。进球自动加比分，事件条自动上屏（可在「设备 → 自动上屏」关闭或调整停留时长）。点「撤销」可删掉误录的事件。
6. **篮球**：进攻时钟 24 / 14 秒重置；全队犯规、剩余暂停 ±；球权箭头；+1 / +2 / +3 快捷加分。
7. **首发名单**：播出单「首发名单」模板，每行填 `号码 姓名 位置`。

## 接入场馆计分器

LiveCG 在 UDP 端口（默认 5300，「设备」页可改）接收计分器数据。各厂商计分器协议大多不公开，LiveCG 不内置厂商协议，
而是使用下面的通用格式，由桥接程序（或串口服务器 + 小脚本）把计分器输出翻译过来。每个 UDP 包一帧，字段都可选：

```text
{"clock":"9:58.3","running":true,"period":2,"home":45,"away":41,"shot":"14.0","homeFouls":3,"awayFouls":2,"homeTimeouts":2,"awayTimeouts":1}
clock=9:58.3;running=1;period=2;home=45;away=41;shot=14
```

- `clock` / `shot`：`mm:ss`、`mm:ss.t` 或 `ss.t`（也可用 `clockMs` / `shotMs` 传毫秒）；`shot=off` 表示进攻时钟关闭
- `period`：从 1 开始的节次；比分、节次、犯规、暂停收到即生效
- 时钟只有在「设备 → 时钟来源」选为「计分器」时才跟随计分器，此时控制台的时钟按钮会锁定

**掉线兜底**：超过设定时间没收到数据，控制台顶栏会出现红色「计分器掉线」。把时钟来源切回「内部时钟」，
LiveCG 会从最后一次读数接着计时，操作员手动控制即可。

不接真实设备也可以联调（服务启动后另开一个终端）：

```bash
pnpm sim:scoreboard
```

常用参数：`--port 5300`、`--speed 1`（实时）、`--format kv`、`--stop-after 20`（20 秒后停发，用来演练掉线告警）。

## 接入 CS2

1. 将 `integrations/cs2/gamestate_integration_livecg.cfg` 复制到 CS2 的 `game/csgo/cfg/` 目录（建议在 OB 观察者机器上）。
2. 修改其中的 `uri` 指向 LiveCG 服务地址，`token` 与环境变量 `CS2_GSI_TOKEN` 保持一致。
   多房间时 `uri` 写成 `http://<服务地址>:3000/gsi/cs2/<房间>`（房间卡片上可直接复制）；不带房间时进入默认房间。
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
