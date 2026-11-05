import { load } from "js-yaml";

import { catalog, characterByName, looksOf, ofKind, placeByName, type Look } from "./assets";
import { CAMERAS, TIMES, VERBS } from "./vocab";
export { CAMERAS, TIMES, VERBS };
const TARGETED = new Set<string>(["詰め寄る", "殴る", "引っ張り合う", "激しく引っ張り合う"]);

export type CameraMove = { from: [number, number, number]; to: [number, number, number]; look: [number, number, number]; lookTo: [number, number, number] };
export type Prop = { asset: string; state?: string; flap?: [string, string]; scale: number; facePath: boolean; yaw: number; between?: [string, string]; grow?: [number, number]; height: number; path: { t: number; at: [number, number, number] }[] };
export type Action = { actor: string; verb: (typeof VERBS)[number]; target?: string; start: number; end: number };
export type Scene = { place: string; time: (typeof TIMES)[number]; camera: (typeof CAMERAS)[number] | CameraMove; cast: string[]; positions: Record<string, [number, number]>; faces: Record<string, number>; props: Prop[]; population?: number; flashback: boolean; caption?: string; speaker?: string; labels: { text: string; sub?: string; x: number; y: number }[]; crowd?: { count: number; seed: number; center: [number, number]; radius: [number, number]; cheer: boolean; lines: { from: [number, number]; to: [number, number]; count: number; face: number }[]; tug: boolean; fallAt?: number }; looks: Record<string, Look>; actions: Action[]; narration: string; seconds: number; start: number };
export type Script = { title: string; year?: number; population?: number; scenes: Scene[]; duration: number };

const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

export function parseScript(text: string): Script {
  let raw: any;
  try { raw = load(text); } catch (e) { throw new Error("台本の書き方に誤りがあります: " + (e as Error).message.split("\n")[0]); }
  if (!raw || typeof raw !== "object") throw new Error("台本が空です。");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error("title を書いてください。");
  if (!Array.isArray(raw.scenes) || !raw.scenes.length) throw new Error("scenes に1つ以上のシーンを書いてください。");
  if (raw.year !== undefined && !Number.isInteger(raw.year)) throw new Error("year は整数で書いてください。");
  const year: number | undefined = raw.year;
  if (raw.population !== undefined && !Number.isInteger(raw.population)) throw new Error("population は整数で書いてください。");
  let start = 0;
  const scenes = raw.scenes.map((s: any, i: number): Scene => {
    const at = `シーン${i + 1}: `;
    if (!placeByName(s?.place)) throw new Error(`${at}place は ${ofKind("場所").map(p => p.name).join("、")} から選んでください。`);
    if (!includes(TIMES, s.time)) throw new Error(`${at}time は ${TIMES.join("、")} から選んでください。`);
    const vec3 = (v: unknown, label: string) => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== "number")) throw new Error(`${at}${label} は [x, y, z] の形で書いてください。`); return v as [number, number, number]; };
    let camera: Scene["camera"];
    if (includes(CAMERAS, s.camera)) camera = s.camera;
    else if (s.camera && typeof s.camera === "object") { const from = vec3(s.camera.from, "camera.from"), look = vec3(s.camera.look, "camera.look"); camera = { from, to: s.camera.to ? vec3(s.camera.to, "camera.to") : from, look, lookTo: s.camera.look_to ? vec3(s.camera.look_to, "camera.look_to") : look }; }
    else throw new Error(`${at}camera は ${CAMERAS.join("、")} か、from と look の指定にしてください。`);
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
      return { asset: q.asset, state: q.state, flap: q.flap, scale: Number(q.scale ?? 1), facePath: !!q.face_path, yaw: Number(q.yaw ?? 0), between: q.between, height: Number(q.height ?? 1.2), path, grow: q.grow }
    });
    const scene: Scene = { place: s.place, time: s.time, camera, cast: s.cast, positions, faces: Object.fromEntries(Object.entries(s.faces ?? {}).map(([k, v]) => [k, Number(v) * Math.PI / 180])), flashback: !!s.flashback, caption: s.caption, speaker: s.speaker, labels: (s.labels ?? []).map((l: any) => ({ text: String(l.text), sub: l.sub, x: Number(l.x ?? .5), y: Number(l.y ?? .3) })), crowd: s.crowd ? { count: Number(s.crowd.count), seed: Number(s.crowd.seed ?? 1), center: s.crowd.center ?? [0, 0], radius: s.crowd.radius ?? [0, 0], cheer: !!s.crowd.cheer, lines: (s.crowd.lines ?? []).map((l: any) => ({ from: l.from, to: l.to, count: Number(l.count), face: Number(l.face) * Math.PI / 180 })), tug: !!s.crowd.tug, fallAt: s.crowd.fall_at } : undefined, props, population: s.population ?? raw.population, looks, actions, narration: s.narration, seconds: s.seconds, start };
    start += s.seconds;
    return scene;
  });
  return { title: raw.title, year, population: raw.population, scenes, duration: start };
}

export function sceneAt(script: Script, t: number): Scene {
  return script.scenes.find(s => t < s.start + s.seconds) ?? script.scenes[script.scenes.length - 1];
}
