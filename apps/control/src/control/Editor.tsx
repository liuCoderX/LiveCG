import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppState, ClientMessage, RundownItem } from "@livecg/shared";
import type { TemplateMap } from "../lib/templates.ts";

interface Draft {
  label: string;
  template: string;
  layer: string;
  hotkey: string;
  data: Record<string, unknown>;
}

interface Props {
  state: AppState;
  templates: TemplateMap;
  send: (m: ClientMessage) => void;
  /** 由父组件控制：点「新建」切到 new，选中条目切回 edit */
  mode: "edit" | "new";
  setMode: (m: "edit" | "new") => void;
  /** 每次点「新建」递增：清空表单 */
  newSeq: number;
}

const fromItem = (item: RundownItem | undefined, templates: TemplateMap): Draft => {
  const template = item?.template ?? (templates.has("lower-third") ? "lower-third" : [...templates.keys()][0] ?? "");
  return {
    label: item?.label ?? "",
    template,
    layer: item?.layer ?? templates.get(template)?.layer ?? "",
    hotkey: item?.hotkey ?? "",
    data: { ...(item?.data ?? {}) },
  };
};

/**
 * 条目编辑器。
 * - 选中项变了 → 载入；同一项被别处修改且本地没有未保存的改动 → 刷新
 * - 「新建」模式下不跟随选中项
 */
export function Editor({ state, templates, send, mode, setMode, newSeq }: Props) {
  const selected = state.rundown.items.find((it) => it.id === state.rundown.selectedId);
  const [itemId, setItemId] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft>(() => fromItem(undefined, templates));
  const [liveUpdate, setLiveUpdate] = useState(true);
  const dirty = useRef(false);
  const loadedSig = useRef("");
  /**
   * 正在创建新条目：记下提交时已有的条目 id。服务端创建成功会选中新条目（id 不在集合里），
   * 这时才切到编辑模式载入；创建失败（如热键非法）则保留操作员填的内容，3 秒后放弃等待。
   */
  const pending = useRef<{ ids: Set<string>; timer: ReturnType<typeof setTimeout> } | null>(null);

  const load = (item: RundownItem | undefined) => {
    setItemId(item?.id);
    setDraft(fromItem(item, templates));
    dirty.current = false;
    loadedSig.current = JSON.stringify(item);
  };

  const selectedSig = JSON.stringify(selected);
  useEffect(() => {
    if (!templates.size) return;
    if (pending.current) {
      if (selected && !pending.current.ids.has(selected.id)) {
        clearTimeout(pending.current.timer);
        pending.current = null;
        setMode("edit");
        load(selected);
      }
      return;
    }
    if (mode === "new") return;
    if (selected?.id !== itemId || (!dirty.current && selectedSig !== loadedSig.current)) load(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSig, templates.size, mode]);

  useEffect(() => {
    if (newSeq > 0) load(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSeq]);

  const edit = (patch: Partial<Draft>) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  const meta = templates.get(draft.template);

  const save = (asNew: boolean) => {
    const item = {
      label: draft.label.trim() || "未命名",
      template: draft.template,
      layer: draft.layer.trim(),
      hotkey: draft.hotkey.trim().toLowerCase() || undefined,
      data: Object.fromEntries((meta?.fields ?? []).map((f) => [f.key, f.type === "number" ? Number(draft.data[f.key] ?? 0) : String(draft.data[f.key] ?? "")])),
    };
    const id = asNew ? undefined : itemId;
    send({ type: "rundown.upsert", item: { ...item, id } });
    // 在播 / 预备中的同一条目：只刷新数据，不重播入场
    if (id && liveUpdate) {
      const pgm = state.layers[item.layer];
      const pvw = state.preview[item.layer];
      if (pgm?.visible && pgm.itemId === id && pgm.template === item.template) send({ type: "graphic.update", layer: item.layer, data: item.data });
      if (pvw?.visible && pvw.itemId === id && pvw.template === item.template) send({ type: "graphic.update", layer: item.layer, data: item.data, channel: "pvw" });
    }
    if (id) {
      dirty.current = false;
      return;
    }
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      ids: new Set(state.rundown.items.map((it) => it.id)),
      timer: setTimeout(() => (pending.current = null), 3000),
    };
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save(false);
  };

  const existing = mode === "edit" && !!itemId;

  return (
    <section>
      <h2 id="editorTitle">{existing ? "编辑条目" : "新建条目"}</h2>
      <form id="editor" autoComplete="off" onSubmit={onSubmit}>
        <label className="field">名称
          <input name="label" required placeholder="例如 人名条 · 解说 1" value={draft.label} onChange={(e) => edit({ label: e.target.value })} />
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }}>模板
            <select
              name="template"
              required
              value={draft.template}
              onChange={(e) => edit({ template: e.target.value, layer: templates.get(e.target.value)?.layer ?? draft.layer, data: {} })}
            >
              {[...templates].map(([name, m]) => <option key={name} value={name}>{m.label}（{name}）</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: 1 }}>图层
            <input name="layer" required value={draft.layer} onChange={(e) => edit({ layer: e.target.value })} />
          </label>
          <label className="field" style={{ width: 64 }}>热键
            <input name="hotkey" maxLength={1} placeholder="—" style={{ textAlign: "center" }} value={draft.hotkey} onChange={(e) => edit({ hotkey: e.target.value })} />
          </label>
        </div>
        <div id="fields">
          {meta?.fields?.length ? (
            meta.fields.map((f) => (
              <label className="field" key={`${draft.template}:${f.key}`}>
                {f.label}
                {f.type === "textarea" ? (
                  <textarea data-field={f.key} placeholder={f.placeholder ?? ""} value={String(draft.data[f.key] ?? "")} onChange={(e) => edit({ data: { ...draft.data, [f.key]: e.target.value } })} />
                ) : (
                  <input
                    data-field={f.key}
                    type={f.type === "number" ? "number" : "text"}
                    placeholder={f.placeholder ?? ""}
                    value={String(draft.data[f.key] ?? "")}
                    onChange={(e) => edit({ data: { ...draft.data, [f.key]: e.target.value } })}
                  />
                )}
              </label>
            ))
          ) : (
            <p className="hint">此模板的数据来自比赛状态，无需填写字段。</p>
          )}
        </div>
        <label className="row" style={{ color: "var(--muted)", fontSize: 12 }}>
          <input type="checkbox" name="liveUpdate" checked={liveUpdate} onChange={(e) => setLiveUpdate(e.target.checked)} /> 保存时同步更新在播 / 预备中的画面（不重播入场）
        </label>
        <div className="row">
          <button type="submit" className="primary">保存</button>
          <button type="button" id="saveAsNew" disabled={!existing} onClick={() => save(true)}>另存为新条目</button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            id="deleteItem"
            className="danger"
            disabled={!existing}
            onClick={() => {
              const item = state.rundown.items.find((it) => it.id === itemId);
              if (item && confirm(`删除「${item.label}」？`)) send({ type: "rundown.remove", id: item.id });
            }}
          >删除</button>
        </div>
      </form>
    </section>
  );
}
