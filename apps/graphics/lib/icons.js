/**
 * CS2 图标：优先用「图标包」——操作员从自己的 CS2 游戏文件里导出、放在 <数据目录>/icons/cs2/ 的原版图标；
 * 某个图标没有放时，武器回退为文字、其它回退为内置图标。图标版权属于 Valve，不随代码分发。
 *
 * 图标包里的图标用 CSS mask 绘制：颜色跟随文字颜色（currentColor），随主题变化；宽度按图标自身比例。
 */
import { esc, ICON } from "./util.js";

// 模板可能从备机地址加载出另一份本模块，用全局对象共享同一份清单
const S = (globalThis.__lcgIcons ??= { pack: {}, base: "" });

if (typeof document !== "undefined" && !document.getElementById("lcg-icons-css")) {
  const style = document.createElement("style");
  style.id = "lcg-icons-css";
  style.textContent = `
    .lcg-ico { display: inline-block; flex: none; height: 1em; width: calc(var(--r, 1) * 1em); vertical-align: -.125em; background-color: currentColor;
      -webkit-mask: var(--src) center / contain no-repeat; mask: var(--src) center / contain no-repeat; }
    .lcg-wtxt { font-size: .62em; font-weight: 600; letter-spacing: .02em; white-space: nowrap; }
  `;
  document.head.appendChild(style);
}

/**
 * 读取图标包清单（输出页启动时调用一次，在第一次渲染之前）。
 * hosts：依次尝试的服务器（本机优先，其后是主备的对端）；都失败或超时就不用图标包。
 */
export async function loadIconPack(hosts, timeoutMs = 2000) {
  for (const host of hosts) {
    try {
      const r = await fetch(new URL("/api/icons", host), { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      S.pack = (await r.json()).cs2 ?? {};
      S.base = new URL("/icons/cs2/", host).href;
      return Object.keys(S.pack).length;
    } catch {
      /* 下一个 */
    }
  }
  return 0;
}

/** 测试 / 控制台预览用：直接设置清单 */
export const setIconPack = (pack, base) => Object.assign(S, { pack: pack ?? {}, base: base ?? "" });

const WEAPON_NAME = {
  ak47: "AK-47", m4a1_silencer: "M4A1-S", m4a1: "M4A4", awp: "AWP", famas: "FAMAS", galilar: "Galil AR", aug: "AUG", sg556: "SG 553",
  ssg08: "SSG 08", g3sg1: "G3SG1", scar20: "SCAR-20", mp9: "MP9", mac10: "MAC-10", mp7: "MP7", mp5sd: "MP5-SD", ump45: "UMP-45",
  p90: "P90", bizon: "PP-Bizon", nova: "Nova", xm1014: "XM1014", mag7: "MAG-7", sawedoff: "Sawed-Off", m249: "M249", negev: "Negev",
  deagle: "Desert Eagle", revolver: "R8", usp_silencer: "USP-S", glock: "Glock-18", hkp2000: "P2000", p250: "P250", elite: "Dual Berettas",
  fiveseven: "Five-SeveN", tec9: "Tec-9", cz75a: "CZ75-Auto", taser: "Zeus x27", knife: "Knife", c4: "C4",
  hegrenade: "HE", flashbang: "Flash", smokegrenade: "Smoke", molotov: "Molotov", incgrenade: "Incendiary", decoy: "Decoy",
};
const norm = (n) => String(n ?? "").toLowerCase().replace(/^weapon_/, "");
const isKnife = (n) => /^(knife|bayonet)/.test(n);

/** 文字名称（没有图标时用） */
export const weaponLabel = (w) => {
  const n = norm(w);
  return n ? WEAPON_NAME[n] ?? (isKnife(n) ? "Knife" : n.toUpperCase()) : "";
};

/** 图标包里对应的图标名：各种刀统一用 knife；燃烧火焰（inferno）用燃烧瓶 */
const packName = (n) => (S.pack[n] ? n : isKnife(n) && S.pack.knife ? "knife" : n === "inferno" && S.pack.molotov ? "molotov" : undefined);

const packHtml = (name, cls) => {
  const i = S.pack[name];
  return `<i class="lcg-ico${cls ? ` ${cls}` : ""}" style="--r:${Number(i.ratio) || 1};--src:url('${S.base}${encodeURIComponent(i.file)}')"></i>`;
};

/** 是否有图标包里的原版图标 */
export const hasPackIcon = (name) => !!packName(norm(name));

/** 武器：图标包里有就用原版图标，否则用文字 */
export const weaponIcon = (w, cls = "") => {
  const n = norm(w);
  if (!n) return "";
  const p = packName(n);
  return p ? packHtml(p, cls) : `<span class="lcg-wtxt${cls ? ` ${cls}` : ""}">${esc(weaponLabel(n))}</span>`;
};

// 状态图标的图标包名 → 内置图标名
const BUILTIN = { armor_helmet: "helmet", defuser: "kit" };

/** 状态 / 道具图标（headshot、c4、defuser、armor、armor_helmet、elimination、bomb、defuse、time、各种道具）：图标包优先，否则内置 */
export const statusIcon = (key, cls = "") => {
  const n = norm(key);
  const p = packName(n);
  if (p) return packHtml(p, cls);
  const svg = ICON[BUILTIN[n] ?? n] ?? (n === "incgrenade" ? ICON.molotov : "");
  return svg && cls ? `<span class="${cls}">${svg}</span>` : svg;
};
