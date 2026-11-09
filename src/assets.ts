import { load } from "js-yaml";
import { VERBS, TIMES } from "./vocab";
import type { Vec3 } from "./math";

export const KINDS = ["人物", "建物", "小物", "植物", "場所", "動作"] as const;
export type Kind = (typeof KINDS)[number];

type PartBase = { at: Vec3; color: Vec3; rot?: Vec3 };
export type Part = PartBase & (
  | { shape: "box"; size: Vec3 }
  | { shape: "cone"; radius: number; height: number; sides: number; jitter: number; seed: number }
  | { shape: "cylinder"; radius: number; top: number; height: number; sides: number }
  | { shape: "sphere"; scale: Vec3; detail: number; jitter: number; seed: number; clip?: "front" | "back" }
  | { shape: "loft"; sections: [number, number, number, number][] });
type Base = { id: string; kind: Kind; name: string; tags: string[]; source: string; raw: string; states: string[] };
export type Look = { clothes: Vec3; hair: Vec3; skin: Vec3; height: number; hairStyle: "short" | "long" | "bald"; stoop: number; skirt: boolean; chief: boolean };
export type CharacterAsset = Base & { kind: "人物"; born: number; died?: number; looks: { name: string; fromAge: number; look: Look }[] };
export type ModelAsset = Base & { kind: "建物" | "小物" | "植物"; parts: Record<string, Part[]> };
export type PlaceAsset = Base & {
  kind: "場所";
  /** peak: 中央の山の高さ。river: 島を南北に裂く川(谷)。北の海から to_z まで流れ、南の端は池になる */
  terrain: { centerZ: number; radius: number; peak: number; river?: { x: number; toZ: number; width: number; wiggle: number; lagoon: number } };
  items: { asset: string; at: Vec3; scale: number; rot: number; ground: boolean; state?: string }[];
  scatter: { asset: string; count: number; seed: number; ring: [number, number]; scale: [number, number]; spacing: number }[];
  exclude: { x: [number, number]; z: [number, number] }[];
};
export type MotionAsset = Base & { kind: "動作"; description: string; needsTarget: boolean };
export type Asset = CharacterAsset | ModelAsset | PlaceAsset | MotionAsset;

export function hex(value: unknown, where: string): Vec3 {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${where} の色は "#rrggbb" の形で書いてください。`);
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255) as Vec3;
}
const num = (v: unknown, where: string): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${where} は数値で書いてください。`); return v; };
const vec = (v: unknown, where: string): Vec3 => { if (!Array.isArray(v) || v.length !== 3) throw new Error(`${where} は [x, y, z] の形で書いてください。`); return v.map(n => num(n, where)) as Vec3; };
const pair = (v: unknown, where: string): [number, number] => { if (!Array.isArray(v) || v.length !== 2) throw new Error(`${where} は [最小, 最大] の形で書いてください。`); return [num(v[0], where), num(v[1], where)]; };

function parsePart(p: any, where: string): Part {
  const base: PartBase = { at: vec(p?.at, where + " at"), color: hex(p?.color, where), rot: p?.rot === undefined ? undefined : vec(p.rot, where + " rot") };
  const sides = () => Math.max(3, Math.round(num(p.sides ?? 8, where + " sides")));
  if (p.shape === "box") return { ...base, shape: "box", size: vec(p.size, where + " size") };
  if (p.shape === "cone") return { ...base, shape: "cone", radius: num(p.radius, where + " radius"), height: num(p.height, where + " height"), sides: sides(), jitter: num(p.jitter ?? 0, where + " jitter"), seed: num(p.seed ?? 1, where + " seed") };
  if (p.shape === "cylinder") return { ...base, shape: "cylinder", radius: num(p.radius, where + " radius"), top: num(p.top ?? p.radius, where + " top"), height: num(p.height, where + " height"), sides: sides() };
  if (p.shape === "sphere") return { ...base, shape: "sphere", scale: vec(p.scale ?? [1, 1, 1], where + " scale"), detail: Math.min(3, Math.max(0, Math.round(num(p.detail ?? 1, where + " detail")))), jitter: num(p.jitter ?? 0, where + " jitter"), seed: num(p.seed ?? 1, where + " seed"), clip: p.clip === "front" || p.clip === "back" ? p.clip : undefined };
  if (p.shape === "loft" && Array.isArray(p.sections) && p.sections.length >= 2) return { ...base, shape: "loft", sections: p.sections.map((q: unknown) => { if (!Array.isArray(q) || q.length !== 4) throw new Error(`${where} の sections は [位置, 半幅, 下, 上] の形で書いてください。`); return q.map(n => num(n, where)) as [number, number, number, number]; }) };
  throw new Error(`${where} の shape は box、cone、cylinder、sphere、loft から選んでください。`);
}

export function parseAsset(raw: string, source: string): Asset {
  const d: any = load(raw);
  if (!d || typeof d !== "object") throw new Error("中身が空です。");
  if (typeof d.id !== "string" || !d.id) throw new Error("id がありません。");
  if (typeof d.name !== "string" || !d.name) throw new Error("name がありません。");
  if (!(KINDS as readonly string[]).includes(d.kind)) throw new Error(`kind は ${KINDS.join("、")} から選んでください。`);
  const tags: string[] = Array.isArray(d.tags) ? d.tags.map(String) : [];
  const base = { id: d.id, name: d.name, tags, source, raw };
  if (d.kind === "人物") {
    if (!Array.isArray(d.states) || !d.states.length) throw new Error("states がありません。");
    const looks = d.states.map((s: any) => ({
      name: String(s.name), fromAge: num(s.from_age, "from_age"),
      look: { clothes: hex(s.clothes ?? d.clothes, "clothes"), hair: hex(s.hair ?? d.hair, "hair"), skin: hex(s.skin ?? d.skin, "skin"), height: num(s.height ?? 1, "height"), hairStyle: (["short", "long", "bald"].includes(s.hair_style ?? d.hair_style) ? (s.hair_style ?? d.hair_style) : "short") as Look["hairStyle"], stoop: num(s.stoop ?? 0, "stoop"), skirt: !!(s.skirt ?? d.skirt), chief: !!(s.chief ?? d.chief) },
    }));
    if (d.died !== undefined) num(d.died, "died");
    return { ...base, kind: "人物", born: num(d.born, "born"), died: d.died, looks, states: looks.map((l: { name: string }) => l.name) };
  }
  if (d.kind === "場所") {
    const items = (d.items ?? []).map((i: any) => ({ asset: String(i.asset), at: vec(i.at, "items.at"), scale: num(i.scale ?? 1, "items.scale"), rot: num(i.rot ?? 0, "items.rot"), ground: !!i.ground, state: i.state === undefined ? undefined : String(i.state) }));
    const scatter = (d.scatter ?? []).map((s: any) => ({ asset: String(s.asset), count: num(s.count, "scatter.count"), seed: num(s.seed, "scatter.seed"), ring: pair(s.ring, "scatter.ring"), scale: pair(s.scale ?? [1, 1], "scatter.scale"), spacing: num(s.spacing ?? 0, "scatter.spacing") }));
    const exclude = (d.exclude ?? []).map((e: any) => ({ x: pair(e.x, "exclude.x"), z: pair(e.z, "exclude.z") }));
    const t = d.terrain ?? {}, rv = t.river;
    const river = rv === undefined ? undefined : { x: num(rv.x ?? 0, "terrain.river.x"), toZ: num(rv.to_z, "terrain.river.to_z"), width: num(rv.width ?? 1.2, "terrain.river.width"), wiggle: num(rv.wiggle ?? 1.5, "terrain.river.wiggle"), lagoon: num(rv.lagoon ?? 0, "terrain.river.lagoon") };
    return { ...base, kind: "場所", terrain: { centerZ: num(t.center_z, "terrain.center_z"), radius: num(t.radius, "terrain.radius"), peak: num(t.peak ?? 0, "terrain.peak"), river }, items, scatter, exclude, states: [...TIMES] };
  }
  if (d.kind === "動作") {
    if (!(VERBS as readonly string[]).includes(d.name)) throw new Error(`動作「${d.name}」の動きがコードにありません。`);
    return { ...base, kind: "動作", description: String(d.description ?? ""), needsTarget: !!d.needs_target, states: ["通常"] };
  }
  if (!Array.isArray(d.states) || !d.states.length) throw new Error("states がありません。");
  const parts: Record<string, Part[]> = {};
  for (const s of d.states) {
    if (!Array.isArray(s.parts) || !s.parts.length) throw new Error(`状態「${s.name}」に parts がありません。`);
    parts[String(s.name)] = s.parts.map((p: any, i: number) => parsePart(p, `状態「${s.name}」の部品${i + 1}`));
  }
  return { ...base, kind: d.kind, parts, states: Object.keys(parts) };
}

const files = import.meta.glob("/assets/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type Catalog = { assets: Asset[]; byId: Map<string, Asset>; errors: string[] };
export function buildCatalog(input: Record<string, string>): Catalog {
  const assets: Asset[] = [], errors: string[] = [], byId = new Map<string, Asset>();
  for (const source of Object.keys(input).sort()) {
    try {
      const a = parseAsset(input[source], source);
      if (byId.has(a.id)) throw new Error(`id「${a.id}」が重複しています。`);
      byId.set(a.id, a); assets.push(a);
    } catch (e) { errors.push(`${source}: ${(e as Error).message}`); }
  }
  for (const a of [...assets]) if (a.kind === "場所") {
    for (const ref of [...a.items, ...a.scatter]) {
      const t = byId.get(ref.asset);
      if (!t || !("parts" in t)) errors.push(`${a.source}: 素材「${ref.asset}」が見つかりません。`);
      else if ("state" in ref && ref.state && !t.parts[ref.state]) errors.push(`${a.source}: ${ref.asset} に状態「${ref.state}」がありません。`);
    }
    a.items = a.items.filter(i => byId.get(i.asset) && "parts" in byId.get(i.asset)! && (!i.state || (byId.get(i.asset) as ModelAsset).parts[i.state]));
    a.scatter = a.scatter.filter(s => byId.get(s.asset) && "parts" in byId.get(s.asset)!);
  }
  const order = (k: Kind) => KINDS.indexOf(k);
  assets.sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name, "ja"));
  return { assets, byId, errors };
}
export const catalog = buildCatalog(files);
export const ofKind = <K extends Kind>(kind: K) => catalog.assets.filter(a => a.kind === kind) as Extract<Asset, { kind: K }>[];
export const characterByName = (name: string) => ofKind("人物").find(c => c.name === name);
export const placeByName = (name: string) => ofKind("場所").find(p => p.name === name);
export const looksOf = (c: CharacterAsset, state: string): Look => (c.looks.find(l => l.name === state) ?? c.looks[0]).look;
