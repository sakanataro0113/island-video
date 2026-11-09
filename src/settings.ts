import { cleanSettings, defaults, setSettings, settings, type Settings } from "./voice";

/** 保存先の状態。"saved" は Cloudflare に保存済みの設定を使用中、"default" は voices.yaml の初期値を使用中。 */
export type Source = "saved" | "default" | "unavailable";
export let source: Source = "default";
export let sourceNote = "";
const listeners: (() => void)[] = [];
/** 設定が変わったとき(読み込み、保存)に呼ぶ。 */
export const onSettingsChange = (f: () => void) => listeners.push(f);
const changed = () => listeners.forEach(f => f());

/** Cloudflare から設定を読み込む。読めなければ voices.yaml の初期値のまま。 */
export async function loadSettings() {
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (res.status === 404) { source = "unavailable"; sourceNote = "設定の保存先(/api/settings)がありません。Cloudflare に公開したサイトで使ってください。いまは voices.yaml の初期値を使っています。"; return; }
    if (!res.ok) { source = "unavailable"; sourceNote = (await res.text()) + "\nいまは voices.yaml の初期値を使っています。"; return; }
    if (!(res.headers.get("Content-Type") ?? "").includes("json")) { source = "unavailable"; sourceNote = "設定を読めませんでした。ログインが切れている可能性があります。ページを再読み込みしてください。"; return; }
    const data = await res.json();
    if (data) { const errors: string[] = []; setSettings(cleanSettings(data, errors)); source = "saved"; sourceNote = errors.length ? "保存された設定の一部を使えませんでした:\n" + errors.join("\n") : ""; }
    else { source = "default"; sourceNote = ""; }
  } catch (e) {
    source = "unavailable"; sourceNote = "設定を読めませんでした: " + (e as Error).message;
  } finally { changed(); }
}

/**
 * 設定を Cloudflare に保存し、すぐ使う。問題があれば例外。
 * 送るのは、いま使っている設定から変わった人物と文だけ。別の PC で同時に変えたほかの行は消さない。
 */
export async function saveSettings(next: Settings) {
  const errors: string[] = [], clean = cleanSettings(next, errors);
  if (errors.length) throw new Error(errors.join("\n"));
  // まだ一度も保存していなければ、全部を送る
  const base: Settings = source === "saved" ? settings : { narrator: clean.narrator, characters: {}, spots: {} };
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const characters: Record<string, unknown> = {}, spots: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(base.characters), ...Object.keys(clean.characters)])) if (!eq(base.characters[k], clean.characters[k])) characters[k] = clean.characters[k] ?? null;
  for (const k of new Set([...Object.keys(base.spots), ...Object.keys(clean.spots)])) if (!eq(base.spots[k], clean.spots[k])) spots[k] = clean.spots[k] ?? null;
  const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrator: clean.narrator, characters, spots }) });
  if (res.status === 404) throw new Error("設定の保存先(/api/settings)がありません。Cloudflare に公開したサイトで使ってください。");
  if (!res.ok) throw new Error(await res.text());
  // 返ってくるのは保存後の全体(別の PC で変えた行も含む)
  setSettings(cleanSettings(await res.json())); source = "saved"; sourceNote = ""; changed();
}

/** 編集用の複製。 */
export const draftOf = (s: Settings = settings): Settings => JSON.parse(JSON.stringify(s));
export const same = (a: Settings, b: Settings) => JSON.stringify(cleanSettings(a)) === JSON.stringify(cleanSettings(b));
export { defaults };
