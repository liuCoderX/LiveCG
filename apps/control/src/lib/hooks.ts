import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ClockState } from "@livecg/shared";

/**
 * 跟随服务端值的输入框：没有焦点时随服务端更新，有焦点时保留操作员正在输入的内容。
 * 用法：<input {...field} />
 */
export function useServerField(server: string | number | undefined | null) {
  const text = server === undefined || server === null ? "" : String(server);
  const [value, setValue] = useState(text);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setValue(text);
  }, [text]);
  return {
    value,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValue(e.target.value),
    onFocus: () => (focused.current = true),
    onBlur: () => (focused.current = false),
  };
}

/**
 * 表单草稿：操作员没改动时随服务端同步；一旦改动（dirty）就不再被覆盖，直到提交。
 */
export function useDraft<T>(server: T): [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useState(server);
  const dirty = useRef(false);
  const key = JSON.stringify(server);
  useEffect(() => {
    if (!dirty.current) setDraft(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (next: T) => {
    dirty.current = true;
    setDraft(next);
  };
  // 提交后只清 dirty：服务端接受时回推的新值会覆盖草稿；
  // 被拒绝（如设备冲突）时服务端值不变，操作员输入的内容保留，方便修改后重试
  const commit = () => {
    dirty.current = false;
  };
  return [draft, update, commit];
}

export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** 每帧重渲染（仅用于时钟读数这类小组件） */
export function useAnimationFrame(active = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/** 时钟本地插值：与输出页同一做法，用本机收到锚点的时刻计算，不依赖服务器系统时间 */
export function useClockMs(clock: ClockState | undefined): () => number | undefined {
  const ref = useRef({ key: "", at: 0 });
  const key = clock ? `${clock.ms}|${clock.updatedAt}|${clock.running}` : "";
  if (ref.current.key !== key) ref.current = { key, at: Date.now() };
  return () => {
    if (!clock) return undefined;
    if (!clock.running) return clock.ms;
    const d = Date.now() - ref.current.at;
    return clock.direction === "down" ? Math.max(0, clock.ms - d) : clock.ms + d;
  };
}

/** localStorage 读写（隐私模式等环境可能抛异常，全部吞掉） */
export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
};
