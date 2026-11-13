import type { GameEvent } from "@livecg/shared";
import type { Store } from "./store.ts";

/**
 * 规则引擎：事件 → 自动上/下屏。
 * 规则只发出与操作员相同的图文指令，操作员随时可以手动覆盖。
 */
export function createRules(store: Store) {
  let summaryTimer: NodeJS.Timeout | undefined;
  const hideSummary = () => {
    clearTimeout(summaryTimer);
    if (store.get().layers["round-summary"]?.visible) store.dispatch({ type: "graphic.hide", layer: "round-summary" });
  };

  let eventTimer: NodeJS.Timeout | undefined;

  return (event: GameEvent) => {
    const { automation } = store.get().config;
    switch (event.type) {
      case "football.event":
        // 进球 / 红黄牌 / 换人：自动弹出事件条，到时下屏；新事件直接顶掉旧的（重新上屏，播放入场）
        if (!automation.matchEvents) return;
        clearTimeout(eventTimer);
        store.dispatch({ type: "graphic.show", layer: "match-event", template: "match-event", data: { event: event.event, score: event.score } });
        eventTimer = setTimeout(() => {
          if (store.get().layers["match-event"]?.visible) store.dispatch({ type: "graphic.hide", layer: "match-event" });
        }, automation.matchEventMs);
        return;
      case "cs2.roundEnd":
        if (!automation.roundSummary) return;
        clearTimeout(summaryTimer);
        store.dispatch({ type: "graphic.show", layer: "round-summary", template: "round-summary", data: {} });
        summaryTimer = setTimeout(hideSummary, automation.roundSummaryMs);
        return;
      case "cs2.roundStart":
        // 新回合开始时，结算无论是否到时都必须下屏
        if (automation.roundSummary) hideSummary();
        return;
    }
  };
}
