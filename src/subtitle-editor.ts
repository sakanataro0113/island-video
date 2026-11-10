import { lang } from "./lang";
import { defaultStyle, FONTS, cleanStyle, onStyleChange, saveStyle, setStyle, style, type SubtitleStyle } from "./subtitle-style";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag); const { class: c, ...rest } = props as any;
  if (c) e.className = c; Object.assign(e, rest); e.append(...kids); return e;
};
const same = (a: SubtitleStyle, b: SubtitleStyle) => JSON.stringify(a) === JSON.stringify(b);

type Field =
  | { key: keyof SubtitleStyle; label: string; kind: "range"; min: number; max: number; step: number; show: (v: number) => string; only?: "chunk" | "box" }
  | { key: keyof SubtitleStyle; label: string; kind: "color"; only?: "chunk" | "box" }
  | { key: keyof SubtitleStyle; label: string; kind: "check"; only?: "chunk" | "box" };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const FIELDS: Field[] = [
  { key: "size", label: "文字の大きさ", kind: "range", min: .03, max: .16, step: .002, show: v => `画面の幅の${(v * 100).toFixed(1)}%` },
  { key: "y", label: "上下の位置", kind: "range", min: .1, max: .95, step: .005, show: v => `上から${pct(v)}` },
  { key: "x", label: "左右の位置", kind: "range", min: .1, max: .9, step: .005, show: v => `左から${pct(v)}` },
  { key: "chunk", label: "一度に出す文字数(英語は語数)", kind: "range", min: 1, max: 30, step: 1, show: v => lang === "en" ? `${v}語まで(英語)` : `${v}字まで`, only: "chunk" },
  { key: "color", label: "文字の色", kind: "color" },
  { key: "accent", label: "強調の色([ ]の語)", kind: "color" },
  { key: "lineHeight", label: "行の高さ(2行のとき)", kind: "range", min: 1, max: 2, step: .05, show: v => `文字の${pct(v)}`, only: "chunk" },
  { key: "stroke", label: "縁の色", kind: "color", only: "chunk" },
  { key: "strokeWidth", label: "縁の太さ", kind: "range", min: 0, max: .4, step: .01, show: v => v ? `文字の${pct(v)}` : "なし", only: "chunk" },
  { key: "boxOpacity", label: "札の白の濃さ", kind: "range", min: 0, max: 1, step: .05, show: pct, only: "box" },
  { key: "shadow", label: "影を付ける", kind: "check", only: "chunk" },
  { key: "pop", label: "出るときに弾ませる", kind: "check", only: "chunk" },
  { key: "caps", label: "英字を大文字にする", kind: "check", only: "chunk" },
  { key: "speaker", label: "セリフに話者名を出す", kind: "check" },
  { key: "narratorLabel", label: "語りに「歴史家の記録」を出す", kind: "check" },
];

/** 映像タブの「字幕の見た目」。変えるとすぐプレビューに出る。保存すると D1 に書く。プレビューの字幕はドラッグで動かせる。 */
export class SubtitleEditor {
  private saved: SubtitleStyle = { ...style };
  private note = "";
  private error = false;
  constructor(private frame: HTMLElement, private stopPlayback: () => void) {
    const root = $("sub-editor");
    root.addEventListener("toggle", () => this.frame.classList.toggle("dragging-subtitle", (root as HTMLDetailsElement).open));
    this.build();
    onStyleChange(() => this.sync());
    this.enableDrag();
    window.addEventListener("beforeunload", e => { if (!same(style, this.saved)) e.preventDefault(); });
  }
  /** 保存済みの見た目を読み込んだあとに呼ぶ。 */
  loaded(note: string) { this.saved = { ...style }; this.note = note; this.error = !!note; this.sync(); }
  private set(patch: Partial<SubtitleStyle>) { this.note = ""; this.error = false; setStyle(cleanStyle({ ...style, ...patch })); }
  private build() {
    const body = $("sub-fields"); body.replaceChildren();
    const mode = el("select", { id: "sub-mode" });
    mode.append(el("option", { value: "chunk", textContent: "短く区切って次々に出す(札なし)" }), el("option", { value: "box", textContent: "1カット分を白い札にまとめる" }));
    mode.onchange = () => this.set({ mode: mode.value as SubtitleStyle["mode"] });
    const font = el("select", { id: "sub-font" });
    for (const f of FONTS) for (const w of f.weights) font.append(el("option", { value: `${f.family}|${w}`, textContent: f.weights.length > 1 ? `${f.label} ${w === 900 ? "極太" : "太字(DADS の B)"}` : f.label }));
    font.onchange = () => { const [family, w] = font.value.split("|"); this.set({ font: family, weight: Number(w) }); };
    const title = el("select", { id: "sub-speakerTitle" });
    title.append(el("option", { value: "first", textContent: "その話の最初のセリフだけ" }), el("option", { value: "always", textContent: "毎回" }), el("option", { value: "none", textContent: "出さない" }));
    title.onchange = () => this.set({ speakerTitle: title.value as SubtitleStyle["speakerTitle"] });
    const emph = el("select", { id: "sub-emphasis" });
    emph.append(el("option", { value: "band", textContent: "強調色の帯に白い文字" }), el("option", { value: "color", textContent: "文字の色だけ変える" }));
    emph.onchange = () => this.set({ emphasis: emph.value as SubtitleStyle["emphasis"] });
    body.append(this.row("表示の形", mode), this.row("書体", font), this.row("話者名の下に所属と役職", title), this.row("[ ]の語の強調", emph, undefined, "chunk"));
    for (const f of FIELDS) {
      const id = "sub-" + f.key;
      let input: HTMLInputElement;
      if (f.kind === "range") {
        input = el("input", { id, type: "range", min: String(f.min), max: String(f.max), step: String(f.step) });
        const out = el("output", { id: id + "-out" }); out.setAttribute("for", id);
        input.oninput = () => this.set({ [f.key]: Number(input.value) } as Partial<SubtitleStyle>);
        body.append(this.row(f.label, input, out, f.only));
      } else if (f.kind === "color") {
        input = el("input", { id, type: "color" });
        input.oninput = () => this.set({ [f.key]: input.value } as Partial<SubtitleStyle>);
        body.append(this.row(f.label, input, undefined, f.only));
      } else {
        input = el("input", { id, type: "checkbox" });
        input.onchange = () => this.set({ [f.key]: input.checked } as Partial<SubtitleStyle>);
        body.append(el("label", { class: "sub-check", htmlFor: id }, input, f.label));
        if (f.only) body.lastElementChild!.setAttribute("data-only", f.only);
      }
    }
    $("sub-save").onclick = async () => {
      this.note = "保存しています…"; this.error = false; this.sync();
      try { await saveStyle(style); this.saved = { ...style }; this.note = "保存しました。書き出す MP4 にも、この見た目が使われます。"; }
      catch (e) { this.note = "保存できませんでした: " + (e as Error).message; this.error = true; }
      this.sync();
    };
    $("sub-revert").onclick = () => { this.note = ""; setStyle(this.saved); };
    $("sub-default").onclick = () => { this.note = "初期値にしました。よければ保存してください。"; setStyle(defaultStyle()); };
    this.sync();
  }
  private row(label: string, input: HTMLElement, out?: HTMLElement, only?: string) {
    const r = el("div", { class: "sub-row" }, el("label", { class: "lab", htmlFor: input.id, textContent: label }), input, ...(out ? [out] : []));
    if (only) r.dataset.only = only;
    return r;
  }
  /** 入力欄と保存の状態を、いまの見た目に合わせる。 */
  private sync() {
    $<HTMLSelectElement>("sub-mode").value = style.mode;
    $<HTMLSelectElement>("sub-font").value = `${style.font}|${style.weight}`;
    $<HTMLSelectElement>("sub-speakerTitle").value = style.speakerTitle;
    $<HTMLSelectElement>("sub-emphasis").value = style.emphasis;
    for (const f of FIELDS) {
      const input = $<HTMLInputElement>("sub-" + f.key), v = style[f.key];
      if (f.kind === "check") input.checked = !!v;
      else if (document.activeElement !== input) input.value = String(v);
      if (f.kind === "range") $("sub-" + f.key + "-out").textContent = f.show(v as number);
    }
    for (const n of $("sub-fields").querySelectorAll<HTMLElement>("[data-only]")) n.hidden = n.dataset.only !== style.mode;
    const dirty = !same(style, this.saved), state = $("sub-state");
    state.textContent = this.note || (dirty ? "保存していない変更があります。" : "保存済みの見た目です。");
    state.classList.toggle("error", this.error);
    $<HTMLButtonElement>("sub-save").disabled = !dirty;
    $("sub-revert").hidden = !dirty;
  }
  /** 編集欄を開いている間、プレビューの上でドラッグすると字幕の位置が動く。 */
  private enableDrag() {
    let dragging = false;
    const move = (e: PointerEvent) => {
      const r = this.frame.getBoundingClientRect();
      this.set({ x: Math.min(.9, Math.max(.1, (e.clientX - r.left) / r.width)), y: Math.min(.95, Math.max(.1, (e.clientY - r.top) / r.height)) });
    };
    this.frame.addEventListener("pointerdown", e => {
      if (!($("sub-editor") as HTMLDetailsElement).open) return;
      dragging = true; this.stopPlayback(); this.frame.setPointerCapture(e.pointerId); move(e);
    });
    this.frame.addEventListener("pointermove", e => { if (dragging) move(e); });
    this.frame.addEventListener("pointerup", () => { dragging = false; });
  }
}
