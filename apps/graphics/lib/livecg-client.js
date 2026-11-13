// 图文端 / 控制台共用的 WebSocket 客户端：自动重连 + 按 rev 丢弃过期状态
export function connect({ role, onState }) {
  let ws;
  let lastRev = -1;
  const queue = [];
  const open = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => {
      lastRev = -1;
      ws.send(JSON.stringify({ type: "hello", role }));
      while (queue.length) ws.send(queue.shift());
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state" && msg.state.rev > lastRev) {
        lastRev = msg.state.rev;
        onState(msg.state);
      }
    };
    ws.onclose = () => setTimeout(open, 1000);
  };
  open();
  return {
    send(msg) {
      const s = JSON.stringify(msg);
      ws.readyState === WebSocket.OPEN ? ws.send(s) : queue.push(s);
    },
  };
}
