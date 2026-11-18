/**
 * CS2 图标包：操作员从自己的 CS2 游戏文件里导出的图标（武器、爆头、拆弹器等），放在 <数据目录>/icons/cs2/。
 * 版权属于 Valve，所以不随代码分发；没有放的图标，输出页回退到内置图标或文字。
 *
 * 文件名即图标名：ak47.svg、m4a1_silencer.png、headshot.svg……（大小写不限，weapon_ 前缀会被去掉）。
 * 同名同时有 svg 和 png 时用 svg。
 */
import { open, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

export interface IconInfo {
  /** 实际文件名 */
  file: string;
  /** 宽 / 高，输出页按这个比例排版（武器图标都是横长的） */
  ratio: number;
}

const EXT_RANK: Record<string, number> = { ".svg": 2, ".png": 1 };
export const ICON_NAME_RE = /^[a-z0-9_-]{1,64}$/;

/** 文件名 → 图标名；不是可用的图标文件返回 undefined */
export function iconNameOf(file: string): string | undefined {
  const ext = extname(file).toLowerCase();
  if (!(ext in EXT_RANK)) return undefined;
  const name = file.slice(0, -ext.length).toLowerCase().replace(/^weapon_/, "");
  return ICON_NAME_RE.test(name) ? name : undefined;
}

/** 读文件头算宽高比：SVG 看 viewBox / width+height，PNG 看 IHDR。算不出来返回 1 */
export function iconRatio(head: Buffer, ext: string): number {
  if (ext === ".png") {
    if (head.length >= 24 && head.toString("ascii", 12, 16) === "IHDR") {
      const w = head.readUInt32BE(16);
      const h = head.readUInt32BE(20);
      if (w > 0 && h > 0) return w / h;
    }
    return 1;
  }
  const text = head.toString("utf8");
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return Number(vb[1]) / Number(vb[2]);
  const w = /\bwidth\s*=\s*["']([\d.]+)/i.exec(tag);
  const h = /\bheight\s*=\s*["']([\d.]+)/i.exec(tag);
  if (w && h && Number(w[1]) > 0 && Number(h[1]) > 0) return Number(w[1]) / Number(h[1]);
  return 1;
}

async function readHead(path: string, bytes = 4096): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** 扫描图标目录；目录不存在时返回空 */
export async function scanIconPack(dir: string): Promise<Record<string, IconInfo>> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return {};
  }
  const best = new Map<string, string>();
  for (const f of files.sort()) {
    const name = iconNameOf(f);
    if (!name) continue;
    const prev = best.get(name);
    if (!prev || EXT_RANK[extname(f).toLowerCase()] > EXT_RANK[extname(prev).toLowerCase()]) best.set(name, f);
  }
  const out: Record<string, IconInfo> = {};
  for (const [name, file] of [...best].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      out[name] = { file, ratio: Math.round(iconRatio(await readHead(join(dir, file)), extname(file).toLowerCase()) * 1000) / 1000 };
    } catch {
      /* 读不了就跳过 */
    }
  }
  return out;
}

/**
 * 建议放进图标包的图标（预检据此提示缺了哪些）。武器名与 CS2 GSI 一致（去掉 weapon_ 前缀）。
 */
export const CS2_ICON_NAMES = {
  rifles: ["ak47", "m4a1", "m4a1_silencer", "famas", "galilar", "aug", "sg556", "awp", "ssg08", "g3sg1", "scar20"],
  smgs: ["mp9", "mac10", "mp7", "mp5sd", "ump45", "p90", "bizon"],
  heavy: ["nova", "xm1014", "mag7", "sawedoff", "m249", "negev"],
  pistols: ["glock", "hkp2000", "usp_silencer", "p250", "elite", "fiveseven", "tec9", "cz75a", "deagle", "revolver"],
  gear: ["knife", "taser", "c4", "defuser", "armor", "armor_helmet"],
  grenades: ["hegrenade", "flashbang", "smokegrenade", "molotov", "incgrenade", "decoy"],
  status: ["headshot", "elimination", "bomb", "defuse", "time"],
} as const;

export const CORE_ICON_NAMES: string[] = [
  ...CS2_ICON_NAMES.rifles,
  ...CS2_ICON_NAMES.smgs,
  ...CS2_ICON_NAMES.pistols,
  "knife",
  "c4",
  "defuser",
  ...CS2_ICON_NAMES.grenades,
  "headshot",
];

/** 所有认识的图标名 */
export const KNOWN_ICON_NAMES = new Set<string>(Object.values(CS2_ICON_NAMES).flat());

/**
 * 导入前整理：从导出目录里的文件路径挑出认识的图标。
 * - 文件名按 iconNameOf 规则识别，另外去掉贴图导出常见的 _png 后缀（ak47_png.png → ak47）
 * - 同名多个文件时：SVG 优先；同为 SVG/PNG 时路径里带 equipment 的优先，再按路径排序取第一个
 */
export function planIconImport(paths: string[]): { picked: Map<string, string>; unknown: string[]; duplicates: string[] } {
  const groups = new Map<string, string[]>();
  const unknown: string[] = [];
  const knifeVariants: string[] = [];
  for (const p of paths) {
    const base = p.split(/[\\/]/).pop() ?? p;
    const ext = extname(base).toLowerCase();
    if (!(ext in EXT_RANK)) continue;
    let name = iconNameOf(base);
    if (name) name = name.replace(/_png$/, "");
    if (!name || !KNOWN_ICON_NAMES.has(name)) {
      if (name && /^(knife|bayonet)/.test(name)) knifeVariants.push(p);
      else if (name) unknown.push(name);
      continue;
    }
    groups.set(name, [...(groups.get(name) ?? []), p]);
  }
  // 没有通用的 knife 图标时，拿一个具体刀型（如 knife_karambit）当所有刀的图标
  if (!groups.has("knife") && knifeVariants.length) groups.set("knife", [knifeVariants.sort()[0]]);
  const score = (p: string) => EXT_RANK[extname(p).toLowerCase()] * 10 + (/equipment/i.test(p) ? 1 : 0);
  const picked = new Map<string, string>();
  const duplicates: string[] = [];
  for (const [name, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
    picked.set(name, sorted[0]);
    if (list.length > 1) duplicates.push(name);
  }
  return { picked, unknown: [...new Set(unknown)].sort(), duplicates };
}
