# CS2 图标包：使用游戏原版图标

击杀信息里的武器、爆头，选手条里的武器、道具、头盔、拆弹器、C4，比分条上的下包提示，都可以换成 **CS2 游戏原版图标**。

## 为什么要自己导入

这些图标的版权属于 Valve，所以 LiveCG **不随代码附带**，由使用方从自己安装的 CS2 里导出，放到 LiveCG 服务器的数据目录。

- 正式赛事能否在转播里使用游戏素材，以赛事与 Valve 的授权（如 Valve 的赛事授权协议及 CS 赛事规则）为准，请和主办方确认。
- 导出的图标**不要提交到代码仓库**、不要对外分发；它们放在数据目录里，本来就不在仓库中。

没有放图标包，或缺了某个图标时，画面照常工作：武器显示为文字名称，其它（爆头、道具、拆弹器、C4 等）用 LiveCG 内置的简化图标。

## 流程总览

1. 在一台装了 CS2 的 **Windows** 电脑上（一般就是 OB 机），用 Source 2 Viewer 把游戏里的界面图标导出到一个文件夹
2. 把这个文件夹拷到 LiveCG 服务器，运行 `pnpm icons:import <文件夹>`：自动挑出需要的图标、改好名字、放进数据目录
3. CasparCG 重连，画面就换成原版图标

大约 15 分钟。游戏大版本更新后图标可能会变，重新做一遍即可。

## 1. 准备 Source 2 Viewer

[Source 2 Viewer](https://s2v.app/)（开源项目 [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)）能读取 CS2 的游戏文件包并导出其中的资源。CS2 的界面图标是编译过的矢量图（`.vsvg_c`），用它导出就是原样的 SVG。

1. 打开 [s2v.app](https://s2v.app/) 或 [GitHub Releases](https://github.com/ValveResourceFormat/ValveResourceFormat/releases)，下载最新版。有两种，选一种即可：
   - **Source 2 Viewer**：图形界面，只有 Windows 版（下文「方法 B」）
   - **Source2Viewer-CLI**：命令行，Windows / Linux / macOS 都有（下文「方法 A」，推荐：命令可以直接复制，下次更新照着再跑一遍）
2. 下载的压缩包解压即可使用，不需要安装。下文假设解压到 `C:\s2v`

CS2 的界面资源都在游戏目录的 `game\csgo\pak01_dir.vpk` 里。Source 2 Viewer 认识 `steam:730/game/csgo/pak01_dir.vpk` 这种写法（730 是 CS2 在 Steam 上的编号），会自己找到 CS2 的安装位置；找不到时改用完整路径，默认是：

```
C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk
```

CS2 装在其它盘时，在 Steam 库里右键 CS2 →「管理」→「浏览本地文件」可以看到实际位置。

## 2. 导出图标

### 方法 A：命令行（推荐）

在「命令提示符」（cmd）里进入 Source 2 Viewer 所在的目录：

```bash
cd C:\s2v
```

**第一步：看图标在哪个目录。** 列出游戏包里所有界面矢量图，只显示路径里带 `icons` 的：

```bash
Source2Viewer-CLI.exe -i "steam:730/game/csgo/pak01_dir.vpk" --vpk_list | findstr /i "vsvg_c" | findstr /i "icons"
```

会列出很多行，形如 `panorama/images/icons/.../ak47.vsvg_c`。确认武器图标（`ak47`、`awp`、`flashbang` 这类名字）所在的目录，一般在 `panorama/images/icons/` 下面（如 `equipment`）。只想看某一个图标，把最后的 `icons` 换成名字，比如 `findstr /i "headshot"`。

**第二步：导出。** 把 `panorama/images/icons/` 下的矢量图标整个导出到 `C:\cs2-icons`（会多导出一些用不上的图标，下一步导入时会自动挑选）：

```bash
Source2Viewer-CLI.exe -i "steam:730/game/csgo/pak01_dir.vpk" -o "C:\cs2-icons" -d -e "vsvg_c" -f "panorama/images/icons/"
```

参数含义：`-i` 游戏文件包，`-o` 导出到哪个文件夹，`-d` 解码成普通文件（SVG），`-e` 只导出这种类型，`-f` 只导出这个目录开头的文件（第一步看到的目录不在 `panorama/images/icons/` 下时，改成实际的目录）。

导出后 `C:\cs2-icons` 里保留游戏包里的目录结构，如 `C:\cs2-icons\panorama\images\icons\equipment\ak47.svg`。不需要手动整理。

### 方法 B：图形界面

1. 打开 `Source 2 Viewer.exe`，在「Explorer」页找到 Counter-Strike 2，双击 `pak01_dir.vpk`（也可以「File → Open」选上面的完整路径，或直接把文件拖进窗口）
2. 在左侧目录树里依次展开 `panorama` → `images` → `icons`，点开子目录确认武器图标在哪里
3. 在 `icons` 文件夹上**右键 → Decompile & export**，弹出的格式选项保持默认，点「Continue」，选择导出到 `C:\cs2-icons`

## 3. 导入 LiveCG

导入命令会在导出文件夹里（包括所有子目录）找出认识的图标：去掉 `weapon_` 前缀，同名的优先用 SVG、优先用 `equipment` 目录里的，然后复制到 `<数据目录>/icons/cs2/`。已有的同名图标会被覆盖。

### 在 Windows 本地体验时

在 LiveCG 项目目录里运行：

```bash
pnpm icons:import C:\cs2-icons
```

图标会放到项目里的 `data\runtime\icons\cs2\`。

### 在 Linux 播出服务器上

1. 把导出文件夹拷到服务器。Windows 10 / 11 自带 `scp`，在 Windows 的命令行里运行（`user` 换成服务器上的账号，`10.0.0.5` 换成服务器 IP）：

   ```bash
   scp -r C:\cs2-icons user@10.0.0.5:/tmp/cs2-icons
   ```

   也可以用 U 盘或 WinSCP 之类的工具拷过去。
2. 在服务器上进入 LiveCG 项目目录，先预览一下会导入哪些（不复制任何文件）：

   ```bash
   pnpm icons:import /tmp/cs2-icons --dry-run
   ```

3. 没问题就正式导入（数据目录取自 `.env` 的 `LIVECG_DATA_DIR`，用安装脚本装的是 `/var/lib/livecg`）：

   ```bash
   pnpm icons:import /tmp/cs2-icons
   ```

   提示没有写入权限时，说明运行服务的账号不是你（安装时用了 `--user`）：用那个账号运行这条命令，或导入后执行 `sudo chown -R <服务账号> /var/lib/livecg/icons`。

### 看懂导入结果

```
导入 38 个图标 → /var/lib/livecg/icons/cs2
  ✓ ak47.svg  ← panorama/images/icons/equipment/ak47.svg
  ……
⚠ 还缺 2 个常用图标（会显示为文字 / 内置图标）：headshot、incgrenade
· 跳过了 120 个不认识的文件名（不影响使用）：……
```

- **✓**：已导入
- **⚠ 还缺**：这些图标没找到，画面上对应位置会显示文字或内置图标。在导出文件夹里找到对应的文件（游戏里的名字可能不一样，比如爆头图标），复制一份、**改成下表里的名字**，再运行一次导入即可
- **跳过**：游戏里还有很多用不上的图标，跳过是正常的
- 各种刀型（`knife_karambit`、`bayonet`……）共用一个刀图标：没有通用的 `knife` 时会自动拿一个刀型来用

## 图标名对照表

图标名要和 CS2 数据里的武器名一致（不区分大小写，带不带 `weapon_` 前缀都行，如 `ak47.svg`、`weapon_ak47.svg`）。同名同时有 SVG 和 PNG 时用 SVG。

| 类别 | 图标名 |
|---|---|
| 步枪 / 狙击 | `ak47` `m4a1`（M4A4） `m4a1_silencer`（M4A1-S） `famas` `galilar` `aug` `sg556` `awp` `ssg08` `g3sg1` `scar20` |
| 冲锋枪 | `mp9` `mac10` `mp7` `mp5sd` `ump45` `p90` `bizon` |
| 重型 | `nova` `xm1014` `mag7` `sawedoff` `m249` `negev` |
| 手枪 | `glock` `hkp2000` `usp_silencer` `p250` `elite` `fiveseven` `tec9` `cz75a` `deagle` `revolver` |
| 道具 | `hegrenade` `flashbang` `smokegrenade` `molotov` `incgrenade` `decoy` |
| 装备 | `knife`（所有刀型共用） `taser` `c4` `defuser`（拆弹器） `armor`（防弹衣） `armor_helmet`（防弹衣 + 头盔） |
| 状态 | `headshot`（爆头） `elimination`（阵亡 / 全歼） `bomb`（炸弹爆炸） `defuse`（拆除成功） `time`（时间耗尽） |

也可以不用导入命令，直接把改好名字的 `.svg` / `.png` 放进 `<数据目录>/icons/cs2/`（PNG 要透明背景，高度建议 64 像素以上）。

## 4. 生效与检查

1. 运行 `pnpm preflight`：「CS2 图标包」一节会显示已有多少个图标、还缺哪些常用图标
2. 输出页在**打开时**读取图标包，放好或更换图标后要重新加载：CasparCG 在控制台「设备 → CasparCG」点「重连」（会重新加载画面），OBS / vMix 刷新浏览器源，控制台刷新页面
3. 用模拟器过一遍：`pnpm sim:cs2 --room <房间>`，上屏比分条、选手血量/经济、击杀信息，确认武器、道具、爆头、C4、拆弹器都是原版图标，在播出机上清晰、不发虚

图标按单色剪影显示：颜色跟随主题文字颜色（深色主题为白色，明亮主题为深色），宽度按图标自身比例。彩色图标也会被统一成单色。

## 常见问题

| 现象 | 处理 |
|---|---|
| 命令行提示找不到 `steam:730/...` | 把 `-i` 后面换成 `pak01_dir.vpk` 的完整路径（带空格的路径要加双引号） |
| 第一步什么都没列出来 | 去掉 `findstr /i "icons"` 只按 `vsvg_c` 筛选，看看图标在哪个目录；还是没有时，图标可能是贴图格式：把命令里的 `vsvg_c` 换成 `vtex_c` 再试，导出的是 PNG（文件名带 `_png` 后缀，导入命令会自动去掉） |
| 导入时提示「没有认识的图标」 | 确认 `-o` 导出的文件夹里有 `.svg` / `.png`（没加 `-d` 时导出的是游戏内部格式，用不了） |
| 画面上还是文字 | 没有重新加载输出页（见上面第 2 步），或这个武器的图标没导入（看 `pnpm preflight`） |
| 某个武器图标被压成正方形、显得很挤 | 图标读不出宽高比，`pnpm preflight` 会列出来；换一个导出格式（SVG / PNG）再试 |
