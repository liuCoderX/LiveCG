import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { Store } from "../src/store.ts";
import { CasparClient } from "../src/casparcg.ts";

/** 最小 AMCP 假服务器：记录收到的指令，按 CasparCG 格式应答 */
function fakeCaspar(port = 0) {
  const lines: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        const cmd = line.split(" ")[0];
        if (cmd === "VERSION") sock.write("201 VERSION OK\r\n2.4.0 test\r\n");
        else if (line.includes("bad-url")) sock.write(`404 ${cmd} FAILED\r\n`);
        else sock.write(`202 ${cmd} OK\r\n`);
      }
    });
  });
  return {
    lines,
    listen: () => new Promise<number>((r) => server.listen(port, "127.0.0.1", () => r((server.address() as AddressInfo).port))),
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

function setup(port: number) {
  const store = new Store();
  store.dispatch({ type: "config.set", patch: { casparcg: { enabled: true, host: "127.0.0.1", port, baseUrl: "http://10.0.0.5:3000/" } } });
  const client = new CasparClient(store);
  client.start();
  return { store, client };
}

test("connects, reads version and loads the enabled outputs", async () => {
  const fake = fakeCaspar();
  const port = await fake.listen();
  const { store, client } = setup(port);
  try {
    await until(() => store.get().outputs.casparcg.version === "2.4.0 test");
    assert.equal(store.get().outputs.casparcg.status, "connected");
    await until(() => fake.lines.some((l) => l.startsWith("PLAY")));
    assert.ok(fake.lines.includes('PLAY 1-20 [HTML] "http://10.0.0.5:3000/graphics/?room=default&channel=pgm"'));
    assert.ok(!fake.lines.some((l) => l.includes("channel=pvw")), "disabled PVW output is not loaded");
    assert.deepEqual(store.get().outputs.casparcg.loaded, ["pgm"]);
  } finally {
    client.stop();
    await fake.close();
  }
});

test("config changes only send the difference (enable PVW, move PGM layer)", async () => {
  const fake = fakeCaspar();
  const port = await fake.listen();
  const { store, client } = setup(port);
  try {
    await until(() => store.get().outputs.casparcg.loaded.length === 1);
    const outputs = store.get().config.casparcg.outputs.map((o) => ({ ...o, enabled: true, layer: o.id === "pgm" ? 30 : o.layer }));
    fake.lines.length = 0;
    store.dispatch({ type: "config.set", patch: { casparcg: { outputs } } });
    await until(() => fake.lines.length >= 3);
    assert.deepEqual(fake.lines.sort(), [
      "CLEAR 1-20",
      'PLAY 1-30 [HTML] "http://10.0.0.5:3000/graphics/?room=default&channel=pgm"',
      'PLAY 2-20 [HTML] "http://10.0.0.5:3000/graphics/?room=default&channel=pvw"',
    ]);
    // 无关的状态变化不应产生任何 AMCP 指令
    fake.lines.length = 0;
    for (let i = 0; i < 20; i++) store.dispatch({ type: "match.patch", patch: { home: { score: i } } });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(fake.lines, []);
  } finally {
    client.stop();
    await fake.close();
  }
});

test("reconnects after CasparCG restarts and reloads outputs", async () => {
  const fake = fakeCaspar();
  const port = await fake.listen();
  const { store, client } = setup(port);
  try {
    await until(() => store.get().outputs.casparcg.loaded.length === 1);
    await fake.close();
    await until(() => store.get().outputs.casparcg.status !== "connected");
    assert.deepEqual(store.get().outputs.casparcg.loaded, []);

    const again = fakeCaspar(port);
    await again.listen();
    try {
      await until(() => again.lines.some((l) => l.startsWith("PLAY 1-20")), 5000);
      await until(() => store.get().outputs.casparcg.status === "connected");
    } finally {
      await again.close();
    }
  } finally {
    client.stop();
  }
});

test("AMCP command errors are reported without dropping the connection", async () => {
  const fake = fakeCaspar();
  const port = await fake.listen();
  const { store, client } = setup(port);
  try {
    await until(() => store.get().outputs.casparcg.loaded.length === 1);
    store.dispatch({ type: "config.set", patch: { casparcg: { baseUrl: "http://bad-url" } } });
    await until(() => !!store.get().outputs.casparcg.message);
    assert.match(store.get().outputs.casparcg.message!, /PLAY 失败/);
    assert.equal(store.get().outputs.casparcg.status, "connected");
  } finally {
    client.stop();
    await fake.close();
  }
});

test("disabling CasparCG disconnects and reports disabled", async () => {
  const fake = fakeCaspar();
  const port = await fake.listen();
  const { store, client } = setup(port);
  try {
    await until(() => store.get().outputs.casparcg.status === "connected");
    store.dispatch({ type: "config.set", patch: { casparcg: { enabled: false } } });
    await until(() => store.get().outputs.casparcg.status === "disabled");
  } finally {
    client.stop();
    await fake.close();
  }
});
