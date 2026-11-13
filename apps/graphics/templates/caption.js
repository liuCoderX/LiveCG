// 实时字幕：画面底部居中的一到两行字幕，在播时改文字只做淡入替换、不重播入场
// data = { text, speaker? }
import { animate } from "../lib/util.js";

export default {
  meta: {
    label: "实时字幕",
    layer: "caption",
    z: 60,
    fields: [
      { key: "speaker", label: "说话人（可选）", type: "text", placeholder: "解说" },
      { key: "text", label: "字幕内容", type: "textarea", placeholder: "输入字幕，保存即更新在播画面" },
    ],
  },

  css: `
    .cap { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); max-width: 1500px; text-align: center; }
    .cap-box { display: -webkit-inline-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      padding: 10px 28px; background: rgba(0,0,0,.72); color: #fff; font-size: 40px; line-height: 1.35; font-weight: 600;
      white-space: pre-wrap; overflow-wrap: anywhere; }
    .cap-box[hidden], .cap-speaker[hidden] { display: none; }
    .cap-speaker { color: #ffd166; margin-right: .5em; }
  `,

  in: (el) => animate(el.querySelector(".cap"), [{ opacity: 0, transform: "translate(-50%, 16px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 260 }),
  out: (el) => animate(el.querySelector(".cap"), [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),

  render(el, { data }) {
    if (!el.firstChild) el.innerHTML = `<div class="cap"><div class="cap-box"><span class="cap-speaker"></span><span class="cap-text"></span></div></div>`;
    const text = String(data.text ?? "");
    const speaker = String(data.speaker ?? "");
    const box = el.querySelector(".cap-box");
    const t = el.querySelector(".cap-text");
    const sp = el.querySelector(".cap-speaker");
    if (t.textContent === text && sp.textContent === speaker) return;
    t.textContent = text;
    sp.textContent = speaker;
    sp.hidden = !speaker;
    box.hidden = !text && !speaker;
    // 文字变化：轻微淡入，提示观众已换句
    animate(box, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 180 });
  },
};
