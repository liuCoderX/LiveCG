import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, ClientMessage, GameEvent } from "@livecg/shared";
// 与输出页共用同一个客户端实现（自动重连、按 rev 丢弃乱序状态）
import { connect, currentRoom } from "../../../graphics/lib/livecg-client.js";

/** 当前页面的房间（?room=，缺省为默认房间） */
export const ROOM: string = currentRoom();

export interface Live {
  state?: AppState;
  connected: boolean;
  roomGone: boolean;
  send: (msg: ClientMessage) => void;
}

/**
 * 连接本房间的实时状态。
 * 回调用 ref 保存最新版本，连接只建立一次，不会因为组件重渲染而重连。
 */
export function useLive(opts: { onEvent?: (e: GameEvent) => void; onError?: (msg: string) => void } = {}): Live {
  const [state, setState] = useState<AppState>();
  const [conn, setConn] = useState({ connected: false, roomGone: false });
  const handlers = useRef(opts);
  handlers.current = opts;
  const client = useRef<{ send: (m: ClientMessage) => void; close: () => void }>();

  useEffect(() => {
    const c = connect({
      role: "control",
      room: ROOM,
      onState: (s: AppState) => {
        setState(s);
        setConn((cur) => (cur.connected && !cur.roomGone ? cur : { connected: true, roomGone: false }));
      },
      onEvent: (e: GameEvent) => handlers.current.onEvent?.(e),
      onError: (m: string) => handlers.current.onError?.(m),
      onConnection: (ok: boolean, reason?: string) => setConn({ connected: ok, roomGone: reason === "room-gone" }),
    });
    client.current = c;
    return () => c.close();
  }, []);

  const send = useCallback((msg: ClientMessage) => client.current?.send(msg), []);
  return { state, ...conn, send };
}
