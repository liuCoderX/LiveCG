import type { ClientMessage, Role } from "@livecg/shared";

/** 一次请求的身份 */
export interface Principal {
  username: string;
  role: Role;
  rooms: "*" | string[];
  /** session / token:<名称> / anonymous / disabled（鉴权关闭） */
  via: string;
  /** 匿名只读（输出页） */
  anonymous?: boolean;
}

export const ANONYMOUS: Principal = { username: "anonymous", role: "viewer", rooms: "*", via: "anonymous", anonymous: true };
export const AUTH_DISABLED: Principal = { username: "local", role: "admin", rooms: "*", via: "disabled" };

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
export const atLeast = (p: Principal, role: Role) => RANK[p.role] >= RANK[role];

export const canAccessRoom = (p: Principal, room: string) => p.role === "admin" || p.rooms === "*" || p.rooms.includes(room);

/**
 * 指令所需的最低角色。设备配置（CasparCG / 计分器）只能管理员改：
 * 改错一个端口或通道层，可能让别的房间、别的节目黑屏。
 */
export function requiredRole(msg: ClientMessage): Role {
  switch (msg.type) {
    case "hello":
      return "viewer";
    case "config.set":
      return "casparcg" in msg.patch || "scoreboard" in msg.patch ? "admin" : "operator";
    default:
      return "operator";
  }
}

/** 检查一条房间指令；不允许时返回中文原因 */
export function denyReason(p: Principal, room: string, msg: ClientMessage): string | undefined {
  if (p.anonymous) return msg.type === "hello" ? undefined : "未登录：请先登录控制台";
  if (!canAccessRoom(p, room)) return `没有房间「${room}」的权限`;
  const need = requiredRole(msg);
  if (!atLeast(p, need)) return need === "admin" ? "只有管理员可以修改设备配置" : "当前账号为只读";
  return undefined;
}
