import { lang, onLangChange, type Lang } from "./lang";

/** 字幕の見た目。映像タブの「字幕の見た目」で編集し、Cloudflare(D1)に言語ごとに保存する。書き出す MP4 にも同じ見た目が使われる。 */
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
  /** 英字をすべて大文字にする(英語版の参考動画の形) */
  caps: boolean;
};

/** 選べる書体。Google Fonts から読み込む(index.html)。 */
export const FONTS: { family: string; label: string; weights: number[] }[] = [
  { family: "Noto Sans JP", label: "Noto Sans JP(ゴシック)", weights: [700, 900] },
  { family: "Dela Gothic One", label: "Dela Gothic One(極太の見出し)", weights: [400] },
  { family: "M PLUS Rounded 1c", label: "M PLUS Rounded 1c(丸ゴシック)", weights: [800] },
  { family: "Anton", label: "Anton(英字の極太・縦長。日本語は Noto Sans JP で出る)", weights: [400] },
];

/**
 * 初期値: 参考動画の形。札なし、白い極太の文字に黒い縁取り、短く区切って次々に出す。強調の語は赤、影と弾む動きあり。
 * 話者名の札だけは、上の「島に来て○年目」の表示と同じく、デジタル庁デザインシステム(DADS)の作りにそろえる(render.ts)。
 */
export const DEFAULT_STYLE: SubtitleStyle = {
  mode: "chunk", font: "Noto Sans JP", weight: 900, size: .085, x: .5, y: .66, chunk: 9,
  color: "#ffffff", accent: "#ff4a3d", stroke: "#111111", strokeWidth: .2, shadow: true, pop: true,
  speaker: true, speakerTitle: "first", narratorLabel: false, boxOpacity: .7, emphasis: "color", lineHeight: 1.2, caps: false,
};
/** 英語版の初期値: 参考動画のとおり、太くて縦長の英字を大文字で、2〜3語ずつ出す。chunk は語数。 */
export const DEFAULT_STYLE_EN: SubtitleStyle = {
  ...DEFAULT_STYLE, font: "Anton", weight: 400, size: .1, chunk: 3, strokeWidth: .16, lineHeight: 1.1, caps: true,
};
export const defaultStyle = (l: Lang = lang) => l === "en" ? DEFAULT_STYLE_EN : DEFAULT_STYLE;

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: unknown, lo: number, hi: number, def: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
/** 形をそろえる。使えない値は初期値に戻す。 */
export function cleanStyle(s: any, l: Lang = lang): SubtitleStyle {
  const d = defaultStyle(l), font = FONTS.find(f => f.family === s?.font) ?? FONTS[0]!;
  return {
    mode: s?.mode === "box" ? "box" : "chunk",
    font: font.family,
    weight: font.weights.includes(s?.weight) ? s.weight : font.weights.includes(d.weight) ? d.weight : font.weights[font.weights.length - 1]!,
    size: clamp(s?.size, .03, .16, d.size), x: clamp(s?.x, .1, .9, d.x), y: clamp(s?.y, .1, .95, d.y),
    chunk: Math.round(clamp(s?.chunk, 1, 30, d.chunk)),
    color: HEX.test(s?.color) ? s.color : d.color, accent: HEX.test(s?.accent) ? s.accent : d.accent, stroke: HEX.test(s?.stroke) ? s.stroke : d.stroke,
    strokeWidth: clamp(s?.strokeWidth, 0, .4, d.strokeWidth),
    shadow: typeof s?.shadow === "boolean" ? s.shadow : d.shadow, pop: typeof s?.pop === "boolean" ? s.pop : d.pop,
    speaker: typeof s?.speaker === "boolean" ? s.speaker : d.speaker,
    speakerTitle: ["first", "always", "none"].includes(s?.speakerTitle) ? s.speakerTitle : d.speakerTitle, narratorLabel: typeof s?.narratorLabel === "boolean" ? s.narratorLabel : d.narratorLabel,
    boxOpacity: clamp(s?.boxOpacity, 0, 1, d.boxOpacity),
    emphasis: s?.emphasis === "color" ? "color" : s?.emphasis === "band" ? "band" : d.emphasis,
    lineHeight: clamp(s?.lineHeight, 1, 2, d.lineHeight),
    caps: typeof s?.caps === "boolean" ? s.caps : d.caps,
  };
}

/** いま使っている見た目(いまの言語のもの)。 */
export let style: SubtitleStyle = { ...defaultStyle() };
/** 言語ごとの、読み込んだ(または編集中の)見た目。 */
const byLang: Partial<Record<Lang, SubtitleStyle>> = {};
const listeners: (() => void)[] = [];
export const onStyleChange = (f: () => void) => listeners.push(f);
/** 見た目を差し替えて、プレビューを描き直す(保存はしない)。 */
export function setStyle(s: SubtitleStyle) { style = cleanStyle(s); byLang[lang] = style; listeners.forEach(f => f()); }
export const fontString = (px: number, s = style) => `${s.weight} ${px}px "${s.font}", "Noto Sans JP", sans-serif`;

const api = (l: Lang) => l === "en" ? "/api/subtitle?lang=en" : "/api/subtitle";
/** いまの言語の、保存済みの見た目を読み込む。なければ初期値のまま。 */
export async function loadStyle(): Promise<string> {
  const l = lang;
  try {
    const res = await fetch(api(l), { cache: "no-store" });
    if (!res.ok || !(res.headers.get("Content-Type") ?? "").includes("json")) return res.status === 404 ? "" : "字幕の見た目を読めませんでした。初期値を使っています。";
    const data = await res.json();
    if (data && l === lang) setStyle(data);
    return "";
  } catch { return "字幕の見た目を読めませんでした。初期値を使っています。"; }
}
export async function saveStyle(s: SubtitleStyle) {
  const res = await fetch(api(lang), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cleanStyle(s)) });
  if (res.status === 404) throw new Error("保存先(/api/subtitle)がありません。Cloudflare に公開したサイトで使ってください。");
  if (!res.ok) throw new Error(await res.text());
  setStyle(await res.json());
}
/** 言語を切り替えたら、その言語の見た目に替える。まだ読んでいなければ初期値にしてから読み込む。返り値は読み込みの結果(loadStyle と同じ)。 */
export function styleForLang(): Promise<string> {
  const known = byLang[lang];
  style = cleanStyle(known ?? defaultStyle()); listeners.forEach(f => f());
  return known ? Promise.resolve("") : loadStyle();
}
void onLangChange;
