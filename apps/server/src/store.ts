import type { AppState, ClientMessage, DeepPartial, MatchState } from "@livecg/shared";

type Listener = (state: AppState) => void;

function deepMerge<T>(target: T, patch: DeepPartial<T>): T {
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

/** 单一状态源（Single Source of Truth）：所有数据源与操作员指令都汇入这里 */
export class Store {
  private state: AppState = { match: initialMatch, layers: {}, rev: 0 };
  private listeners = new Set<Listener>();

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

  dispatch(msg: ClientMessage): void {
    const layers = { ...this.state.layers };
    switch (msg.type) {
      case "graphic.show":
        layers[msg.layer] = { layer: msg.layer, template: msg.template, visible: true, data: msg.data ?? {} };
        break;
      case "graphic.update": {
        const cur = layers[msg.layer];
        if (!cur) return;
        layers[msg.layer] = { ...cur, data: { ...cur.data, ...msg.data } };
        break;
      }
      case "graphic.hide": {
        const cur = layers[msg.layer];
        if (!cur) return;
        layers[msg.layer] = { ...cur, visible: false };
        break;
      }
      case "graphic.clearAll":
        for (const k of Object.keys(layers)) layers[k] = { ...layers[k], visible: false };
        break;
      case "match.patch":
        return this.patchMatch(msg.patch);
      default:
        return;
    }
    this.commit({ ...this.state, layers });
  }

  private commit(next: AppState): void {
    this.state = { ...next, rev: this.state.rev + 1 };
    for (const fn of this.listeners) fn(this.state);
  }
}
