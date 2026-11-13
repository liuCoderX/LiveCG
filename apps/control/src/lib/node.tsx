import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { NodeStatus } from "@livecg/shared";
import { api } from "./api.ts";
import { useMe } from "./auth.tsx";
import { useInterval } from "./hooks.ts";
import { useToast } from "./toast.tsx";

type Node = (NodeStatus & { conflict?: boolean }) | undefined;
const Ctx = createContext<Node>(undefined);

/** 本节点的主备状态（未配置主备时为 undefined）；每 2 秒刷新 */
export function NodeProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [node, setNode] = useState<Node>(me.node);
  const load = () => {
    if (!me.node) return;
    api<NodeStatus>("/api/ha/status").then(setNode).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  useInterval(load, 2000);
  return <Ctx.Provider value={node}>{children}</Ctx.Provider>;
}

export const useNode = () => useContext(Ctx);
export const isStandby = (n: Node) => n?.role === "standby";

const ago = (t?: number) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))} 秒` : "—");

/** 主备横幅：备机提示 / 主机失联 / 双主告警 / 管理员的接管与倒换操作 */
export function NodeBanner() {
  const node = useNode();
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!node || !node.peer) return null;
  const admin = me.user.role === "admin";
  const run = async (path: string, ok: string) => {
    setBusy(true);
    try {
      await api(path, "POST");
      toast(ok, "ok");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (node.role === "standby") {
    const lost = !node.link?.connected;
    return (
      <div className={`node-banner ${lost ? "lost" : "standby"}`} id="nodeBanner" role="status">
        <b>{lost ? "备机 · 主机失联" : "备机 · 同步中"}</b>
        <span>
          {lost
            ? `与主机 ${node.peer} 的同步已中断（最后同步 ${ago(node.link?.lastSyncAt)} 前）。确认主机故障后，由管理员接管。`
            : `画面与主机 ${node.peer} 实时同步，本机只能查看。`}
        </span>
        {admin && (
          <button
            id="promote"
            disabled={busy}
            onClick={() =>
              confirm(lost
                ? "确认主机已经故障？\n\n接管后本机成为主机：开始驱动 CasparCG、接收计分器和 CS2 数据。"
                : "主机仍在线。接管会让主机降为备机（计划内倒换），确定继续？") &&
              run("/api/ha/promote", "本机已接管为主机")
            }
          >接管为主机</button>
        )}
      </div>
    );
  }
  if (node.conflict) {
    return (
      <div className="node-banner lost" id="nodeBanner" role="alert">
        <b>双主告警</b>
        <span>对端 {node.peer} 也处于主机状态，两台可能同时在驱动 CasparCG。请立即确认，并在不该播出的那台上降为备机。</span>
        {admin && <button id="demote" disabled={busy} onClick={() => confirm("把本机降为备机？") && run("/api/ha/demote", "本机已降为备机")}>本机降为备机</button>}
      </div>
    );
  }
  return (
    <div className="node-banner active" id="nodeBanner" role="status">
      <b>主机</b>
      <span>备机 {node.peer} 正在同步本机状态。</span>
      {admin && (
        <button id="handover" className="sm" disabled={busy} onClick={() => confirm(`把播出交给备机 ${node.peer}？本机将降为备机。`) && run("/api/ha/handover", "已交给对端，本机转为备机")}>
          交给备机
        </button>
      )}
    </div>
  );
}
