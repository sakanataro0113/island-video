import yaml from "js-yaml";
import raw from "../voices.yaml?raw";

/** 音声の頭に置く間と、読み終えてから次のカットまでの間(秒)。 */
export const VOICE_LEAD = 0.3, VOICE_TAIL = 0.5, SAMPLE_RATE = 48000;
const CHIRP = /^ja-JP-Chirp3-HD-[A-Za-z]+$/, GEMINI = /^(?:[A-Za-z]+|voice_[A-Za-z0-9_-]+)$/;
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];

/** 声ごとの、窓口(/api/tts)に渡す設定。本文以外の部分。 */
type Params = Record<string, string>;
type Config = { engine: "gemini" | "chirp"; narrator?: Params; characters: Record<string, Params> };
export const voiceErrors: string[] = [];
export const voices: Config = (() => {
  const c: any = (() => { try { return yaml.load(raw) ?? {}; } catch (e) { voiceErrors.push("voices.yaml を読めません: " + (e as Error).message); return {}; } })();
  const engine = c.engine === "chirp" ? "chirp" : "gemini";
  if (c.engine !== "gemini" && c.engine !== "chirp") voiceErrors.push(`voices.yaml の engine「${c.engine}」は gemini か chirp にしてください。`);
  const sec: any = c[engine] ?? {}, out: Config = { engine, characters: {} };
  let make: (name: unknown, who: string) => Params | undefined;
  if (engine === "chirp") {
    const rate = Number(sec.rate ?? 1);
    if (!(rate >= .25 && rate <= 2)) voiceErrors.push("voices.yaml の chirp.rate は 0.25〜2 にしてください。");
    // 以前と同じ並びにして、保存済みの Chirp の音声をそのまま使えるようにする
    make = (name, who) => CHIRP.test(String(name)) ? { voice: String(name), rate: String(rate >= .25 && rate <= 2 ? rate : 1) }
      : (voiceErrors.push(`voices.yaml の ${who} の声「${name}」は ja-JP-Chirp3-HD-○○ の形にしてください。`), undefined);
  } else {
    const model = String(sec.model ?? MODELS[0]), style = String(sec.style ?? "").trim(), temp = sec.temperature;
    if (!MODELS.includes(model)) voiceErrors.push(`voices.yaml の gemini.model「${model}」は ${MODELS.join(" か ")} にしてください。`);
    if ([...style].length > 300) voiceErrors.push("voices.yaml の gemini.style は300字以内にしてください。");
    const t = temp == null ? undefined : Number(temp);
    if (t !== undefined && !(t >= 0 && t <= 2)) voiceErrors.push("voices.yaml の gemini.temperature は 0〜2 にしてください。");
    const base: Params = { engine: "gemini", model: MODELS.includes(model) ? model : MODELS[0], style: [...style].slice(0, 300).join(""), ...(t !== undefined && t >= 0 && t <= 2 ? { temperature: String(t) } : {}) };
    make = (name, who) => GEMINI.test(String(name)) ? { ...base, voice: String(name) }
      : (voiceErrors.push(`voices.yaml の ${who} の声「${name}」は Alnilam のような声の名前か、voice_… の ID にしてください。`), undefined);
  }
  out.narrator = make(sec.narrator, "narrator");
  for (const [k, v] of Object.entries(sec.characters ?? {})) { const p = make(v, k); if (p) out.characters[k] = p; }
  return out;
})();

export type Voice = { params: Params; text: string };

/** 字幕の文から、読み上げる文を作る。強調の[ ]、セリフの「」、改行を取る。 */
export function speechText(narration: string) {
  return narration.replace(/[\[\]「」]/g, "").replace(/\s*\n\s*/g, "").trim();
}
/** カットを誰の声で読むか。読まないカットは undefined。 */
export function voiceOf(narration: string, speaker?: string): Voice | undefined {
  const text = speechText(narration);
  const params = speaker ? voices.characters[speaker] : voices.narrator;
  return text && params ? { params, text } : undefined;
}
const urlOf = (v: Voice) => `/api/tts?${new URLSearchParams({ ...v.params, text: v.text })}`;
export const voiceKey = urlOf;

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
export const audioOf = (v: Voice | undefined) => v && buffers.get(voiceKey(v));
export const lengthOf = (v: Voice) => buffers.get(voiceKey(v))?.duration;

async function fetchAudio(v: Voice): Promise<AudioBuffer> {
  const url = urlOf(v);
  let bytes: ArrayBuffer | null = null;
  let store: Cache | null = null;
  try { store = await caches.open("tts-v1"); bytes = await (await store.match(url))?.arrayBuffer() ?? null; } catch { store = null; }
  if (!bytes) {
    const res = await fetch(url);
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
 * 日本語の読み上げを1秒7字前後として、声の入っている長さが目安の3割に満たないか、全体が目安の3倍+2秒を超えたら失敗とする。
 */
export function checkSpeech(buf: AudioBuffer, text: string) {
  const data = buf.getChannelData(0), win = Math.max(1, Math.round(buf.sampleRate * .02));
  let voiced = 0;
  for (let i = 0; i < data.length; i += win) {
    let sum = 0; const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) sum += data[j]! * data[j]!;
    if (Math.sqrt(sum / (end - i)) > .01) voiced++;
  }
  const spoken = voiced * win / buf.sampleRate, expected = [...text].length / 7;
  if (spoken < Math.max(.2, expected * .3)) throw new Error(`「${text.slice(0, 20)}…」の音声に、声がほとんど入っていませんでした(${spoken.toFixed(1)}秒)。もう一度読み込むと作り直します。続く場合は voices.yaml の temperature を上げるか消してください。`);
  if (buf.duration > expected * 3 + 2) throw new Error(`「${text.slice(0, 20)}…」の音声が長すぎます(${buf.duration.toFixed(1)}秒、声は${spoken.toFixed(1)}秒)。もう一度読み込むと作り直します。`);
}

/** 足りない音声をまとめて用意する。1つでも失敗したら、最初の理由で止める。 */
export async function prepareVoices(list: Voice[], onProgress: (done: number, total: number) => void) {
  const need = [...new Map(list.filter(v => !buffers.has(voiceKey(v))).map(v => [voiceKey(v), v])).values()];
  let done = 0;
  const one = async (v: Voice) => {
    const key = voiceKey(v);
    if (!pending.has(key)) pending.set(key, fetchAudio(v).then(b => { buffers.set(key, b); return b; }).finally(() => pending.delete(key)));
    await pending.get(key); onProgress(++done, need.length);
  };
  const queue = [...need];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()!); }));
  return need.length;
}

/** 台本全体の音声を1本にまとめる(書き出し用)。 */
export async function mixVoices(scenes: { start: number; voice?: Voice }[], duration: number) {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE);
  for (const s of scenes) {
    const buf = audioOf(s.voice); if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(s.start + VOICE_LEAD);
  }
  return ctx.startRendering();
}

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
