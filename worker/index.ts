/**
 * サイトの配信と、読み上げ音声の窓口(/api/tts)。
 * APIキーはここ(Cloudflare の秘密の設定)にだけ置き、ブラウザには渡さない。
 * - Gemini 3.8 TTS(engine=gemini): GEMINI_API_KEY
 * - Chirp 3: HD(engine なし): GOOGLE_TTS_KEY
 * 声の割り当てと読み方の設定(/api/settings)は、Cloudflare D1(DB)に、人物ごと・文ごとの行として保存する。
 */
interface D1Stmt { bind(...values: unknown[]): D1Stmt; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> }
interface D1 { prepare(sql: string): D1Stmt; batch(statements: D1Stmt[]): Promise<unknown> }
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; GOOGLE_TTS_KEY?: string; GEMINI_API_KEY?: string; DB?: D1 }

const CHIRP = /^(?:ja-JP|en-US)-Chirp3-HD-[A-Za-z]+$/, GEMINI = /^(?:[A-Za-z]+|voice_[A-Za-z0-9_-]+)$/, MAX_CHARS = 300;
const MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const reply = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const audio = (bytes: Uint8Array, type: string) => new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/tts" && url.pathname !== "/api/settings" && url.pathname !== "/api/subtitle") return env.ASSETS.fetch(request);
    // Cloudflare Access を通ったリクエストにだけ付く印。ない場合は、他人に使われないよう断る
    if (!request.headers.get("Cf-Access-Jwt-Assertion")) return reply(403, "Cloudflare Access でログインした状態で使ってください。");
    if (url.pathname === "/api/settings") return settings(request, env);
    if (url.pathname === "/api/subtitle") return subtitle(request, env);
    if (request.method !== "GET") return reply(405, "GETで呼んでください。");
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
  if (!CHIRP.test(voice)) return reply(400, "声の名前は ja-JP-Chirp3-HD-○○ か en-US-Chirp3-HD-○○ の形にしてください。");
  if (!(rate >= .25 && rate <= 2)) return reply(400, "rate は 0.25〜2 にしてください。");
  const body = { input: { text }, voice: { languageCode: voice.slice(0, 5), name: voice }, audioConfig: { audioEncoding: "MP3", sampleRateHertz: 48000, ...(rate !== 1 ? { speakingRate: rate } : {}) } };
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_TTS_KEY }, body: JSON.stringify(body) });
  if (!res.ok) return reply(502, `Google の音声合成がエラーを返しました(${res.status}): ${(await res.text()).slice(0, 400)}`);
  const { audioContent } = await res.json() as { audioContent?: string };
  if (!audioContent) return reply(502, "Google の音声合成から音声が返りませんでした。");
  return audio(fromBase64(audioContent), "audio/mpeg");
}

const NARRATOR = "__narrator__", MAX_BODY = 512 * 1024, MAX_CHANGES = 2000;
const str = (v: unknown, max: number) => typeof v === "string" && [...v].length <= max;
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

let schema: Promise<unknown> | null = null;
/** 表がなければ作る。Worker が起動して最初の1回だけ。 */
const ensureSchema = (db: D1) => schema ??= db.batch([
  db.prepare("CREATE TABLE IF NOT EXISTS voices (who TEXT PRIMARY KEY, voice TEXT NOT NULL, style TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"),
  db.prepare("CREATE TABLE IF NOT EXISTS spots (line TEXT PRIMARY KEY, spots TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  db.prepare("CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
]).catch(e => { schema = null; throw e; });

/** 保存済みの設定をまとめて返す。一度も保存していなければ null。 */
async function readAll(db: D1) {
  const voices = (await db.prepare("SELECT who, voice, style FROM voices").all<{ who: string; voice: string; style: string }>()).results;
  const spots = (await db.prepare("SELECT line, spots FROM spots").all<{ line: string; spots: string }>()).results;
  const narrator = voices.find(v => v.who === NARRATOR);
  if (!narrator) return null;
  return {
    narrator: { voice: narrator.voice, style: narrator.style },
    characters: Object.fromEntries(voices.filter(v => v.who !== NARRATOR).map(v => [v.who, { voice: v.voice, style: v.style }])),
    spots: Object.fromEntries(spots.map(r => { try { return [r.line, JSON.parse(r.spots)]; } catch { return [r.line, []]; } })),
  };
}

/**
 * 声の割り当てと読み方。GET で全部を読み、PUT で変わった行だけを書く。
 * PUT の本文: { narrator: {voice, style}, characters: {人物: {voice, style} | null}, spots: {文: [{start, length, to}] | null} }
 * null はその行を消す(声なら「読み上げない」、読み方なら元に戻す)。書いていない行はそのまま残る。
 */
async function settings(request: Request, env: Env) {
  if (!env.DB) return reply(500, "Cloudflare に設定の保存先(D1 の DB)がありません。README の手順で作ってください。");
  const db = env.DB;
  try { await ensureSchema(db); } catch (e) { return reply(500, "D1 の表を用意できませんでした: " + (e as Error).message); }
  if (request.method === "GET") return json(await readAll(db));
  if (request.method !== "PUT") return reply(405, "GET か PUT で呼んでください。");
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(400, "設定が大きすぎます。");
  let s: any;
  try { s = JSON.parse(text); } catch { return reply(400, "設定を読めませんでした(JSON ではありません)。"); }
  const entry = (e: any) => e && typeof e === "object" && typeof e.voice === "string" && GEMINI.test(e.voice) && str(e.style ?? "", 300);
  if (!s || typeof s !== "object" || !entry(s.narrator)) return reply(400, "語りの声が正しくありません。");
  const chars = s.characters ?? {}, spots = s.spots ?? {};
  if (typeof chars !== "object" || Array.isArray(chars) || typeof spots !== "object" || Array.isArray(spots)) return reply(400, "設定の形が正しくありません。");
  if (Object.keys(chars).length + Object.keys(spots).length > MAX_CHANGES) return reply(400, "一度に変える行が多すぎます。");
  const now = new Date().toISOString(), batch: D1Stmt[] = [];
  const putVoice = (who: string, e: any) => db.prepare("INSERT INTO voices (who, voice, style, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(who) DO UPDATE SET voice = ?2, style = ?3, updated_at = ?4").bind(who, e.voice, e.style ?? "", now);
  batch.push(putVoice(NARRATOR, s.narrator));
  for (const [who, e] of Object.entries(chars)) {
    if (!str(who, 40) || !who || who === NARRATOR) return reply(400, "人物の名前が正しくありません。");
    if (e === null) batch.push(db.prepare("DELETE FROM voices WHERE who = ?1").bind(who));
    else if (entry(e)) batch.push(putVoice(who, e));
    else return reply(400, `${who}の声が正しくありません。`);
  }
  for (const [line, list] of Object.entries(spots)) {
    const n = [...line].length;
    if (!n || n > 300) return reply(400, "読み方の文が正しくありません。");
    if (list === null) { batch.push(db.prepare("DELETE FROM spots WHERE line = ?1").bind(line)); continue; }
    if (!Array.isArray(list) || !list.length || list.length > 50) return reply(400, `「${line.slice(0, 20)}」の読み方が正しくありません。`);
    for (const x of list as any[]) if (!x || !int(x.start, 0, n - 1) || !int(x.length, 1, 50) || x.start + x.length > n || !str(x.to, 50) || !x.to) return reply(400, `「${line.slice(0, 20)}」の読み方が正しくありません。`);
    const clean = (list as any[]).map(x => ({ start: x.start, length: x.length, to: x.to }));
    batch.push(db.prepare("INSERT INTO spots (line, spots, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(line) DO UPDATE SET spots = ?2, updated_at = ?3").bind(line, JSON.stringify(clean), now));
  }
  await db.batch(batch); // まとめて1つの処理として書く。途中で失敗したら何も書かれない
  return json(await readAll(db));
}

/**
 * 字幕の見た目。GET で読み、PUT で置き換える。中身の細かい確かめはブラウザ側(cleanStyle)で行い、ここでは形と大きさだけ見る。
 */
async function subtitle(request: Request, env: Env) {
  if (!env.DB) return reply(500, "Cloudflare に設定の保存先(D1 の DB)がありません。README の手順で作ってください。");
  const db = env.DB;
  try { await ensureSchema(db); } catch (e) { return reply(500, "D1 の表を用意できませんでした: " + (e as Error).message); }
  // 字幕の見た目は言語ごとに保存する(日本語は以前と同じ 'subtitle'、英語は 'subtitle_en')
  const key = new URL(request.url).searchParams.get("lang") === "en" ? "subtitle_en" : "subtitle";
  if (request.method === "GET") {
    const row = (await db.prepare("SELECT value FROM prefs WHERE key = ?1").bind(key).all<{ value: string }>()).results[0];
    try { return json(row ? JSON.parse(row.value) : null); } catch { return json(null); }
  }
  if (request.method !== "PUT") return reply(405, "GET か PUT で呼んでください。");
  const text = await request.text();
  if (text.length > 4096) return reply(400, "字幕の設定が大きすぎます。");
  let s: unknown;
  try { s = JSON.parse(text); } catch { return reply(400, "字幕の設定を読めませんでした(JSON ではありません)。"); }
  if (!s || typeof s !== "object" || Array.isArray(s)) return reply(400, "字幕の設定の形が正しくありません。");
  for (const v of Object.values(s)) if (!["string", "number", "boolean"].includes(typeof v) || (typeof v === "string" && v.length > 60)) return reply(400, "字幕の設定の値が正しくありません。");
  await db.batch([db.prepare("INSERT INTO prefs (key, value, updated_at) VALUES (?3, ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2").bind(JSON.stringify(s), new Date().toISOString(), key)]);
  return json(s);
}
