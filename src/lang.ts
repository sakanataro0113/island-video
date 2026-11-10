/** 動画の言語。台本は1つで、字幕と画面の文字だけを言語ごとに持つ(起きる出来事と映像は共通)。 */
export type Lang = "ja" | "en";
export const LANGS: { id: Lang; label: string }[] = [{ id: "ja", label: "日本語" }, { id: "en", label: "English" }];

const KEY = "island-lang";
export let lang: Lang = (() => { try { return localStorage.getItem(KEY) === "en" ? "en" : "ja"; } catch { return "ja"; } })();
const listeners: (() => void)[] = [];
export const onLangChange = (f: () => void) => listeners.push(f);
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* 覚えられなくても切り替えはできる */ }
  listeners.forEach(f => f());
}

/** 画面に焼き込む決まった文字。 */
export const words = (l: Lang = lang) => l === "en"
  ? { year: (n: number) => `Year ${n} on the island`, people: (n: number) => `${n} ${n === 1 ? "person" : "people"}`, narrator: "The Historian's Record" }
  : { year: (n: number) => `島に来て${n}年目`, people: (n: number) => `${n}人`, narrator: "歴史家の記録" };

/** 英字の文か(区切り方、表示時間、読み上げの文の作り方が変わる)。 */
export const isLatin = (text: string) => {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length, cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  return latin > cjk;
};
