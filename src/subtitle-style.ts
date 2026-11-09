/** 字幕の見た目。映像タブの「字幕の見た目」で編集し、Cloudflare(D1)に保存する。書き出す MP4 にも同じ見た目が使われる。 */
export type SubtitleStyle = {
  /** chunk: 短く区切って次々に出す(札なし)。box: 1カットの字幕をまとめて白い札に出す */
  mode: "chunk" | "box";
  font: string;
  weight: number;
  /** 文字の大きさ(画面の幅に対する割合) */
  size: number;
  /** 字幕の中心の位置(画面の幅・高さに対する割合) */
  x: number;
  y: number;
  /** 一度に出す文字数の目安(chunk のとき) */
  chunk: number;
  color: string;
  accent: string;
  stroke: string;
  /** 縁取りの太さ(文字の大きさに対する割合) */
  strokeWidth: number;
  shadow: boolean;
  /** 新しい区切りが出るとき、少し大きくしてから戻す */
  pop: boolean;
  /** セリフのとき、話者名を小さく出す */
  speaker: boolean;
  /** 話者名の下に所属と役職を出す。first はその話で最初のセリフだけ */
  speakerTitle: "first" | "always" | "none";
  /** 語りのとき、「歴史家の記録」の見出しを出す */
  narratorLabel: boolean;
  /** 札の白の濃さ(box のとき) */
  boxOpacity: number;
  /** [ ]の語の強調。band: 強調色の帯に白い文字(縁取りの上でも読める)。color: 文字の色だけ変える */
  emphasis: "band" | "color";
  /** 行の高さ(文字の大きさに対する倍率)。2行になったときに効く */
  lineHeight: number;
};

/** 選べる書体。Google Fonts から読み込む(index.html)。 */
export const FONTS: { family: string; label: string; weights: number[] }[] = [
  { family: "Noto Sans JP", label: "Noto Sans JP(ゴシック)", weights: [700, 900] },
  { family: "Dela Gothic One", label: "Dela Gothic One(極太の見出し)", weights: [400] },
  { family: "M PLUS Rounded 1c", label: "M PLUS Rounded 1c(丸ゴシック)", weights: [800] },
];

/**
 * 初期値: デジタル庁デザインシステム(DADS)の色と書体を土台に、参考動画の「短く区切って次々に出す」出し方を取り入れたもの。
 * - 書体は Noto Sans JP の B(700)。DADS の太さは N(400) と B(700) の2つだけ
 * - 色は DADS のデザイントークン(@digital-go-jp/design-tokens 2.1.0)の値: 白 #ffffff、Gray-900 #1a1a1a、Blue-900 #0017c1
 * - 強調は Blue-900 の帯に白い文字(コントラスト比 11.1:1)。青い文字に黒い縁では 1.57:1 で、DADS の 4.5:1 を満たさない
 * - 影と弾む動きは使わない。行の高さは DADS の見出し(Display)と同じ 140%
 * - 縁取りは DADS にない。映像の上で文字を読ませるための例外(白と縁の比は 17.4:1)
 */
export const DEFAULT_STYLE: SubtitleStyle = {
  mode: "chunk", font: "Noto Sans JP", weight: 700, size: .085, x: .5, y: .66, chunk: 9,
  color: "#ffffff", accent: "#0017c1", stroke: "#1a1a1a", strokeWidth: .16, shadow: false, pop: false,
  speaker: true, speakerTitle: "first", narratorLabel: false, boxOpacity: .7, emphasis: "band", lineHeight: 1.4,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: unknown, lo: number, hi: number, def: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
/** 形をそろえる。使えない値は初期値に戻す。 */
export function cleanStyle(s: any): SubtitleStyle {
  const d = DEFAULT_STYLE, font = FONTS.find(f => f.family === s?.font) ?? FONTS[0]!;
  return {
    mode: s?.mode === "box" ? "box" : "chunk",
    font: font.family,
    weight: font.weights.includes(s?.weight) ? s.weight : font.weights.includes(d.weight) ? d.weight : font.weights[font.weights.length - 1]!,
    size: clamp(s?.size, .03, .16, d.size), x: clamp(s?.x, .1, .9, d.x), y: clamp(s?.y, .1, .95, d.y),
    chunk: Math.round(clamp(s?.chunk, 3, 30, d.chunk)),
    color: HEX.test(s?.color) ? s.color : d.color, accent: HEX.test(s?.accent) ? s.accent : d.accent, stroke: HEX.test(s?.stroke) ? s.stroke : d.stroke,
    strokeWidth: clamp(s?.strokeWidth, 0, .4, d.strokeWidth),
    shadow: typeof s?.shadow === "boolean" ? s.shadow : d.shadow, pop: typeof s?.pop === "boolean" ? s.pop : d.pop,
    speaker: typeof s?.speaker === "boolean" ? s.speaker : d.speaker,
    speakerTitle: ["first", "always", "none"].includes(s?.speakerTitle) ? s.speakerTitle : d.speakerTitle, narratorLabel: typeof s?.narratorLabel === "boolean" ? s.narratorLabel : d.narratorLabel,
    boxOpacity: clamp(s?.boxOpacity, 0, 1, d.boxOpacity),
    emphasis: s?.emphasis === "color" ? "color" : s?.emphasis === "band" ? "band" : d.emphasis,
    lineHeight: clamp(s?.lineHeight, 1, 2, d.lineHeight),
  };
}

/** いま使っている見た目。 */
export let style: SubtitleStyle = { ...DEFAULT_STYLE };
const listeners: (() => void)[] = [];
export const onStyleChange = (f: () => void) => listeners.push(f);
/** 見た目を差し替えて、プレビューを描き直す(保存はしない)。 */
export function setStyle(s: SubtitleStyle) { style = cleanStyle(s); listeners.forEach(f => f()); }
export const fontString = (px: number, s = style) => `${s.weight} ${px}px "${s.font}", "Noto Sans JP", sans-serif`;

/** 保存済みの見た目を読み込む。なければ初期値のまま。 */
export async function loadStyle(): Promise<string> {
  try {
    const res = await fetch("/api/subtitle", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("Content-Type") ?? "").includes("json")) return res.status === 404 ? "" : "字幕の見た目を読めませんでした。初期値を使っています。";
    const data = await res.json();
    if (data) setStyle(data);
    return "";
  } catch { return "字幕の見た目を読めませんでした。初期値を使っています。"; }
}
export async function saveStyle(s: SubtitleStyle) {
  const res = await fetch("/api/subtitle", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cleanStyle(s)) });
  if (res.status === 404) throw new Error("保存先(/api/subtitle)がありません。Cloudflare に公開したサイトで使ってください。");
  if (!res.ok) throw new Error(await res.text());
  setStyle(await res.json());
}
