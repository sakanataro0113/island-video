/**
 * サイトの配信と、読み上げ音声の窓口(/api/tts)。
 * APIキーはここ(Cloudflare の秘密の設定)にだけ置き、ブラウザには渡さない。
 * - Gemini 3.8 TTS(engine=gemini): GEMINI_API_KEY
 * - Chirp 3: HD(engine なし): GOOGLE_TTS_KEY
 */
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; GOOGLE_TTS_KEY?: string; GEMINI_API_KEY?: string }

const CHIRP = /^ja-JP-Chirp3-HD-[A-Za-z]+$/, GEMINI = /^(?:[A-Za-z]+|voice_[A-Za-z0-9_-]+)$/, MAX_CHARS = 300;
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const reply = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const audio = (bytes: Uint8Array, type: string) => new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/tts") return env.ASSETS.fetch(request);
    if (request.method !== "GET") return reply(405, "GETで呼んでください。");
    // Cloudflare Access を通ったリクエストにだけ付く印。ない場合は、他人に使われないよう断る
    if (!request.headers.get("Cf-Access-Jwt-Assertion")) return reply(403, "Cloudflare Access でログインした状態で使ってください。");
    const q = url.searchParams, text = q.get("text") ?? "", voice = q.get("voice") ?? "";
    if (!text.trim() || [...text].length > MAX_CHARS) return reply(400, `読み上げる文は1〜${MAX_CHARS}文字にしてください。`);
    return q.get("engine") === "gemini" ? gemini(q, text, voice, env) : chirp(q, text, voice, env);
  },
};

async function gemini(q: URLSearchParams, text: string, voice: string, env: Env) {
  if (!env.GEMINI_API_KEY) return reply(500, "Cloudflare に GEMINI_API_KEY が設定されていません。README の手順で設定してください。");
  const model = q.get("model") ?? "", style = q.get("style") ?? "", t = q.get("temperature");
  if (!MODELS.includes(model)) return reply(400, `model は ${MODELS.join(" か ")} にしてください。`);
  if (!GEMINI.test(voice)) return reply(400, "声は Alnilam のような名前か、voice_… の ID にしてください。");
  if ([...style].length > 300) return reply(400, "style は300字以内にしてください。");
  const temperature = t == null ? undefined : Number(t);
  if (temperature !== undefined && !(temperature >= 0 && temperature <= 2)) return reply(400, "temperature は 0〜2 にしてください。");
  // 話し方の指示は本文に混ぜず、speech_metadata に入れる(本文に書くと読み上げられることがある)
  const body = {
    model,
    input: [{ type: "user_input", content: [{ type: "text", text, ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}) }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }], ...(temperature !== undefined ? { temperature } : {}) },
  };
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify(body) });
  if (res.status === 402) return reply(502, "Gemini API の残高がありません(402)。AI Studio の Billing でクレジットを足してください。");
  if (res.status === 429) return reply(502, "Gemini API の利用上限に達しました(429)。月額上限か、短時間の回数制限の可能性があります。少し待つか、AI Studio の Spend を確認してください。");
  if (!res.ok) return reply(502, `Gemini の音声合成がエラーを返しました(${res.status}): ${(await res.text()).slice(0, 400)}`);
  const found = lastAudio(await res.json());
  if (!found) return reply(502, "Gemini の音声合成から音声が返りませんでした。");
  return audio(fromBase64(found.data), found.mime_type?.startsWith("audio/") ? found.mime_type : "audio/wav");
}

/** 応答の中から、最後の音声(type: "audio" で data を持つもの)を探す。標準では steps[].content[] にある。 */
function lastAudio(node: unknown): { data: string; mime_type?: string } | undefined {
  let hit: { data: string; mime_type?: string } | undefined;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (o.type === "audio" && typeof o.data === "string") hit = { data: o.data, mime_type: typeof o.mime_type === "string" ? o.mime_type : undefined };
    Object.values(o).forEach(walk);
  };
  walk(node);
  return hit;
}

async function chirp(q: URLSearchParams, text: string, voice: string, env: Env) {
  if (!env.GOOGLE_TTS_KEY) return reply(500, "Cloudflare に GOOGLE_TTS_KEY が設定されていません。README の手順で設定してください。");
  const rate = Number(q.get("rate") ?? "1");
  if (!CHIRP.test(voice)) return reply(400, "声の名前は ja-JP-Chirp3-HD-○○ の形にしてください。");
  if (!(rate >= .25 && rate <= 2)) return reply(400, "rate は 0.25〜2 にしてください。");
  const body = { input: { text }, voice: { languageCode: "ja-JP", name: voice }, audioConfig: { audioEncoding: "MP3", sampleRateHertz: 48000, ...(rate !== 1 ? { speakingRate: rate } : {}) } };
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_TTS_KEY }, body: JSON.stringify(body) });
  if (!res.ok) return reply(502, `Google の音声合成がエラーを返しました(${res.status}): ${(await res.text()).slice(0, 400)}`);
  const { audioContent } = await res.json() as { audioContent?: string };
  if (!audioContent) return reply(502, "Google の音声合成から音声が返りませんでした。");
  return audio(fromBase64(audioContent), "audio/mpeg");
}
