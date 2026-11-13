import { useEffect, useState, type FormEvent } from "react";
import type { AppState, ClientMessage, ThemeConfig, ThemePreset } from "@livecg/shared";
import { api } from "../lib/api.ts";
import { useDraft } from "../lib/hooks.ts";

type Send = (m: ClientMessage) => void;

/** 可覆盖的主题变量；模板只认这些变量（docs/TEMPLATES.md） */
const VARS: Array<[string, string, "color" | "font" | "text"]> = [
  ["--lcg-accent", "强调色（人名条底色等）", "color"],
  ["--lcg-on-accent", "强调色上的文字", "color"],
  ["--lcg-panel", "面板背景", "color"],
  ["--lcg-panel-strong", "深色块（时钟、节次）", "color"],
  ["--lcg-panel-sub", "副条背景（副标题、字幕）", "color"],
  ["--lcg-text", "文字", "color"],
  ["--lcg-muted", "次要文字", "color"],
  ["--lcg-highlight", "高亮（进攻时钟、MVP、暂停）", "color"],
  ["--lcg-danger", "警示（炸弹、犯规满、红牌）", "color"],
  ["--lcg-positive", "正向（资金）", "color"],
  ["--lcg-ct", "CS2 · CT 方", "color"],
  ["--lcg-t", "CS2 · T 方", "color"],
  ["--lcg-font", "字体（播出机上必须已安装）", "font"],
  ["--lcg-radius", "圆角，如 4px", "text"],
  ["--lcg-shadow", "阴影，如 0 8px 24px rgba(0,0,0,.4)", "text"],
];
const FONTS = ['"HarmonyOS Sans SC"', '"Noto Sans SC"', '"Source Han Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "system-ui"];
const isHex = (v?: string) => !!v && /^#[0-9a-fA-F]{6}$/.test(v.trim());
/**
 * 色块预览只接受「明显是颜色」的值：十六进制、rgb()/hsl() 里只有数字、颜色名。
 * 操作员输入的任意文本（如 url(...)）不能直接写进 style，否则控制台自己就会去请求外部地址。
 */
const safeColor = (v?: string) =>
  v && /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d.,%\s/]+\)|[a-z]{3,20})$/i.test(v.trim()) ? v.trim() : "transparent";

/** 外观：选择主题预设，再按需覆盖单个变量；应用后本房间所有输出即时生效 */
export function AppearanceTab({ state, send, hidden }: { state: AppState; send: Send; hidden: boolean }) {
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [draft, setDraft, commit] = useDraft<ThemeConfig>(state.config.theme);
  useEffect(() => {
    api<ThemePreset[]>("/api/themes").then(setPresets).catch(() => {});
  }, []);
  const preset = presets.find((p) => p.id === draft.preset);
  const setVar = (k: string, v: string) => {
    const overrides = { ...draft.overrides };
    if (v) overrides[k] = v;
    else delete overrides[k];
    setDraft({ ...draft, overrides });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({ type: "theme.set", theme: draft });
    commit();
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.config.theme);

  return (
    <div className="tabpanel" data-panel="appearance" hidden={hidden}>
      <section>
        <h2>外观</h2>
        <form id="themeForm" onSubmit={submit} autoComplete="off">
          <div className="row">
            <label htmlFor="themePreset">主题</label>
            <select id="themePreset" name="preset" style={{ flex: 1 }} value={draft.preset} onChange={(e) => setDraft({ ...draft, preset: e.target.value })}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              {!preset && <option value={draft.preset}>{draft.preset}（未找到）</option>}
            </select>
          </div>
          {preset?.description && <p className="hint" style={{ marginTop: 0 }}>{preset.description}</p>}
          <table className="theme-vars">
            <tbody>
              {VARS.map(([k, label, kind]) => {
                const override = draft.overrides[k] ?? "";
                const base = preset?.vars[k];
                const effective = override || base;
                return (
                  <tr key={k} className={override ? "overridden" : ""}>
                    <th>{label}</th>
                    <td className="swatch-cell">
                      {kind === "color" && (
                        // 色块显示真实颜色（含半透明 rgba），透明的取色器盖在上面，点击即可取色
                        <label className="swatch" title={effective ?? "模板默认"}>
                          <span style={{ background: safeColor(effective) }} />
                          <input
                            type="color"
                            aria-label={`${label} 取色`}
                            value={isHex(effective) ? effective!.trim() : "#000000"}
                            onChange={(e) => setVar(k, e.target.value)}
                          />
                        </label>
                      )}
                    </td>
                    <td>
                      <input
                        data-var={k}
                        aria-label={label}
                        list={kind === "font" ? "themeFonts" : undefined}
                        placeholder={base ?? "模板默认"}
                        value={override}
                        onChange={(e) => setVar(k, e.target.value)}
                      />
                    </td>
                    <td>{override && <button type="button" className="sm" title="清除覆盖，恢复主题值" onClick={() => setVar(k, "")}>×</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="themeFonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="submit" className="primary" disabled={!dirty}>应用到本房间</button>
            <button type="button" id="clearOverrides" disabled={!Object.keys(draft.overrides).length} onClick={() => setDraft({ ...draft, overrides: {} })}>清除全部覆盖</button>
            {dirty && <span className="hint" style={{ margin: 0 }}>有未应用的修改</span>}
          </div>
        </form>
        <p className="hint">应用后本房间的 PGM / PVW 输出立即换皮（含 CasparCG、OBS 上正在运行的页面），不重播入场。新主题包放在 <code>apps/graphics/themes/</code>，见 docs/TEMPLATES.md。</p>
      </section>
    </div>
  );
}
