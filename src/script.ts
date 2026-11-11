import { load } from "js-yaml";

import { catalog, characterByName, looksOf, ofKind, placeByName, type Look } from "./assets";
import { CAMERAS, SEASONS, TIMES, VERBS } from "./vocab";
import { VOICE_LEAD, VOICE_TAIL, lengthOf, voiceOf, type Voice } from "./voice";
import { isLatin, lang as currentLang, type Lang } from "./lang";
export { CAMERAS, SEASONS, TIMES, VERBS };
const TARGETED = new Set<string>(["詰め寄る", "殴る", "引っ張り合う", "激しく引っ張り合う"]);

type V3 = [number, number, number];
/** from から to へ動きながら、look から look_to を見る。fov は縦の画角(度)。 */
export type CameraMove = { kind: "move"; from: V3; to: V3; look: V3; lookTo: V3; fov?: number };
/** FPV: 点を順に、なめらかに一定の速さで飛ぶ。進む向きを見て、曲がるときに傾く(bank は最大の傾き、度)。点に look を書くと、そこではその位置を見る。 */
export type CameraPath = { kind: "path"; points: { at: V3; look?: V3 }[]; fov: number; bank: number };
/** center の周りを一定の速さで回る。turns: 1 で一周(360°)。start は開始の角度(度、0 は手前の +z 側)。 */
export type CameraOrbit = { kind: "orbit"; center: V3; radius: number; height: number; start: number; turns: number; look: V3; fov?: number };
export type Prop = { asset: string; state?: string; flap?: [string, string]; scale: number; facePath: boolean; yaw: number; between?: [string, string]; grow?: [number, number]; riders?: { count: number; seed: number; palette?: string }; height: number; path: { t: number; at: [number, number, number] }[] };
export type Action = { actor: string; verb: (typeof VERBS)[number]; target?: string; start: number; end: number };
export type Scene = { place: string; time: (typeof TIMES)[number]; camera: (typeof CAMERAS)[number] | CameraMove | CameraPath | CameraOrbit; cast: string[]; positions: Record<string, [number, number]>; faces: Record<string, number>; props: Prop[]; population?: number; flashback: boolean; season?: (typeof SEASONS)[number]; caption?: string; speaker?: string; storm: boolean; sea?: [number, number]; hud: boolean; labels: { text: string; sub?: string; x: number; y: number }[]; crowd?: { count: number; seed: number; center: [number, number]; radius: [number, number]; cheer: boolean; lines: { from: [number, number]; to: [number, number]; count: number; face: number; palette?: string; fallAt?: number }[]; palette?: string; tug: boolean; fallAt?: number }; looks: Record<string, Look>; actions: Action[]; narration: string; voice?: Voice; seconds: number; start: number; split?: Scene; speakerTitle?: string };
export type Script = { title: string; year?: number; population?: number; scenes: Scene[]; duration: number; lang: Lang };

const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** useVoice が true なら、読み上げる声を決め、用意済みの音声の長さに合わせてカットを延ばす。
 *  lang が en なら、各カットの en: { narration, caption, labels, speaker_title } と title_en を使う。映像と出来事は共通。 */
export function parseScript(text: string, useVoice = false, lang: Lang = currentLang): Script {
  let raw: any;
  try { raw = load(text); } catch (e) { throw new Error("台本の書き方に誤りがあります: " + (e as Error).message.split("\n")[0]); }
  if (!raw || typeof raw !== "object") throw new Error("台本が空です。");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error("title を書いてください。");
  if (!Array.isArray(raw.scenes) || !raw.scenes.length) throw new Error("scenes に1つ以上のシーンを書いてください。");
  if (raw.year !== undefined && !Number.isInteger(raw.year)) throw new Error("year は整数で書いてください。");
  const year: number | undefined = raw.year;
  if (raw.population !== undefined && !Number.isInteger(raw.population)) throw new Error("population は整数で書いてください。");
  if (lang === "en" && (typeof raw.title_en !== "string" || !raw.title_en.trim())) throw new Error("英語版の題名(title_en)を書いてください。");
  let start = 0;
  /** 1カットを読む。isSplit のときは、画面を斜めに分けた下側の映像として読む(字幕と時間は親のカットに従う)。 */
  const parseScene = (s: any, i: number, isSplit = false): Scene => {
    const at = `シーン${i + 1}${isSplit ? "(split)" : ""}: `;
    if (!placeByName(s?.place)) throw new Error(`${at}place は ${ofKind("場所").map(p => p.name).join("、")} から選んでください。`);
    if (!includes(TIMES, s.time)) throw new Error(`${at}time は ${TIMES.join("、")} から選んでください。`);
    // 季節: 話全体の season を使う。カットに season を書けば上書き(回想など。空の文字列で、いつもの見た目)
    const season = s.season !== undefined ? s.season : raw.season;
    if (season !== undefined && season !== "" && !includes(SEASONS, season)) throw new Error(`${at}season は ${SEASONS.join("、")} か、空にしてください。`);
    const vec3 = (v: unknown, label: string) => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== "number")) throw new Error(`${at}${label} は [x, y, z] の形で書いてください。`); return v as [number, number, number]; };
    let camera: Scene["camera"];
    if (includes(CAMERAS, s.camera)) camera = s.camera;
    else if (s.camera && typeof s.camera === "object") {
      const c = s.camera, num = (v: unknown, label: string, lo: number, hi: number, def?: number) => { const n = v === undefined ? def : v; if (typeof n !== "number" || !(n >= lo && n <= hi)) throw new Error(`${at}camera.${label} は ${lo}〜${hi} の数で書いてください。`); return n; };
      const fov = c.fov === undefined ? undefined : num(c.fov, "fov", 20, 120);
      if (c.path !== undefined) {
        if (!Array.isArray(c.path) || c.path.length < 2) throw new Error(`${at}camera.path には2つ以上の点を書いてください。`);
        camera = { kind: "path", points: c.path.map((q: any, k: number) => ({ at: vec3(q?.at, `camera.path ${k + 1}点目の at`), look: q?.look === undefined ? undefined : vec3(q.look, `camera.path ${k + 1}点目の look`) })), fov: fov ?? 80, bank: num(c.bank, "bank", 0, 60, 25) };
      } else if (c.orbit !== undefined) {
        const o = c.orbit, center = vec3(o?.center, "camera.orbit.center");
        camera = { kind: "orbit", center, radius: num(o.radius, "orbit.radius", .5, 2000), height: num(o.height, "orbit.height", -100, 2000, center[1] + 2), start: num(o.start, "orbit.start", -3600, 3600, 0), turns: num(o.turns, "orbit.turns", -10, 10, 1), look: o.look === undefined ? center : vec3(o.look, "camera.orbit.look"), fov };
      } else {
        const from = vec3(c.from, "camera.from"), look = vec3(c.look, "camera.look");
        camera = { kind: "move", from, to: c.to ? vec3(c.to, "camera.to") : from, look, lookTo: c.look_to ? vec3(c.look_to, "camera.look_to") : look, fov };
      }
    }
    else throw new Error(`${at}camera は ${CAMERAS.join("、")} か、from と look、path(FPV)、orbit(周回)のどれかで指定してください。`);
    if (!Array.isArray(s.cast) || s.cast.length > 6 || s.cast.some((n: unknown) => typeof n !== "string")) throw new Error(`${at}cast に6人までの名前を書いてください。`);
    if (new Set(s.cast).size !== s.cast.length) throw new Error(`${at}cast に同じ名前があります。`);
    const looks: Record<string, Look> = {};
    for (const name of s.cast as string[]) {
      const c = characterByName(name);
      if (!c) throw new Error(`${at}人物「${name}」が素材に登録されていません。素材一覧で確認してください。`);
      let state = c.looks[0].name;
      if (year !== undefined) {
        if (year < c.born) throw new Error(`${at}${name} は${year}年にはまだ生まれていません(${c.born}年生まれ)。`);
        if (c.died !== undefined && year > c.died) throw new Error(`${at}${name} は${c.died}年に死亡しています。${year}年の場面には出せません。`);
        const age = year - c.born;
        for (const l of c.looks) if (age >= l.fromAge) state = l.name;
      }
      looks[name] = looksOf(c, state);
    }
        if (typeof s.seconds !== "number" || !(s.seconds > 0) || s.seconds > 120) throw new Error(`${at}seconds は120以下の正の数にしてください。`);
    if (typeof s.narration !== "string") throw new Error(`${at}narration を書いてください。`);
    // 言語ごとの文字。英語版は en: の中を使い、日本語に字幕があるのに英語がなければ止める
    const en = s.en && typeof s.en === "object" ? s.en : {};
    if (lang === "en" && !isSplit) {
      if (s.narration.trim() && (typeof en.narration !== "string" || !en.narration.trim())) throw new Error(`${at}英語の字幕(en.narration)がありません。`);
      if (s.caption !== undefined && typeof en.caption !== "string") throw new Error(`${at}英語の日数の札(en.caption)がありません。`);
      if ((s.labels ?? []).length && (!Array.isArray(en.labels) || en.labels.length !== s.labels.length)) throw new Error(`${at}英語の札(en.labels)を、日本語の labels と同じ数だけ書いてください。`);
    }
    const narration: string = lang === "en" && !isSplit && s.narration.trim() ? String(en.narration) : s.narration;
    const caption: string | undefined = s.caption === undefined ? undefined : lang === "en" ? String(en.caption ?? s.caption) : s.caption;
    const labelsRaw: any[] = (s.labels ?? []).map((l: any, k: number) => lang === "en" && en.labels?.[k] ? { ...l, text: en.labels[k].text ?? l.text, sub: en.labels[k].sub ?? (l.sub === undefined ? undefined : "") } : l);
    const lines: unknown[] = s.actions ?? [];
    if (!Array.isArray(lines)) throw new Error(`${at}actions は一覧で書いてください。`);
    const pattern = new RegExp(`^(.+?)が(?:(.+?)[にをと])?(${VERBS.join("|")})$`);
    const slot = s.seconds / Math.max(1, lines.length);
    const actions = lines.map((line: any, j): Action => {
      const text = typeof line === "string" ? line : line?.do;
      const m = typeof text === "string" ? text.trim().match(pattern) : null;
      if (!m) throw new Error(`${at}「${text}」は読めません。「名前が動作」または「名前が相手に動作」の形で、動作は ${VERBS.join("、")} から選んでください。`);
      const [, actor, target, verb] = m;
      if (!s.cast.includes(actor)) throw new Error(`${at}${actor} が cast にいません。`);
      if (target && !s.cast.includes(target)) throw new Error(`${at}${target} が cast にいません。`);
      if (TARGETED.has(verb) && !target) throw new Error(`${at}「${verb}」には相手が必要です。`);
      const from = typeof line === "object" && typeof line.from === "number" ? line.from : slot * j;
      const to = typeof line === "object" && typeof line.to === "number" ? line.to : slot * (j + 1);
      if (!(to > from)) throw new Error(`${at}「${text}」の to は from より後にしてください。`);
      return { actor, verb: verb as Action["verb"], target, start: start + from, end: start + to };
    });
    const positions: Record<string, [number, number]> = {};
    for (const [name, v] of Object.entries(s.positions ?? {})) {
      if (!s.cast.includes(name)) throw new Error(`${at}positions の ${name} が cast にいません。`);
      if (!Array.isArray(v) || v.length !== 2) throw new Error(`${at}positions は [x, z] の形で書いてください。`);
      positions[name] = v as [number, number];
    }
    const props: Prop[] = (s.props ?? []).map((q: any): Prop => {
      const asset = catalog.byId.get(q?.asset);
      if (!asset || !("parts" in asset)) throw new Error(`${at}小物「${q?.asset}」が素材にありません。`);
      for (const st of [q.state, ...(q.flap ?? [])]) if (st !== undefined && !asset.parts[st]) throw new Error(`${at}${q.asset} に状態「${st}」がありません。`);
      const path = (q.path ?? (q.at ? [{ t: 0, at: q.at }] : [])).map((k: any) => ({ t: Number(k.t ?? 0), at: vec3(k.at, "props.at") }));
      if (!path.length && !q.between) throw new Error(`${at}小物「${q.asset}」の at、path、between のいずれかを書いてください。`);
      if (q.between && !q.between.every((n: string) => s.cast.includes(n))) throw new Error(`${at}小物「${q.asset}」の between の人物が cast にいません。`);
      return { asset: q.asset, state: q.state, flap: q.flap, scale: Number(q.scale ?? 1), facePath: !!q.face_path, yaw: Number(q.yaw ?? 0), between: q.between, height: Number(q.height ?? 1.2), path, grow: q.grow, riders: q.riders ? { count: Number(q.riders.count), seed: Number(q.riders.seed ?? 1), palette: q.riders.palette } : undefined }
    });
    const voice = useVoice ? voiceOf(narration, s.speaker, lang) : undefined, spoken = voice && lengthOf(voice);
    const seconds = Math.max(readingTime(narration, s.seconds), spoken ? VOICE_LEAD + spoken + VOICE_TAIL : 0);
    const scene: Scene = { place: s.place, time: s.time, camera, cast: s.cast, positions, faces: Object.fromEntries(Object.entries(s.faces ?? {}).map(([k, v]) => [k, Number(v) * Math.PI / 180])), flashback: !!s.flashback, season: season || undefined, storm: !!s.storm, sea: s.sea, hud: s.hud !== false, caption, speaker: s.speaker, labels: labelsRaw.map((l: any) => ({ text: String(l.text), sub: l.sub, x: Number(l.x ?? .5), y: Number(l.y ?? .3) })), crowd: s.crowd ? { count: Number(s.crowd.count), seed: Number(s.crowd.seed ?? 1), center: s.crowd.center ?? [0, 0], radius: s.crowd.radius ?? [0, 0], cheer: !!s.crowd.cheer, lines: (s.crowd.lines ?? []).map((l: any) => ({ from: l.from, to: l.to, count: Number(l.count), face: Number(l.face) * Math.PI / 180, palette: l.palette, fallAt: l.fall_at })), palette: s.crowd.palette, tug: !!s.crowd.tug, fallAt: s.crowd.fall_at } : undefined, props, population: s.population ?? raw.population, looks, actions, narration, voice, seconds, start };
    const title = lang === "en" ? en.speaker_title : s.speaker_title;
    if (title !== undefined) scene.speakerTitle = String(title);
    if (!isSplit && s.split !== undefined) {
      if (!s.split || typeof s.split !== "object") throw new Error(`${at}split には、下側に映す場所、時間帯、カメラを書いてください。`);
      scene.split = { ...parseScene({ cast: [], ...s.split, narration: "", seconds: s.seconds, hud: false }, i, true), start, seconds };
    }
    if (!isSplit) start += seconds;
    return scene;
  };
  const scenes = raw.scenes.map((s: any, i: number) => parseScene(s, i));
  return { title: lang === "en" ? raw.title_en : raw.title, year, population: raw.population, scenes, duration: start, lang };
}

export function sceneAt(script: Script, t: number): Scene {
  return script.scenes.find(s => t < s.start + s.seconds) ?? script.scenes[script.scenes.length - 1];
}

/** 字幕を読み切れる長さ。台本の seconds より短くはしない(動きの速さは変えず、場面の終わりを延ばす)。
 *  目安: 見る間 0.6秒 + 1秒に5文字(英語は1秒に2.8語)。記号 / [ ] は数えない。 */
export const READ_LEAD = 0.6, READ_CPS = 5, READ_WPS = 2.8;
export function readingTime(narration: string, seconds: number) {
  // 英語は語数で数える(1秒に2.8語。実際に見て調整する)
  if (isLatin(narration)) { const n = narration.replace(/[\[\]]/g, "").split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length; return n ? Math.max(seconds, READ_LEAD + n / READ_WPS) : seconds; }
  const chars = [...narration.replace(/[\/\[\]\s]/g, "")].length;
  return chars ? Math.max(seconds, READ_LEAD + chars / READ_CPS) : seconds;
}
