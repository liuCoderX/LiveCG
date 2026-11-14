# CS2 图标包：使用游戏原版图标

击杀信息里的武器、爆头，选手条里的武器、道具、头盔、拆弹器、C4，比分条上的下包提示，都可以换成 **CS2 游戏原版图标**。

## 为什么要自己导入

这些图标的版权属于 Valve，所以 LiveCG **不随代码附带**，由使用方从自己安装的 CS2 里导出，放到 LiveCG 服务器的数据目录。

- 正式赛事能否在转播里使用游戏素材，以赛事与 Valve 的授权（如 Valve 的赛事授权协议及 CS 赛事规则）为准，请和主办方确认。
- 导出的图标**不要提交到代码仓库**、不要对外分发；它们放在数据目录里，本来就不在仓库中。

没有放图标包，或缺了某个图标时，画面照常工作：武器显示为文字名称，其它（爆头、道具、拆弹器、C4 等）用 LiveCG 内置的简化图标。

## 1. 从游戏文件导出

CS2 的界面图标打包在游戏目录的 `game/csgo/pak01_dir.vpk` 里，是编译过的格式，需要用 [Source 2 Viewer](https://s2v.app/)（开源工具，又名 ValveResourceFormat）打开和导出：

1. 用 Source 2 Viewer 打开 `<Steam 库>/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk`
2. 找到武器、装备图标所在的目录（通常是 `panorama/images/icons/equipment/`，以实际文件为准），选中需要的图标导出
3. 格式优先 **SVG**（矢量，放大不糊）；只能导出位图时用 **PNG**（透明背景，高度建议 64 像素以上）

游戏更新可能会改动图标，大版本更新后建议重新导出一次。

## 2. 放到 LiveCG 服务器

放进 `<数据目录>/icons/cs2/`（数据目录即 `.env` 里的 `LIVECG_DATA_DIR`，用安装脚本装的是 `/var/lib/livecg`；本地开发默认是项目里的 `data/runtime`）：

```bash
sudo mkdir -p /var/lib/livecg/icons/cs2
```

**文件名就是图标名**，要和 CS2 数据里的武器名一致（不区分大小写，带不带 `weapon_` 前缀都行，如 `ak47.svg`、`weapon_ak47.svg`）。同名同时有 SVG 和 PNG 时用 SVG。

| 类别 | 文件名（不含扩展名） |
|---|---|
| 步枪 / 狙击 | `ak47` `m4a1`（M4A4） `m4a1_silencer`（M4A1-S） `famas` `galilar` `aug` `sg556` `awp` `ssg08` `g3sg1` `scar20` |
| 冲锋枪 | `mp9` `mac10` `mp7` `mp5sd` `ump45` `p90` `bizon` |
| 重型 | `nova` `xm1014` `mag7` `sawedoff` `m249` `negev` |
| 手枪 | `glock` `hkp2000` `usp_silencer` `p250` `elite` `fiveseven` `tec9` `cz75a` `deagle` `revolver` |
| 道具 | `hegrenade` `flashbang` `smokegrenade` `molotov` `incgrenade` `decoy` |
| 装备 | `knife`（所有刀型共用） `taser` `c4` `defuser`（拆弹器） `armor`（防弹衣） `armor_helmet`（防弹衣 + 头盔） |
| 状态 | `headshot`（爆头） `elimination`（阵亡 / 全歼） `bomb`（炸弹爆炸） `defuse`（拆除成功） `time`（时间耗尽） |

导出的文件名和上表不一致时（比如爆头图标在别的目录、叫别的名字），复制后**改成上表里的名字**即可。

## 3. 检查与生效

1. 运行 `pnpm preflight`：「CS2 图标包」一节会列出已有多少个图标、缺了哪些常用图标
2. 输出页在**打开时**读取图标包。放好或更换图标后：CasparCG 在控制台「设备 → CasparCG」点「重连」（会重新加载画面），OBS / vMix 刷新浏览器源，控制台刷新页面
3. 用模拟器过一遍：`pnpm sim:cs2 --room <房间>`，上屏比分条、选手血量/经济、击杀信息，确认武器、道具、爆头、C4、拆弹器都显示为原版图标

图标按单色剪影处理：颜色跟随主题文字颜色（深色主题为白色，明亮主题为深色），宽度按图标自身比例。彩色图标也会被统一成单色。
