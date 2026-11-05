import { load } from "js-yaml";

import { characterByName, looksOf, ofKind, placeByName, type Look } from "./assets";
import { CAMERAS, TIMES, VERBS } from "./vocab";
export { CAMERAS, TIMES, VERBS };
const TARGETED = new Set<string>(["詰め寄る", "殴る"]);

export type Action = { actor: string; verb: (typeof VERBS)[number]; target?: string; start: number; end: number };
export type Scene = { place: string; time: (typeof TIMES)[number]; camera: (typeof CAMERAS)[number]; cast: string[]; looks: Record<string, Look>; actions: Action[]; narration: string; seconds: number; start: number };
export type Script = { title: string; year?: number; scenes: Scene[]; duration: number };

export const SAMPLE = `title: 第一次魚戦争
year: 45
scenes:
  - place: 大磯の漁場
    time: 夕方
    cast: [トフ, ルハ]
    camera: ゆっくり寄る
    actions:
      - トフがルハに詰め寄る
      - トフがルハを殴る
      - ルハが倒れる
      - トフがうなだれる
    narration: 後世の史家は、この一撃をもって戦争の始まりとする。
    seconds: 8
`;

const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

export function parseScript(text: string): Script {
  let raw: any;
  try { raw = load(text); } catch (e) { throw new Error("台本の書き方に誤りがあります: " + (e as Error).message.split("\n")[0]); }
  if (!raw || typeof raw !== "object") throw new Error("台本が空です。");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error("title を書いてください。");
  if (!Array.isArray(raw.scenes) || !raw.scenes.length) throw new Error("scenes に1つ以上のシーンを書いてください。");
  if (raw.year !== undefined && !Number.isInteger(raw.year)) throw new Error("year は整数で書いてください。");
  const year: number | undefined = raw.year;
  let start = 0;
  const scenes = raw.scenes.map((s: any, i: number): Scene => {
    const at = `シーン${i + 1}: `;
    if (!placeByName(s?.place)) throw new Error(`${at}place は ${ofKind("場所").map(p => p.name).join("、")} から選んでください。`);
    if (!includes(TIMES, s.time)) throw new Error(`${at}time は ${TIMES.join("、")} から選んでください。`);
    if (!includes(CAMERAS, s.camera)) throw new Error(`${at}camera は ${CAMERAS.join("、")} から選んでください。`);
    if (!Array.isArray(s.cast) || !s.cast.length || s.cast.length > 6 || s.cast.some((n: unknown) => typeof n !== "string")) throw new Error(`${at}cast に1〜6人の名前を書いてください。`);
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
    const pattern = new RegExp(`^(.+?)が(?:(.+?)[にを])?(${VERBS.join("|")})$`);
    const slot = s.seconds / Math.max(1, lines.length);
    const actions = lines.map((line, j): Action => {
      const m = typeof line === "string" ? line.trim().match(pattern) : null;
      if (!m) throw new Error(`${at}「${line}」は読めません。「名前が動作」または「名前が相手に動作」「名前が相手を動作」の形で、動作は ${VERBS.join("、")} から選んでください。`);
      const [, actor, target, verb] = m;
      if (!s.cast.includes(actor)) throw new Error(`${at}${actor} が cast にいません。`);
      if (target && !s.cast.includes(target)) throw new Error(`${at}${target} が cast にいません。`);
      if (TARGETED.has(verb) && !target) throw new Error(`${at}「${verb}」には相手が必要です。`);
      return { actor, verb: verb as Action["verb"], target, start: start + slot * j, end: start + slot * (j + 1) };
    });
    const scene: Scene = { place: s.place, time: s.time, camera: s.camera, cast: s.cast, looks, actions, narration: s.narration, seconds: s.seconds, start };
    start += s.seconds;
    return scene;
  });
  return { title: raw.title, year, scenes, duration: start };
}

export function sceneAt(script: Script, t: number): Scene {
  return script.scenes.find(s => t < s.start + s.seconds) ?? script.scenes[script.scenes.length - 1];
}
