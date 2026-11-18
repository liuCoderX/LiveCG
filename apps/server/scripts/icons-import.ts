/**
 * 把从 CS2 游戏文件导出的图标导入图标包：
 *
 *   pnpm icons:import <导出目录>            # 导入到 <数据目录>/icons/cs2/
 *   pnpm icons:import <导出目录> --dry-run  # 只看会导入哪些，不复制
 *
 * 会递归查找导出目录里的 .svg / .png，按文件名挑出认识的武器、道具、装备、状态图标（见 docs/ICONS-CS2.md），
 * 去掉 weapon_ 前缀和 _png 后缀后复制过去；同名的 SVG 优先。已有的同名图标会被覆盖。
 */
import { parseArgs } from "node:util";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/env.ts";
import { CORE_ICON_NAMES, planIconImport } from "../src/icons.ts";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
loadEnvFile(process.env.LIVECG_ENV_FILE ?? join(repoRoot, ".env"));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    "data-dir": { type: "string" },
  },
});
if (positionals.length !== 1) {
  console.error("用法：pnpm icons:import <导出目录> [--dry-run] [--data-dir <数据目录>]");
  process.exit(1);
}
// pnpm 运行脚本时 cwd 是 apps/server，相对路径按用户所在目录（INIT_CWD）解析
const cwd = process.env.INIT_CWD ?? process.cwd();
const src = resolve(cwd, positionals[0]);
const dataDir = resolve(cwd, values["data-dir"] ?? (process.env.LIVECG_DATA_DIR || join(repoRoot, "data", "runtime")));
const dest = join(dataDir, "icons", "cs2");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });

let files: string[];
try {
  if (!statSync(src).isDirectory()) throw new Error();
  files = walk(src);
} catch {
  console.error(`✗ 找不到目录 ${src}`);
  process.exit(1);
}

const { picked, unknown, duplicates } = planIconImport(files);
if (!picked.size) {
  console.error(`✗ ${src} 里没有认识的图标（共 ${files.length} 个文件）。确认导出的是 .svg / .png，文件名是 ak47、awp、flashbang 这类武器名`);
  process.exit(1);
}

console.log(`${values["dry-run"] ? "将导入" : "导入"} ${picked.size} 个图标 → ${dest}`);
if (!values["dry-run"]) mkdirSync(dest, { recursive: true });
for (const [name, file] of picked) {
  const ext = extname(file).toLowerCase();
  console.log(`  ✓ ${name}${ext}  ← ${relative(src, file)}`);
  if (values["dry-run"]) continue;
  // 同名的另一种格式删掉，避免旧的 PNG 盖过新的 SVG（或反之）
  for (const other of [".svg", ".png"]) if (other !== ext) rmSync(join(dest, name + other), { force: true });
  copyFileSync(file, join(dest, name + ext));
}
if (duplicates.length) console.log(`  · 这些图标导出目录里有多个同名文件，已按「SVG 优先、equipment 目录优先」挑了一个：${duplicates.join("、")}`);

const missing = CORE_ICON_NAMES.filter((n) => !picked.has(n));
if (missing.length) {
  console.log(`\n⚠ 还缺 ${missing.length} 个常用图标（会显示为文字 / 内置图标）：${missing.join("、")}`);
  console.log("  在导出目录里找到对应的文件后，改成上面的名字再运行一次（对照表见 docs/ICONS-CS2.md）");
}
if (unknown.length) console.log(`\n· 跳过了 ${unknown.length} 个不认识的文件名（不影响使用）：${unknown.slice(0, 15).join("、")}${unknown.length > 15 ? "……" : ""}`);
console.log(values["dry-run"] ? "\n（--dry-run：没有复制任何文件）" : "\n完成。CasparCG 在「设备 → CasparCG」点「重连」、OBS 刷新浏览器源后生效");
