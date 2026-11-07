/**
 * サイトの配信と、読み上げ音声の窓口(/api/tts)。
 * Google Cloud の APIキーはここ(Cloudflare の秘密の設定 GOOGLE_TTS_KEY)にだけ置き、ブラウザには渡さない。
 */
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; GOOGLE_TTS_KEY?: string }

const VOICE = /^ja-JP-Chirp3-HD-[A-Za-z]+$/, MAX_CHARS = 300;
const reply = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/tts") return env.ASSETS.fetch(request);
    if (request.method !== "GET") return reply(405, "GETで呼んでください。");
    // Cloudflare Access を通ったリクエストにだけ付く印。ない場合は、他人に無料枠を使われないよう断る
    if (!request.headers.get("Cf-Access-Jwt-Assertion")) return reply(403, "Cloudflare Access でログインした状態で使ってください。");
    if (!env.GOOGLE_TTS_KEY) return reply(500, "Cloudflare に GOOGLE_TTS_KEY が設定されていません。README の手順で設定してください。");
    const text = url.searchParams.get("text") ?? "", voice = url.searchParams.get("voice") ?? "", rate = Number(url.searchParams.get("rate") ?? "1");
    if (!text.trim() || [...text].length > MAX_CHARS) return reply(400, `読み上げる文は1〜${MAX_CHARS}文字にしてください。`);
    if (!VOICE.test(voice)) return reply(400, "声の名前は ja-JP-Chirp3-HD-○○ の形にしてください。");
    if (!(rate >= .25 && rate <= 2)) return reply(400, "rate は 0.25〜2 にしてください。");
    const body = { input: { text }, voice: { languageCode: "ja-JP", name: voice }, audioConfig: { audioEncoding: "MP3", sampleRateHertz: 48000, ...(rate !== 1 ? { speakingRate: rate } : {}) } };
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_TTS_KEY }, body: JSON.stringify(body) });
    if (!res.ok) return reply(502, `Google の音声合成がエラーを返しました(${res.status}): ${(await res.text()).slice(0, 400)}`);
    const { audioContent } = await res.json() as { audioContent?: string };
    if (!audioContent) return reply(502, "Google の音声合成から音声が返りませんでした。");
    const bytes = Uint8Array.from(atob(audioContent), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
  },
};
