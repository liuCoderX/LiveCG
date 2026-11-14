/**
 * 生成 CS2 GSI 配置文件（gamestate_integration_livecg.cfg）：以仓库里的模板为准，只替换 uri 和 token，
 * 避免现场手改时把地址、房间或 token 填错。
 */
import { networkInterfaces } from "node:os";
import { ROOM_ID_RE } from "./rooms.ts";

export interface Cs2CfgOptions {
  /** LiveCG 服务地址，如 http://10.0.0.5:3000 */
  url: string;
  /** 房间标识；不填则用默认房间（/gsi/cs2） */
  room?: string;
  token: string;
}

export function gsiUri(url: string, room?: string): string {
  const base = url.replace(/\/+$/, "");
  return room ? `${base}/gsi/cs2/${room}` : `${base}/gsi/cs2`;
}

/** 校验参数，返回问题列表（error 必须改，warn 提醒） */
export function checkCs2CfgOptions(o: Cs2CfgOptions): { errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  let u: URL | undefined;
  try {
    u = new URL(o.url);
    if (u.protocol !== "http:") errors.push(`地址要用 http://（CS2 只支持 http）：${o.url}`);
    if (u.pathname !== "/" || u.search) errors.push(`地址只写到端口，不要带路径：${o.url}`);
  } catch {
    errors.push(`地址格式不对：${o.url}（应为 http://<LiveCG 服务器 IP>:3000）`);
  }
  if (u && /^(localhost|127\.|0\.0\.0\.0|\[::1?\])/.test(u.hostname)) {
    warns.push(`地址是本机（${u.hostname}）：只有 CS2 和 LiveCG 装在同一台机器上才能用，OB 机请填 LiveCG 服务器的局域网 IP`);
  }
  if (o.room !== undefined && !ROOM_ID_RE.test(o.room)) errors.push(`房间标识不对：${o.room}（小写字母、数字、连字符）`);
  if (!o.token) errors.push("token 为空：先在 .env 里设置 CS2_GSI_TOKEN");
  else if (o.token === "change-me") errors.push("token 还是默认的 change-me：先在 .env 里把 CS2_GSI_TOKEN 改成随机字符串并重启服务");
  if (/["\\\n]/.test(o.token)) errors.push("token 不能包含引号、反斜杠或换行");
  return { errors, warns };
}

export function renderCs2Cfg(template: string, o: Cs2CfgOptions): string {
  const uri = gsiUri(o.url, o.room);
  let out = template.replace(/("uri"\s+)"[^"]*"/, `$1"${uri}"`);
  out = out.replace(/("token"\s+)"[^"]*"/, `$1"${o.token}"`);
  if (!out.includes(`"${uri}"`) || !out.includes(`"${o.token}"`)) throw new Error("模板里找不到 uri 或 token 行");
  return out;
}

/** 本机的局域网 IPv4 地址（不含回环） */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
}
