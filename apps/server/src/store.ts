import { randomUUID } from "node:crypto";
import type {
  AppConfig,
  AppState,
  ClientMessage,
  DeepPartial,
  GraphicLayer,
  MatchState,
  OutputStatus,
  Rundown,
  RundownItem,
} from "@livecg/shared";

type Listener = (state: AppState) => void;

export function deepMerge<T>(target: T, patch: DeepPartial<T>): T {
  const out: any = Array.isArray(target) ? [...(target as any)] : { ...(target as any) };
  for (const [k, v] of Object.entries(patch as object)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
      out[k] = deepMerge(out[k], v as any);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const initialMatch: MatchState = {
  sport: "generic",
  title: "LiveCG Demo Match",
  period: "",
  home: { id: "home", name: "Home Team", shortName: "HOME", score: 0, color: "#2f6bff" },
  away: { id: "away", name: "Away Team", shortName: "AWAY", score: 0, color: "#ff5a36" },
  extra: {},
};

export function defaultConfig(port = Number(process.env.PORT ?? 3000)): AppConfig {
  return {
    cs2DelayMs: Number(process.env.CS2_DELAY_MS ?? 0),
    automation: { roundSummary: true, roundSummaryMs: 7000, matchEvents: true, matchEventMs: 8000 },
    casparcg: {
      enabled: false,
      host: "127.0.0.1",
      port: 5250,
      baseUrl: `http://127.0.0.1:${port}`,
      outputs: [
        { id: "pgm", label: "PGM", channel: 1, layer: 20, source: "pgm", enabled: true },
        { id: "pvw", label: "PVW", channel: 2, layer: 20, source: "pvw", enabled: false },
      ],
    },
    scoreboard: { enabled: false, port: 5300, clockSource: "internal", staleMs: 3000 },
  };
}

/** 首次启动时的示例播出单 */
export function defaultRundown(): Rundown {
  const items: RundownItem[] = [
    { id: "scorebug", label: "比分条", layer: "scorebug", template: "scorebug", data: {}, hotkey: "1" },
    { id: "player-bars", label: "选手血量/经济", layer: "player-bars", template: "player-bars", data: {}, hotkey: "2" },
    { id: "killfeed", label: "击杀信息", layer: "killfeed", template: "killfeed", data: {}, hotkey: "3" },
    { id: "round-summary", label: "回合结算", layer: "round-summary", template: "round-summary", data: {}, hotkey: "4" },
    { id: "lt-caster-1", label: "人名条 · 解说 1", layer: "lt", template: "lower-third", data: { title: "解说 张三", subtitle: "LiveCG 电竞频道" }, hotkey: "5" },
    { id: "lt-caster-2", label: "人名条 · 解说 2", layer: "lt", template: "lower-third", data: { title: "解说 李四", subtitle: "LiveCG 电竞频道" }, hotkey: "6" },
    { id: "caption", label: "实时字幕", layer: "caption", template: "caption", data: { text: "" }, hotkey: "7" },
    { id: "football-scorebug", label: "足球比分条", layer: "scorebug", template: "football-scorebug", data: {} },
    { id: "basketball-scorebug", label: "篮球比分条", layer: "scorebug", template: "basketball-scorebug", data: {} },
    { id: "lineup-home", label: "首发名单 · 主队", layer: "fullscreen", template: "lineup", data: { team: "home", title: "首发阵容", players: "1 球员甲 门将\n4 球员乙 后卫\n10 球员丙 前锋", coach: "" } },
  ];
  return { items, selectedId: items[0].id };
}

export interface StoreSeed {
  config?: DeepPartial<AppConfig>;
  rundown?: Rundown;
  match?: DeepPartial<MatchState>;
}

const HOTKEY_RE = /^[0-9a-z]$/;

/** 单一状态源（Single Source of Truth）：所有数据源与操作员指令都汇入这里 */
export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private takeSeq = 0;

  constructor(seed: StoreSeed = {}) {
    this.state = {
      match: seed.match ? deepMerge(initialMatch, seed.match) : initialMatch,
      layers: {},
      preview: {},
      rundown: seed.rundown ?? defaultRundown(),
      config: seed.config ? deepMerge(defaultConfig(), seed.config) : defaultConfig(),
      outputs: { casparcg: { status: "disabled", loaded: [] }, scoreboard: { status: "disabled" } },
      rev: 0,
    };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  patchMatch(patch: DeepPartial<MatchState>): void {
    this.commit({ ...this.state, match: deepMerge(this.state.match, patch) });
  }

  /** 整体替换比赛状态（换项目时需要丢掉上一个项目的 extra，deepMerge 做不到） */
  setMatch(fn: (m: MatchState) => MatchState): void {
    this.commit({ ...this.state, match: fn(this.state.match) });
  }

  setOutputs(patch: DeepPartial<OutputStatus>): void {
    this.commit({ ...this.state, outputs: deepMerge(this.state.outputs, patch) });
  }

  private layer(msg: { layer: string; template: string; data?: Record<string, unknown>; itemId?: string }): GraphicLayer {
    return { layer: msg.layer, template: msg.template, visible: true, data: msg.data ?? {}, itemId: msg.itemId, takeId: ++this.takeSeq };
  }

  dispatch(msg: ClientMessage): void {
    const s = this.state;
    switch (msg.type) {
      case "graphic.show":
        return this.commit({ ...s, layers: { ...s.layers, [msg.layer]: this.layer(msg) } });

      case "graphic.cue":
        return this.commit({ ...s, preview: { ...s.preview, [msg.layer]: this.layer(msg) } });

      case "graphic.take": {
        const keys = msg.layer ? [msg.layer] : Object.keys(s.preview);
        const ready = keys.filter((k) => s.preview[k]?.visible);
        if (!ready.length) return;
        const layers = { ...s.layers };
        const preview = { ...s.preview };
        for (const k of ready) {
          // 切到 PGM 视为一次新的上屏：换新 takeId，输出端会播放入场动画
          layers[k] = { ...preview[k], takeId: ++this.takeSeq };
          delete preview[k];
        }
        return this.commit({ ...s, layers, preview });
      }

      case "graphic.update": {
        const key = msg.channel === "pvw" ? "preview" : "layers";
        const cur = s[key][msg.layer];
        if (!cur) return;
        return this.commit({ ...s, [key]: { ...s[key], [msg.layer]: { ...cur, data: { ...cur.data, ...msg.data } } } });
      }

      case "graphic.hide": {
        const cur = s.layers[msg.layer];
        if (!cur?.visible) return;
        return this.commit({ ...s, layers: { ...s.layers, [msg.layer]: { ...cur, visible: false } } });
      }

      case "graphic.clearAll": {
        const layers = Object.fromEntries(Object.entries(s.layers).map(([k, l]) => [k, { ...l, visible: false }]));
        return this.commit({ ...s, layers });
      }

      case "preview.clear": {
        if (!msg.layer) return this.commit({ ...s, preview: {} });
        if (!s.preview[msg.layer]) return;
        const preview = { ...s.preview };
        delete preview[msg.layer];
        return this.commit({ ...s, preview });
      }

      case "rundown.upsert": {
        const hotkey = msg.item.hotkey?.toLowerCase().trim() || undefined;
        if (hotkey && !HOTKEY_RE.test(hotkey)) throw new Error(`热键只能是单个数字或字母：${msg.item.hotkey}`);
        if (!msg.item.layer || !msg.item.template) throw new Error("条目必须指定图层和模板");
        const id = msg.item.id || randomUUID().slice(0, 8);
        const item: RundownItem = { ...msg.item, id, hotkey };
        // 热键唯一：抢走其它条目的同名热键
        let items = s.rundown.items.map((it) => (hotkey && it.id !== id && it.hotkey === hotkey ? { ...it, hotkey: undefined } : it));
        const idx = items.findIndex((it) => it.id === id);
        items = idx >= 0 ? items.map((it) => (it.id === id ? item : it)) : [...items, item];
        return this.commit({ ...s, rundown: { ...s.rundown, items, selectedId: id } });
      }

      case "rundown.remove": {
        const idx = s.rundown.items.findIndex((it) => it.id === msg.id);
        if (idx < 0) return;
        const items = s.rundown.items.filter((it) => it.id !== msg.id);
        const selectedId = s.rundown.selectedId === msg.id ? items[Math.min(idx, items.length - 1)]?.id : s.rundown.selectedId;
        return this.commit({ ...s, rundown: { items, selectedId } });
      }

      case "rundown.move": {
        const items = [...s.rundown.items];
        const from = items.findIndex((it) => it.id === msg.id);
        if (from < 0) return;
        const [it] = items.splice(from, 1);
        items.splice(Math.max(0, Math.min(items.length, msg.to)), 0, it);
        return this.commit({ ...s, rundown: { ...s.rundown, items } });
      }

      case "rundown.select":
        if (!s.rundown.items.some((it) => it.id === msg.id)) return;
        return this.commit({ ...s, rundown: { ...s.rundown, selectedId: msg.id } });

      case "rundown.cue": {
        const items = s.rundown.items;
        const idx = items.findIndex((it) => it.id === (msg.id ?? s.rundown.selectedId));
        if (idx < 0) return;
        const item = items[idx];
        const next = items[idx + 1]?.id ?? item.id;
        this.state = { ...s, rundown: { ...s.rundown, selectedId: next } };
        return this.dispatch({ type: "graphic.cue", layer: item.layer, template: item.template, data: item.data, itemId: item.id });
      }

      case "rundown.fire": {
        const item = s.rundown.items.find((it) => it.id === msg.id);
        if (!item) return;
        const onAir = s.layers[item.layer];
        if (onAir?.visible && onAir.itemId === item.id) return this.dispatch({ type: "graphic.hide", layer: item.layer });
        return this.dispatch({ type: "graphic.show", layer: item.layer, template: item.template, data: item.data, itemId: item.id });
      }

      case "match.patch":
        return this.patchMatch(msg.patch);

      case "config.set":
        return this.commit({ ...s, config: deepMerge(s.config, msg.patch) });

      default:
        return;
    }
  }

  private commit(next: AppState): void {
    this.state = { ...next, rev: this.state.rev + 1 };
    for (const fn of this.listeners) fn(this.state);
  }
}
