# 精简版联调清单：Linux 单机 + CasparCG 2.4 + CS2

只适用于这种部署：一台 Linux 服务器跑 LiveCG（不做主备）、CasparCG 2.4 出画面、只接 CS2（不接场馆计分器）。
其它情况、每项的详细说明见完整版 [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md)。地址以 LiveCG 服务器 `10.0.0.5`、CasparCG `10.0.0.20` 为例。

## A. 部署 LiveCG（服务器）

- [ ] 装好 Node.js 22+ 与 pnpm，取代码后在项目根目录用普通账号运行 `deploy/install.sh`（要用某个房间就加 `--room <房间>`）。它会构建、生成 `.env`（随机 token、数据目录 `/var/lib/livecg`、开启 CS2 录制）、装好并启动 systemd 服务、跑自检、生成 CS2 配置
- [ ] 脚本最后的自检没有 ✗；按提示放行防火墙 TCP 3000（入）；本机能连到 CasparCG 的 TCP 5250
- [ ] 浏览器打开 `http://10.0.0.5:3000/`，用脚本打印的初始密码以 `admin` 登录并改密码；给每位操作员建账号（导播）

## B. CasparCG 2.4

- [ ] CasparCG 版本 ≥ 2.4（更早的版本输出页会整页空白）；CasparCG 机器上装有中文字体（如 Noto Sans SC）
- [ ] 控制台「设备 → CasparCG」：启用，地址 `10.0.0.20`、端口 5250，**「LiveCG 地址」填 `http://10.0.0.5:3000`（不能填 localhost）**，PGM 通道 1 层 20
- [ ] 顶栏显示「CasparCG 已连接 · 已加载 1 路」；再跑一次 `pnpm preflight` 没有 ✗
- [ ] 切换台上 Key 干净：没有黑边 / 白边，半透明面板透出底下画面
- [ ] 重启 CasparCG，LiveCG 自动重连并重新加载画面
- [ ] 逐个上屏 / 下屏，入场出场流畅、中文正常、在安全区内：比分条 · 选手血量/经济 · 击杀信息 · 回合结算 · 人名条 · 实时字幕
- [ ] 游戏原版图标：按 `docs/ICONS-CS2.md` 从 CS2 导出放到 `/var/lib/livecg/icons/cs2/`，`pnpm preflight` 不缺常用图标；CasparCG 重连后武器、道具、爆头、C4 都是原版图标
- [ ] 画面黑屏、闪烁、掉帧时：试 CasparCG 2.4 配置里的 angle backend 设置

## C. CS2

- [ ] 不开游戏先跑通：`pnpm sim:cs2 --room <房间>`，比分条、击杀信息等在 CasparCG 上正常
- [ ] 把安装脚本生成的 `cs2-cfg/gamestate_integration_livecg.cfg` 拷到 OB 机 `game/csgo/cfg/`（地址和 token 已填好；换房间或地址用 `pnpm cs2:cfg --room <房间> --url http://10.0.0.5:3000` 重新生成）
- [ ] 以**观察者身份**进比赛（否则选手数据为空）；控制台「CS2」页「最近数据」在几秒以内
- [ ] 比分、回合号与游戏一致（重点看回合结束那一刻）
- [ ] **半场换边后**主队仍在比分条左边、比分没对调；有加时则加时换边后同样正确
- [ ] 击杀信息与游戏一致；多人同时阵亡时，记下击杀者 / 被杀者配对是否正确
- [ ] 回合结束自动弹出回合结算，下一回合开始自动下屏
- [ ] 量出直播延迟填进「数据延迟 (ms)」，击杀信息与画面里的击杀同时出现

## D. 账号与稳定性

- [ ] 导播账号能播出，「设备」页的 CasparCG 配置是锁定的
- [ ] 用 Stream Deck 时：「我的账号」创建 API 令牌，逐个按键验证
- [ ] 连续运行 4 小时以上（真实比赛或 `pnpm sim:cs2 --speed 1`），LiveCG 与 CasparCG 内存、CPU 没有持续上涨，画面不卡

## E. 开播前 1 小时

- [ ] `pnpm preflight` 没有 ✗；`/var/lib/livecg/initial-admin-password.txt` 已删除
- [ ] 不再需要录制时：`.env` 里 `LIVECG_CS2_CAPTURE` 改为空并重启服务
- [ ] 备份 `<数据目录>`
- [ ] CasparCG「已连接」；CS2「最近数据」在几秒以内
- [ ] 队名、队色正确；数据延迟已填
- [ ] 播出单顺序、热键 / Stream Deck 按键对应正确；要用的模板在 PVW 过一遍
- [ ] 操作员知道应急操作：

  | 情况 | 操作 |
  |---|---|
  | 图文出错要马上撤 | `Shift + Esc`：PGM 全部下屏 |
  | 主客队阵营识别反了 | 「CS2」页点「交换主客队阵营」 |
  | CasparCG 画面没了 | 「设备 → CasparCG」点「重连」（会重新加载画面） |

## 出问题时

记下大概是第几回合、几点几分，连同以下内容发给开发：`pnpm preflight` 的输出、`journalctl -u livecg --since "2 hours ago"`、当天的 `<数据目录>/audit/` 与 `<数据目录>/captures/` 文件、PGM 截图或录像。
**不要**发 `users.json`、`sessions.json`。
