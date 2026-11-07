import yaml from "js-yaml";
import raw from "../voices.yaml?raw";

/** 音声の頭に置く間と、読み終えてから次のカットまでの間(秒)。 */
export const VOICE_LEAD = 0.3, VOICE_TAIL = 0.5, SAMPLE_RATE = 48000;
const NAME = /^ja-JP-Chirp3-HD-[A-Za-z]+$/;

type Config = { narrator: string; rate: number; characters: Record<string, string> };
export const voiceErrors: string[] = [];
export const voices: Config = (() => {
  const c: any = (() => { try { return yaml.load(raw) ?? {}; } catch (e) { voiceErrors.push("voices.yaml を読めません: " + (e as Error).message); return {}; } })();
  const out: Config = { narrator: String(c.narrator ?? ""), rate: Number(c.rate ?? 1), characters: {} };
  if (!NAME.test(out.narrator)) { voiceErrors.push(`voices.yaml の narrator「${out.narrator}」は ja-JP-Chirp3-HD-○○ の形にしてください。`); out.narrator = ""; }
  if (!(out.rate >= .25 && out.rate <= 2)) { voiceErrors.push("voices.yaml の rate は 0.25〜2 にしてください。"); out.rate = 1; }
  for (const [k, v] of Object.entries(c.characters ?? {})) {
    if (typeof v === "string" && NAME.test(v)) out.characters[k] = v;
    else voiceErrors.push(`voices.yaml の ${k} の声「${v}」は ja-JP-Chirp3-HD-○○ の形にしてください。`);
  }
  return out;
})();

export type Voice = { name: string; text: string };

/** 字幕の文から、読み上げる文を作る。強調の[ ]、セリフの「」、改行を取る。 */
export function speechText(narration: string) {
  return narration.replace(/[\[\]「」]/g, "").replace(/\s*\n\s*/g, "").trim();
}
/** カットを誰の声で読むか。読まないカットは undefined。 */
export function voiceOf(narration: string, speaker?: string): Voice | undefined {
  const text = speechText(narration);
  const name = speaker ? voices.characters[speaker] : voices.narrator;
  return text && name ? { name, text } : undefined;
}
export const voiceKey = (v: Voice) => `${v.name}|${voices.rate}|${v.text}`;

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
export const audioOf = (v: Voice | undefined) => v && buffers.get(voiceKey(v));
export const lengthOf = (v: Voice) => buffers.get(voiceKey(v))?.duration;

async function fetchAudio(v: Voice): Promise<AudioBuffer> {
  const url = `/api/tts?${new URLSearchParams({ voice: v.name, rate: String(voices.rate), text: v.text })}`;
  let bytes: ArrayBuffer | null = null;
  let store: Cache | null = null;
  try { store = await caches.open("tts-v1"); bytes = await (await store.match(url))?.arrayBuffer() ?? null; } catch { store = null; }
  if (!bytes) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status === 404 ? "音声の窓口(/api/tts)が見つかりません。Cloudflareに公開したサイトで使ってください。" : await res.text());
    if (!(res.headers.get("Content-Type") ?? "").startsWith("audio/")) throw new Error("音声ではない応答が返りました。ログインが切れている可能性があります。ページを再読み込みしてください。");
    bytes = await res.arrayBuffer();
    try { await store?.put(url, new Response(bytes.slice(0), { headers: { "Content-Type": "audio/mpeg" } })); } catch { /* 保存できなくても再生はできる */ }
  }
  return await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
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
