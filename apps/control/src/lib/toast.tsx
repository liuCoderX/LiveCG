import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = (msg: string, kind?: "error" | "ok") => void;
const Ctx = createContext<Toast>(() => {});

/** 右下角提示：错误默认红色，5 秒后消失 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind: "error" | "ok" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback<Toast>((text, kind = "error") => {
    setMsg({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 5000);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div id="toast" role="alert" className={msg?.kind === "ok" ? "ok" : ""} style={{ display: msg ? "block" : "none" }}>
        {msg?.text}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
