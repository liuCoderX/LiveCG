import { useEffect, useState, type FormEvent } from "react";
import type { Me, Role, RoomSummary, UserInfo } from "@livecg/shared";
import { api } from "../lib/api.ts";
import { PageHeader, roleLabel, useMe } from "../lib/auth.tsx";
import { useToast } from "../lib/toast.tsx";

const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString() : "—");
const roomsText = (r: "*" | string[]) => (r === "*" ? "*" : r.join(", "));
const parseRooms = (s: string): "*" | string[] => (s.trim() === "*" || !s.trim() ? "*" : s.split(/[,，\s]+/).filter(Boolean));

export function UsersApp() {
  const me = useMe();
  return (
    <>
      <PageHeader title={me.user.role === "admin" ? "账号与权限" : "我的账号"} />
      <main>
        <MyAccount />
        {me.user.role === "admin" && <UserAdmin />}
      </main>
    </>
  );
}

function MyAccount() {
  const me = useMe();
  const toast = useToast();
  const [info, setInfo] = useState<Me>(me);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ label: string; token: string }>();

  const reload = async () => setInfo(await api<Me>("/api/auth/me"));
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/auth/password", "POST", { current, next });
      setCurrent("");
      setNext("");
      toast("密码已修改，其它设备上的登录已失效", "ok");
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const createToken = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string; label: string }>("/api/auth/tokens", "POST", { label });
      setFresh(r);
      setLabel("");
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  if (info.authDisabled) {
    return <section><h2>我的账号</h2><p className="hint">服务端关闭了鉴权（LIVECG_AUTH=off），所有人都以管理员身份操作。正式播出前请开启鉴权。</p></section>;
  }
  return (
    <>
      <section>
        <h2>修改密码</h2>
        <form className="row" onSubmit={changePw} id="pwForm" autoComplete="off">
          <input type="password" name="current" placeholder="当前密码" aria-label="当前密码" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <input type="password" name="next" placeholder="新密码（至少 8 位）" aria-label="新密码" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <button type="submit" className="primary">修改</button>
        </form>
      </section>
      <section>
        <h2>API 令牌（Stream Deck / Companion / 脚本）</h2>
        <p className="hint">令牌拥有与你的账号相同的权限，请求时放在请求头：<code>Authorization: Bearer &lt;令牌&gt;</code>。令牌只在创建时显示一次。</p>
        {fresh && (
          <div style={{ margin: "12px 0" }}>
            <p className="hint" style={{ color: "var(--warn)" }}>「{fresh.label}」已创建，请立即复制保存，关闭后无法再次查看：</p>
            <div className="secret" id="newToken">{fresh.token}</div>
          </div>
        )}
        <form className="row" onSubmit={createToken} id="tokenForm" style={{ marginTop: 12 }}>
          <input name="label" placeholder="用途，例如 导播台 Stream Deck" aria-label="令牌用途" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="submit">创建令牌</button>
        </form>
        <div className="table-wrap">
          <table className="grid" id="tokens">
            <thead><tr><th>用途</th><th>创建时间</th><th>最近使用</th><th /></tr></thead>
            <tbody>
              {info.user.tokens.length ? info.user.tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td><td>{fmtTime(t.createdAt)}</td><td>{fmtTime(t.lastUsedAt)}</td>
                  <td>
                    <button className="sm danger" onClick={async () => {
                      if (!confirm(`吊销令牌「${t.label}」？使用它的设备会立即失去权限。`)) return;
                      try {
                        await api(`/api/auth/tokens/${t.id}`, "DELETE");
                        reload();
                      } catch (err) {
                        toast((err as Error).message);
                      }
                    }}>吊销</button>
                  </td>
                </tr>
              )) : <tr><td colSpan={4} className="hint">还没有令牌</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function UserAdmin() {
  const me = useMe();
  const toast = useToast();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [form, setForm] = useState({ username: "", password: "", role: "operator" as Role, rooms: "*" });

  const reload = async () => {
    try {
      setUsers(await api<UserInfo[]>("/api/users"));
    } catch (err) {
      toast((err as Error).message);
    }
  };
  useEffect(() => {
    reload();
    api<RoomSummary[]>("/api/rooms").then(setRooms).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
    } catch (err) {
      toast((err as Error).message);
    }
    reload();
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/api/users", "POST", { ...form, rooms: parseRooms(form.rooms) });
      setForm({ username: "", password: "", role: "operator", rooms: "*" });
    }, `已创建账号「${form.username}」，首次登录需修改密码`);
  };

  return (
    <>
      <section>
        <h2>新建账号</h2>
        <form onSubmit={create} id="userForm" autoComplete="off">
          <div className="filters">
            <label>用户名<input name="username" required pattern="[A-Za-z0-9_.\-]{2,32}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label>初始密码（至少 8 位）<input name="password" type="password" minLength={8} required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <label>角色
              <select name="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="operator">导播（播出与赛况操作）</option>
                <option value="viewer">只读</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label>可用房间（* 为全部，多个用逗号分隔）<input name="rooms" value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} list="roomIds" /></label>
            <button type="submit" className="primary">创建</button>
          </div>
          <datalist id="roomIds">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</datalist>
        </form>
        <p className="hint">导播不能修改 CasparCG / 计分器等设备配置，也不能管理房间和账号；管理员不受房间范围限制。</p>
      </section>
      <section>
        <h2>账号列表</h2>
        <div className="table-wrap">
          <table className="grid" id="users">
            <thead><tr><th>用户名</th><th>角色</th><th>可用房间</th><th>API 令牌</th><th>状态</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username} data-user={u.username}>
                  <td><b>{u.username}</b>{u.username === me.user.username && <span className="hint">（我）</span>}</td>
                  <td>
                    <select
                      aria-label={`${u.username} 的角色`}
                      value={u.role}
                      onChange={(e) => run(() => api(`/api/users/${encodeURIComponent(u.username)}`, "PATCH", { role: e.target.value }), "角色已更新，该账号需重新登录")}
                    >
                      {(["admin", "operator", "viewer"] as const).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`${u.username} 的可用房间`}
                      defaultValue={roomsText(u.rooms)}
                      key={roomsText(u.rooms)}
                      disabled={u.role === "admin"}
                      title={u.role === "admin" ? "管理员不受房间范围限制" : "* 为全部，多个用逗号分隔，回车或离开输入框保存"}
                      onBlur={(e) => {
                        const v = parseRooms(e.target.value);
                        if (roomsText(v) !== roomsText(u.rooms)) run(() => api(`/api/users/${encodeURIComponent(u.username)}`, "PATCH", { rooms: v }), "房间范围已更新");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                  <td>{u.tokens.length}</td>
                  <td>{u.mustChangePassword ? <span className="tag">待改初始密码</span> : <span className="tag ok">正常</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="sm" onClick={() => {
                      const pw = prompt(`为「${u.username}」设置新的临时密码（至少 8 位），对方登录后需修改：`);
                      if (pw) run(() => api(`/api/users/${encodeURIComponent(u.username)}`, "PATCH", { password: pw }), "已重置密码");
                    }}>重置密码</button>{" "}
                    {u.username !== me.user.username && (
                      <button className="sm danger" onClick={() => confirm(`删除账号「${u.username}」？该账号的登录和 API 令牌会立即失效。`) && run(() => api(`/api/users/${encodeURIComponent(u.username)}`, "DELETE"), "已删除")}>删除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
