// 图文端 / 控制台共用的 WebSocket 客户端：按房间连接，自动重连，按 rev 丢弃过期状态
const ROOM_GONE = 4404;

/** 当前页面 URL 上的房间（?room=），不带则为默认房间 */
export const currentRoom = () => new URLSearchParams(location.search).get("room") || "default";

/**
 * 可连接的服务器列表：本页所在服务器优先，其后是 ?failover= 里的备机（逗号分隔，如 http://10.0.0.6:3000）。
 * 主机断线时轮流尝试下一台——已经在 CasparCG / OBS 里运行的输出页不需要重新加载就能切到备机。
 */
const servers = () => {
  const own = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const failover = (new URLSearchParams(location.search).get("failover") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((u) => {
      try {
        const url = new URL(u);
        return [`${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`];
      } catch {
        return [];
      }
    });
  return [own, ...failover.filter((f) => f !== own)];
};

export function connect({ role, room = currentRoom(), onState, onEvent, onError, onConnection }) {
  let ws;
  let lastRev = -1;
  let closed = false;
  let retryTimer;
  const queue = [];
  const hosts = servers();
  let hostIdx = 0;
  let wasOpen = false;
  const open = () => {
    if (closed) return;
    // 输出页地址上的 ?token=（服务端设置了输出令牌时需要）原样带给 WebSocket
    const token = new URLSearchParams(location.search).get("token");
    wasOpen = false;
    ws = new WebSocket(`${hosts[hostIdx]}/ws?room=${encodeURIComponent(room)}${token ? `&token=${encodeURIComponent(token)}` : ""}`);
    ws.onopen = () => {
      // 服务端重启后 rev 从 0 开始，重连时必须重置，否则会丢弃所有新状态
      lastRev = -1;
      wasOpen = true;
      ws.send(JSON.stringify({ type: "hello", role }));
      while (queue.length) ws.send(queue.shift());
      onConnection?.(true);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state" && msg.state.rev > lastRev) {
        lastRev = msg.state.rev;
        onState(msg.state);
      } else if (msg.type === "event") {
        onEvent?.(msg.event);
      } else if (msg.type === "error") {
        onError?.(msg.message);
      }
    };
    ws.onclose = (e) => {
      if (closed) return;
      onConnection?.(false, e.code === ROOM_GONE ? "room-gone" : "disconnected");
      if (e.code === ROOM_GONE) onError?.(`房间「${room}」不存在或已被删除`);
      // 有备机时换下一台；刚断开的连接立刻切（输出画面尽量不中断），一圈都连不上再放慢
      const failover = hosts.length > 1 && e.code !== ROOM_GONE;
      if (failover) hostIdx = (hostIdx + 1) % hosts.length;
      // 房间不存在时放慢重试（也许稍后会被重新创建），普通断线 1 秒重连
      retryTimer = setTimeout(open, e.code === ROOM_GONE ? 5000 : failover && wasOpen ? 100 : 1000);
    };
  };
  open();
  return {
    room,
    send(msg) {
      const s = JSON.stringify(msg);
      ws.readyState === WebSocket.OPEN ? ws.send(s) : queue.push(s);
    },
    /** 停止重连并关闭连接（React 组件卸载时调用） */
    close() {
      closed = true;
      clearTimeout(retryTimer);
      ws?.close();
    },
  };
}
