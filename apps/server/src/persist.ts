import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppState, TeamState } from "@livecg/shared";
import { DEFAULT_ROOM, type Store, type StoreSeed } from "./store.ts";

/**
 * 持久化：配置、播出单、队伍资料写入一个 JSON 文件，重启不丢。
 * 比分、图层、实时数据不持久化（重启后由数据源/操作员重新驱动）。
 */
interface Persisted {
  version: 1;
  /** 房间显示名（房间 id 来自文件名） */
  name?: string;
  config: AppState["config"];
  rundown: AppState["rundown"];
  teams: Record<"home" | "away", Pick<TeamState, "name" | "shortName" | "color" | "logo">>;
}

const pick = (t: TeamState) => ({ name: t.name, shortName: t.shortName, color: t.color, logo: t.logo });

function snapshot(s: AppState): Persisted {
  return { version: 1, name: s.room.name, config: s.config, rundown: s.rundown, teams: { home: pick(s.match.home), away: pick(s.match.away) } };
}

export function loadSeed(file: string, roomId?: string): StoreSeed {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Persisted;
    if (data.version !== 1) return {};
    return {
      // 单房间版本的文件没有 name：默认房间用「默认房间」，其它用 id
      ...(roomId ? { room: { id: roomId, name: data.name || (roomId === DEFAULT_ROOM.id ? DEFAULT_ROOM.name : roomId) } } : {}),
      config: data.config,
      rundown: data.rundown,
      match: { home: data.teams?.home, away: data.teams?.away },
    };
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.warn(`[persist] 读取 ${file} 失败，使用默认配置：${err?.message ?? err}`);
    return {};
  }
}

/** 订阅 store，只有持久化部分真正变化时才写盘（GSI 每秒 10 帧不会触发写盘） */
export function persistTo(store: Store, file: string, debounceMs = 500): () => void {
  mkdirSync(dirname(file), { recursive: true });
  let last = JSON.stringify(snapshot(store.get()));
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    timer = undefined;
    const json = JSON.stringify(snapshot(store.get()), null, 2);
    // 先写临时文件再改名，避免写到一半断电留下损坏的文件
    writeFileSync(`${file}.tmp`, json);
    renameSync(`${file}.tmp`, file);
  };

  // 新房间（文件还不存在）立即落盘：否则创建后不做任何修改就重启，房间会丢失
  if (!existsSync(file)) flush();

  const unsubscribe = store.subscribe((state) => {
    const s = JSON.stringify(snapshot(state));
    if (s === last) return;
    last = s;
    clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  return () => {
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  };
}
