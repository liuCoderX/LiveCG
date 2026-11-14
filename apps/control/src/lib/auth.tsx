import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me, Role } from "@livecg/shared";
import { api } from "./api.ts";
import { NodeBanner, NodeProvider } from "./node.tsx";

const ROLE_LABEL: Record<Role, string> = { admin: "管理员", operator: "导播", viewer: "只读" };
export const roleLabel = (r: Role) => ROLE_LABEL[r] ?? r;

const Ctx = createContext<Me | null>(null);
export const useMe = () => useContext(Ctx)!;

/** 当前页面地址（登录后跳回） */
const here = () => `${location.pathname}${location.search}`;
export const loginUrl = (opts: { change?: boolean } = {}) =>
  `/control/login.html?next=${encodeURIComponent(here())}${opts.change ? "&change=1" : ""}`;

/**
 * 需要登录的页面外壳：未登录跳到登录页；初始密码未修改跳到改密码；
 * 可选要求最低角色（如审计页只给管理员）。
 */
export function RequireLogin({ children, role }: { children: ReactNode; role?: Role }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.status === 401) return location.replace(loginUrl());
      const data = (await r.json()) as Me & { error?: string };
      if (!r.ok) return setError(data.error ?? `HTTP ${r.status}`);
      if (data.user.mustChangePassword) return location.replace(loginUrl({ change: true }));
      setMe(data);
    }).catch((err) => setError(String(err)));
  }, []);
  if (error) return <p className="hint" style={{ padding: 20 }}>无法获取登录状态：{error}</p>;
  if (!me) return null;
  if (role === "admin" && me.user.role !== "admin") {
    return <p className="hint" style={{ padding: 20 }}>此页面需要管理员权限。<a href="/control/rooms.html">返回房间列表</a></p>;
  }
  return (
    <Ctx.Provider value={me}>
      <NodeProvider>{children}</NodeProvider>
    </Ctx.Provider>
  );
}

export async function logout() {
  await api("/api/auth/logout", "POST").catch(() => {});
  location.href = "/control/login.html";
}

/** 页面右上角：当前账号 + 导航 + 退出 */
export function UserMenu() {
  const me = useMe();
  return (
    <span className="user-menu">
      <a href="/control/rooms.html">房间</a>
      <a href="/control/users.html">{me.user.role === "admin" ? "账号与权限" : "我的账号"}</a>
      {me.user.role === "admin" && <a href="/control/audit.html">操作审计</a>}
      <span className="who" id="whoami">{me.user.username}<small>（{roleLabel(me.user.role)}）</small></span>
      {!me.authDisabled && <button className="sm" id="logout" onClick={logout}>退出</button>}
    </span>
  );
}

/** 房间管理 / 账号 / 审计页共用的页头 */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
    <header>
      <h1>{title}</h1>
      {subtitle && <span className="hint" style={{ margin: 0 }}>{subtitle}</span>}
      <span style={{ flex: 1 }} />
      <UserMenu />
    </header>
    <NodeBanner />
    </>
  );
}
