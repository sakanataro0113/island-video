import yaml from "js-yaml";
import raw from "../voices.yaml?raw";

/** 音声の頭に置く間と、読み終えてから次のカットまでの間(秒)。 */
export const VOICE_LEAD = 0.3, VOICE_TAIL = 0.5, SAMPLE_RATE = 48000;
export const VOICE_NAME = /^(?:[A-Za-z]+|voice_[A-Za-z0-9_-]+)$/;
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];

/** 用意されている声(Gemini と Chirp 3: HD で共通の名前)。性別と特徴は目安。 */
export const VOICE_LIST: { name: string; gender: "男性" | "女性"; feel: string }[] = [
  ["Alnilam", "男性", "きっぱり"], ["Charon", "男性", "解説向き"], ["Orus", "男性", "きっぱり"], ["Algenib", "男性", "しゃがれ声"],
  ["Schedar", "男性", "落ち着いた"], ["Sadaltager", "男性", "物知り"], ["Rasalgethi", "男性", "解説向き"], ["Iapetus", "男性", "はっきり"],
  ["Algieba", "男性", "なめらか"], ["Enceladus", "男性", "息まじり"], ["Umbriel", "男性", "おおらか"], ["Achird", "男性", "親しみやすい"],
  ["Zubenelgenubi", "男性", "くだけた"], ["Sadachbia", "男性", "生き生き"], ["Puck", "男性", "元気"], ["Fenrir", "男性", "興奮気味"],
  ["Gacrux", "女性", "大人びた"], ["Kore", "女性", "きっぱり"], ["Sulafat", "女性", "温かい"], ["Vindemiatrix", "女性", "穏やか"],
  ["Achernar", "女性", "やわらか"], ["Despina", "女性", "なめらか"], ["Erinome", "女性", "はっきり"], ["Callirrhoe", "女性", "おおらか"],
  ["Aoede", "女性", "軽やか"], ["Pulcherrima", "女性", "前向き"], ["Zephyr", "女性", "明るい"], ["Autonoe", "女性", "明るい"],
  ["Laomedeia", "女性", "元気"], ["Leda", "女性", "若々しい"],
].map(([name, gender, feel]) => ({ name: name!, gender: gender as "男性" | "女性", feel: feel! }));

/** 声の割り当てと読み方。画面で編集し、Cloudflare に保存する。保存がなければ voices.yaml の値を使う。 */
export type Entry = { voice: string; style: string };
/** 1つの文の中の、読みを変えた箇所。start と length は文字単位(字幕の飾りを除いた文の中の位置)。 */
export type Spot = { start: number; length: number; to: string };
/** spots は、字幕の飾りを除いた文ごとの、読みを変えた箇所。同じ漢字でも、ほかの文や箇所は変わらない。 */
export type Settings = { narrator: Entry; characters: Record<string, Entry>; spots: Record<string, Spot[]> };

type Engine = { engine: "gemini" | "chirp"; model: string; temperature?: number; rate: number; rpm: number };
export const voiceErrors: string[] = [];
const file: any = (() => { try { return yaml.load(raw) ?? {}; } catch (e) { voiceErrors.push("voices.yaml を読めません: " + (e as Error).message); return {}; } })();

/** 1分あたりに頼む回数。Chirp は上限がゆるいので気にしない。 */
const engine_rpm = (name: string, rpm: number) => name === "chirp" ? 600 : rpm >= 1 && rpm <= 1000 ? rpm : 8;
export const engine: Engine = (() => {
  const name = file.engine === "chirp" ? "chirp" : "gemini";
  if (file.engine !== "gemini" && file.engine !== "chirp") voiceErrors.push(`voices.yaml の engine「${file.engine}」は gemini か chirp にしてください。`);
  const model = String(file.gemini?.model ?? MODELS[0]);
  if (!MODELS.includes(model)) voiceErrors.push(`voices.yaml の gemini.model「${model}」は ${MODELS.join(" か ")} にしてください。`);
  const t = file.gemini?.temperature == null ? undefined : Number(file.gemini.temperature);
  if (t !== undefined && !(t >= 0 && t <= 2)) voiceErrors.push("voices.yaml の gemini.temperature は 0〜2 にしてください。");
  const rate = Number(file.chirp?.rate ?? 1);
  if (!(rate >= .25 && rate <= 2)) voiceErrors.push("voices.yaml の chirp.rate は 0.25〜2 にしてください。");
  const rpm = Number(file.gemini?.rpm ?? 8);
  if (!(rpm >= 1 && rpm <= 1000)) voiceErrors.push("voices.yaml の gemini.rpm は 1〜1000 にしてください。");
  return { rpm: engine_rpm(name, rpm), engine: name, model: MODELS.includes(model) ? model : MODELS[0]!, temperature: t !== undefined && t >= 0 && t <= 2 ? t : undefined, rate: rate >= .25 && rate <= 2 ? rate : 1 };
})();

const entryOf = (v: any): Entry => typeof v === "string" ? { voice: v, style: "" } : { voice: String(v?.voice ?? ""), style: String(v?.style ?? "") };
/** voices.yaml に書いた初期値。 */
export const defaults: Settings = cleanSettings({
  narrator: entryOf(file.narrator),
  characters: Object.fromEntries(Object.entries(file.characters ?? {}).map(([k, v]) => [k, entryOf(v)])),
  spots: file.spots ?? {},
}, voiceErrors);

/** 形をそろえ、使えない値を取り除く。問題があれば errors に書く。 */
export function cleanSettings(s: any, errors: string[] = []): Settings {
  const entry = (e: any, who: string): Entry | undefined => {
    const voice = String(e?.voice ?? "").trim(), style = [...String(e?.style ?? "").trim()].slice(0, 300).join("");
    if (!voice) return undefined;
    if (!VOICE_NAME.test(voice)) { errors.push(`${who}の声「${voice}」は Alnilam のような名前か、voice_… の ID にしてください。`); return undefined; }
    return { voice, style };
  };
  const characters: Record<string, Entry> = {};
  for (const [k, v] of Object.entries(s?.characters ?? {})) { const e = entry(v, k); if (e) characters[k] = e; }
  const spots: Record<string, Spot[]> = {};
  for (const [line, list] of Object.entries(s?.spots ?? {})) {
    const chars = [...line], out: Spot[] = [];
    if (!chars.length || chars.length > 300 || !Array.isArray(list)) continue;
    for (const x of [...list].sort((a: any, b: any) => Number(a?.start) - Number(b?.start))) {
      const start = Number(x?.start), length = Number(x?.length), to = [...String(x?.to ?? "").trim()].slice(0, 50).join("");
      const prev = out[out.length - 1];
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1 || length > 50 || start + length > chars.length || !to) continue;
      if (prev && prev.start + prev.length > start) continue; // 重なる箇所は前を優先
      out.push({ start, length, to });
    }
    if (out.length) spots[line] = out;
  }
  return { narrator: entry(s?.narrator, "語り") ?? { voice: "Alnilam", style: "Narration" }, characters, spots };
}

/** いま使っている設定。setSettings で差し替える。 */
export let settings: Settings = defaults;
export function setSettings(s: Settings) { settings = s; }
/** 文の中の、読みを変えた箇所を置き換える。spots を渡すと、保存前の設定で試せる。 */
export function applySpots(text: string, spots = settings.spots) {
  const list = spots[text]; if (!list?.length) return text;
  const chars = [...text]; let out = "", at = 0;
  for (const p of [...list].sort((a, b) => a.start - b.start)) {
    if (p.start < at || p.start + p.length > chars.length) continue;
    out += chars.slice(at, p.start).join("") + p.to; at = p.start + p.length;
  }
  return out + chars.slice(at).join("");
}
/** 台本の字幕の文から、字幕の飾りを取る。強調の[ ]、セリフの「」、改行を取る。 */
export const plainText = (narration: string) => narration.replace(/[\[\]「」]/g, "").replace(/~/g, " ").replace(/([\x21-\x7e])\s*\n\s*(?=[\x21-\x7e])/g, "$1 ").replace(/\s*\n\s*/g, "").trim(); // 英字どうしの改行は空白にする
/** 字幕の文から、実際に読ませる文を作る。 */
export const speechText = (narration: string) => applySpots(plainText(narration));

/** 窓口(/api/tts)に渡す設定。本文以外の部分。 */
type Params = Record<string, string>;
export type Voice = { params: Params; text: string };
export function paramsOf(e: Entry, lang: "ja" | "en" = "ja"): Params | undefined {
  if (engine.engine === "chirp") {
    // 以前と同じ並びにして、保存済みの Chirp の音声をそのまま使えるようにする。英語版は en-US の声
    const region = lang === "en" ? "en-US" : "ja-JP";
    const name = /^[a-z]{2}-[A-Z]{2}-/.test(e.voice) ? e.voice.replace(/^[a-z]{2}-[A-Z]{2}-/, region + "-") : /^[A-Za-z]+$/.test(e.voice) ? `${region}-Chirp3-HD-${e.voice}` : "";
    return name ? { voice: name, rate: String(engine.rate) } : undefined;
  }
  return { engine: "gemini", model: engine.model, style: e.style, ...(engine.temperature !== undefined ? { temperature: String(engine.temperature) } : {}), voice: e.voice };
}
/** カットを誰の声で読むか。読まないカットは undefined。 */
export function voiceOf(narration: string, speaker?: string, lang: "ja" | "en" = "ja"): Voice | undefined {
  const text = speechText(narration);
  const e = speaker ? settings.characters[speaker] : settings.narrator, params = e && paramsOf(e, lang);
  return text && params ? { params, text } : undefined;
}
const urlOf = (v: Voice) => `/api/tts?${new URLSearchParams({ ...v.params, text: v.text })}`;
export const voiceKey = urlOf;

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
export const audioOf = (v: Voice | undefined) => v && buffers.get(voiceKey(v));
export const lengthOf = (v: Voice) => buffers.get(voiceKey(v))?.duration;

/** 依頼の間を空けて、1分あたり engine.rpm 回を超えないようにする(voices.yaml の gemini.rpm)。 */
let nextSlot = 0;
async function slot() {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + 60000 / engine.rpm;
  if (at > Date.now()) await new Promise(r => setTimeout(r, at - Date.now()));
}
async function fetchAudio(v: Voice): Promise<AudioBuffer> {
  const url = urlOf(v);
  let bytes: ArrayBuffer | null = null;
  let store: Cache | null = null;
  try { store = await caches.open("tts-v1"); bytes = await (await store.match(url))?.arrayBuffer() ?? null; } catch { store = null; }
  if (!bytes) {
    await slot();
    let res = await fetch(url);
    // 1分あたりの上限なら、言われた秒数だけ待って8回までやり直す(1日の上限なら待たずに止める)
    for (let tries = 0; res.status === 429 && res.headers.get("X-Quota") === "minute" && tries < 8; tries++) {
      const wait = Number(res.headers.get("Retry-After") ?? 30) * 1000;
      nextSlot = Math.max(nextSlot, Date.now() + wait); // ほかの依頼も一緒に待たせる
      await slot();
      res = await fetch(url);
    }
    if (!res.ok) throw new Error(res.status === 404 ? "音声の窓口(/api/tts)が見つかりません。Cloudflareに公開したサイトで使ってください。" : await res.text());
    if (!(res.headers.get("Content-Type") ?? "").startsWith("audio/")) throw new Error("音声ではない応答が返りました。ログインが切れている可能性があります。ページを再読み込みしてください。");
    const type = res.headers.get("Content-Type") ?? "audio/mpeg";
    bytes = await res.arrayBuffer();
    const buf = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes.slice(0));
    checkSpeech(buf, v.text); // 無音などの失敗作は保存しない
    try { await store?.put(url, new Response(bytes, { headers: { "Content-Type": type } })); } catch { /* 保存できなくても再生はできる */ }
    return buf;
  }
  return await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
}

/**
 * 声がほとんど入っていない音声や、後ろに長い無音が付いた音声を弾く。
 * Gemini の音声合成は、まれにこうした音声を「成功」として返すことがある(料金はかかる)。
 * 読み上げを1秒7字前後(英語は14字)として、声の入っている長さが目安の3割に満たないか、全体が目安の3倍+2秒を超えたら失敗とする。
 */
export function checkSpeech(buf: AudioBuffer, text: string) {
  const data = buf.getChannelData(0), win = Math.max(1, Math.round(buf.sampleRate * .02));
  let voiced = 0;
  for (let i = 0; i < data.length; i += win) {
    let sum = 0; const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) sum += data[j]! * data[j]!;
    if (Math.sqrt(sum / (end - i)) > .01) voiced++;
  }
  // 目安の速さ: 日本語は1秒7字、英語は1秒14字
  const latin = (text.match(/[A-Za-z]/g) ?? []).length > [...text].length / 2;
  const spoken = voiced * win / buf.sampleRate, expected = [...text].length / (latin ? 14 : 7);
  if (spoken < Math.max(.2, expected * .3)) throw new Error(`「${text.slice(0, 20)}…」の音声に、声がほとんど入っていませんでした(${spoken.toFixed(1)}秒)。もう一度読み込むと作り直します。続く場合は voices.yaml の temperature を上げるか消してください。`);
  if (buf.duration > expected * 3 + 2) throw new Error(`「${text.slice(0, 20)}…」の音声が長すぎます(${buf.duration.toFixed(1)}秒、声は${spoken.toFixed(1)}秒)。もう一度読み込むと作り直します。`);
}

/** 進み具合。working は、いま作っている文。 */
export type Progress = { done: number; total: number; working: string[] };
/** 足りない音声をまとめて用意する。1つでも失敗したら、最初の理由で止める。 */
export async function prepareVoices(list: Voice[], onProgress: (p: Progress) => void) {
  const need = [...new Map(list.filter(v => !buffers.has(voiceKey(v))).map(v => [voiceKey(v), v])).values()];
  let done = 0, failed = false;
  const working = new Set<string>();
  const tell = () => { if (!failed) onProgress({ done, total: need.length, working: [...working] }); };
  const one = async (v: Voice) => {
    const key = voiceKey(v);
    working.add(v.text); tell();
    if (!pending.has(key)) pending.set(key, fetchAudio(v).then(b => { buffers.set(key, b); return b; }).finally(() => pending.delete(key)));
    try { await pending.get(key); } catch (e) { failed = true; throw e; } finally { working.delete(v.text); }
    done++; tell();
  };
  const queue = [...need];
  if (need.length) tell();
  // 1つ失敗したら、残りは頼まない(料金の無駄を防ぐ)
  // 同時に頼むのは2つまで(1分あたりの上限に当たりにくくする)
  await Promise.all(Array.from({ length: 2 }, async () => { while (queue.length && !failed) await one(queue.shift()!); }));
  return need.length;
}
/** 1つだけ用意する(試聴用)。 */
export async function prepareOne(v: Voice) { await prepareVoices([v], () => {}); return audioOf(v)!; }

/** 台本全体の音声を1本にまとめる(書き出し用)。 */
export async function mixVoices(scenes: { start: number; voice?: Voice }[], duration: number) {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE);
  for (const s of scenes) {
    const buf = audioOf(s.voice); if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(s.start + VOICE_LEAD);
  }
  return ctx.startRendering();
}

let sampleCtx: AudioContext | null = null, sampleSrc: AudioBufferSourceNode | null = null;
/** 試聴の再生。前の試聴は止める。終わったら onEnd を呼ぶ。 */
export function playSample(buf: AudioBuffer, onEnd?: () => void) {
  stopSample();
  sampleCtx ??= new AudioContext({ sampleRate: SAMPLE_RATE });
  void sampleCtx.resume();
  const src = sampleCtx.createBufferSource(); src.buffer = buf; src.connect(sampleCtx.destination);
  src.onended = () => { if (sampleSrc === src) sampleSrc = null; onEnd?.(); };
  src.start(); sampleSrc = src;
}
export function stopSample() { try { sampleSrc?.stop(); } catch { /* 再生前 */ } sampleSrc = null; }

/** プレビューの再生。from 秒の位置から、各カットの音声を予約する。 */
export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  play(scenes: { start: number; voice?: Voice }[], from: number) {
    this.stop();
    this.ctx ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    void this.ctx.resume();
    const now = this.ctx.currentTime + .05;
    for (const s of scenes) {
      const buf = audioOf(s.voice); if (!buf) continue;
      const at = s.start + VOICE_LEAD; if (at + buf.duration <= from) continue;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.ctx.destination);
      src.start(now + Math.max(0, at - from), Math.max(0, from - at)); this.sources.push(src);
    }
  }
  stop() { for (const s of this.sources) { try { s.stop(); } catch { /* 再生前 */ } } this.sources = []; }
}
