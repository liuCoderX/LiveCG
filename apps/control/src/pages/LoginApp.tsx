import { useEffect, useState, type FormEvent } from "react";
import type { Me } from "@livecg/shared";
import { api } from "../lib/api.ts";

const params = new URLSearchParams(location.search);
/** 只允许跳回本站的 /control/ 页面，防止开放重定向 */
const nextUrl = () => {
  const n = params.get("next") ?? "";
  return n.startsWith("/control/") && !n.startsWith("//") ? n : "/control/rooms.html";
};

export function LoginApp() {
  const [stage, setStage] = useState<"loading" | "login" | "change">("loading");
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  useEffect(() => {
    // 已登录：需要改密码就停在改密码，否则直接回去
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) return setStage("login");
      const m = (await r.json()) as Me;
      setMe(m);
      if (m.user.mustChangePassword) setStage("change");
      else if (params.get("change") !== "1") location.replace(nextUrl());
      else setStage("change");
    }).catch(() => setStage("login"));
  }, []);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const m = await api<Me>("/api/auth/login", "POST", { username, password });
      setMe(m);
      if (m.user.mustChangePassword) {
        setCurrent(password);
        setStage("change");
      } else {
        location.replace(nextUrl());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirmPw) return setError("两次输入的新密码不一致");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/password", "POST", { current, next });
      location.replace(nextUrl());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === "loading") return null;
  return (
    <div className="login-wrap">
      {stage === "login" ? (
        <form className="login" onSubmit={login} id="loginForm">
          <section>
            <h1>LiveCG 登录</h1>
            <p className="hint">实时字幕图文系统 · 控制台</p>
            <label>用户名<input name="username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label>密码<input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy}>登录</button>
          </section>
        </form>
      ) : (
        <form className="login" onSubmit={change} id="changeForm">
          <section>
            <h1>修改密码</h1>
            <p className="hint">{me?.user.mustChangePassword ? `账号「${me.user.username}」使用的是初始密码，请先设置自己的密码。` : "设置新密码。"}</p>
            <label>当前密码<input name="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
            <label>新密码（至少 8 位）<input name="next" type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} /></label>
            <label>再输入一次<input name="confirm" type="password" autoComplete="new-password" minLength={8} required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} /></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy}>保存并继续</button>
          </section>
        </form>
      )}
    </div>
  );
}
