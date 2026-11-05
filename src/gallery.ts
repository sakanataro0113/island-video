import { catalog, KINDS, type Asset, type Kind } from "./assets";
import { Renderer } from "./render";
import type { Script } from "./script";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const THUMB = 320;

type Filter = { kinds: Set<Kind>; tags: Set<string>; query: string; used: boolean };
const filter: Filter = { kinds: new Set(), tags: new Set(), query: "", used: false };

export function usedIds(script: Script | undefined): Set<string> {
  const out = new Set<string>();
  if (!script) return out;
  for (const scene of script.scenes) {
    for (const a of catalog.assets) {
      if (a.kind === "人物" && scene.cast.includes(a.name)) out.add(a.id);
      if (a.kind === "動作" && scene.actions.some(x => x.verb === a.name)) out.add(a.id);
      if (a.kind === "場所" && a.name === scene.place) {
        out.add(a.id);
        a.items.forEach(i => out.add(i.asset)); a.scatter.forEach(i => out.add(i.asset));
      }
    }
  }
  return out;
}
const matches = (a: Asset, used: Set<string>, ignore?: "kinds" | "tags") => {
  const q = filter.query.trim().toLowerCase();
  return (ignore === "kinds" || !filter.kinds.size || filter.kinds.has(a.kind))
    && (ignore === "tags" || !filter.tags.size || a.tags.some(t => filter.tags.has(t)))
    && (!filter.used || used.has(a.id))
    && (!q || [a.name, a.id, a.kind, ...a.tags, ...a.states].some(v => v.toLowerCase().includes(q)));
};
function chip(label: string, pressed: boolean, id: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.id = id; b.textContent = label;
  b.setAttribute("aria-pressed", String(pressed)); b.onclick = onClick;
  return b;
}

export class Gallery {
  private canvas = document.createElement("canvas");
  private renderer: Renderer;
  private thumbs = new Map<string, HTMLCanvasElement>();
  private anim = 0;
  private current: Asset | null = null;
  private state = "";
  private az = .5;
  private start = 0;
  private drag: number | null = null;
  constructor(private getScript: () => Script | undefined) {
    this.canvas.width = this.canvas.height = THUMB;
    this.renderer = new Renderer(this.canvas);
    $<HTMLInputElement>("asset-search").oninput = e => { filter.query = (e.target as HTMLInputElement).value; this.draw(); };
    $("asset-clear").onclick = () => { filter.kinds.clear(); filter.tags.clear(); filter.used = false; filter.query = ""; $<HTMLInputElement>("asset-search").value = ""; this.draw(); };
    const dialog = $<HTMLDialogElement>("asset-dialog"), view = $<HTMLCanvasElement>("asset-view");
    $("asset-close").onclick = () => dialog.close();
    dialog.addEventListener("close", () => { cancelAnimationFrame(this.anim); this.current = null; this.anim = 0; });
    view.onpointerdown = e => { this.drag = e.clientX; view.setPointerCapture(e.pointerId); };
    view.onpointermove = e => { if (this.drag !== null) { this.az -= (e.clientX - this.drag) * .012; this.drag = e.clientX; } };
    view.onpointerup = () => { this.drag = null; };
    const errors = $("asset-errors");
    errors.hidden = !catalog.errors.length;
    errors.textContent = catalog.errors.length ? "読み込めなかった素材があります:\n" + catalog.errors.join("\n") : "";
    this.draw();
  }
  private thumb(a: Asset): HTMLCanvasElement {
    const known = this.thumbs.get(a.id);
    if (known) return known;
    const t = document.createElement("canvas");
    t.width = t.height = THUMB; t.setAttribute("aria-hidden", "true");
    this.canvas.width = this.canvas.height = THUMB;
    this.renderer.preview(a, a.kind === "場所" ? "昼" : a.states[0], .55, a.kind === "動作" ? 1.5 : 0);
    t.getContext("2d")!.drawImage(this.canvas, 0, 0);
    this.thumbs.set(a.id, t);
    return t;
  }
  draw() {
    const used = usedIds(this.getScript());
    const kinds = $("asset-kinds"), tags = $("asset-tags"), grid = $("asset-grid");
    kinds.replaceChildren(...KINDS.map(k => {
      const n = catalog.assets.filter(a => a.kind === k && matches(a, used, "kinds")).length;
      return chip(`${k} ${n}`, filter.kinds.has(k), `kind-${KINDS.indexOf(k)}`, () => { filter.kinds.has(k) ? filter.kinds.delete(k) : filter.kinds.add(k); this.draw(); });
    }));
    const visibleTags = [...new Set(catalog.assets.filter(a => matches(a, used, "tags")).flatMap(a => a.tags).concat([...filter.tags]))].sort((a, b) => a.localeCompare(b, "ja"));
    tags.replaceChildren(...visibleTags.map((t, i) => chip(t, filter.tags.has(t), `tag-${i}`, () => { filter.tags.has(t) ? filter.tags.delete(t) : filter.tags.add(t); this.draw(); })));
    const usedBtn = $("asset-used");
    usedBtn.setAttribute("aria-pressed", String(filter.used));
    usedBtn.onclick = () => { filter.used = !filter.used; this.draw(); };
    const list = catalog.assets.filter(a => matches(a, used));
    $("asset-count").textContent = `${list.length} / ${catalog.assets.length}件`;
    grid.replaceChildren();
    if (!list.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "条件に合う素材はありません。フィルターを解除してください。"; grid.append(p); return; }
    for (const kind of KINDS) {
      const items = list.filter(a => a.kind === kind);
      if (!items.length) continue;
      const section = document.createElement("section"), h = document.createElement("h2"), row = document.createElement("div");
      h.textContent = `${kind}(${items.length})`; row.className = "tiles";
      for (const a of items) {
        const b = document.createElement("button"), name = document.createElement("strong"), meta = document.createElement("span");
        b.type = "button"; b.className = "tile"; b.dataset.id = a.id;
        name.textContent = a.name; meta.textContent = [...a.tags].join("・") || "タグなし";
        b.append(this.thumb(a), name, meta);
        if (used.has(a.id)) { const u = document.createElement("em"); u.textContent = "台本で使用中"; b.append(u); }
        b.onclick = () => this.open(a);
        row.append(b);
      }
      section.append(h, row); grid.append(section);
    }
  }
  private open(a: Asset) {
    this.current = a; this.state = a.kind === "場所" ? "昼" : a.states[0]; this.az = .55; this.start = performance.now();
    $("asset-title").textContent = a.name;
    $("asset-info").textContent = [a.kind, a.tags.join("・"), a.source.replace(/^\//, "")].filter(Boolean).join(" / ");
    $("asset-raw").textContent = a.raw;
    this.drawStates();
    $<HTMLDialogElement>("asset-dialog").showModal();
    cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(this.loop);
  }
  private drawStates() {
    const a = this.current!, box = $("asset-states");
    box.replaceChildren(...a.states.map((s, i) => chip(s, s === this.state, `state-${i}`, () => { this.state = s; this.drawStates(); })));
  }
  private loop = (now: number) => {
    if (!this.current) return;
    const view = $<HTMLCanvasElement>("asset-view");
    this.canvas.width = this.canvas.height = view.width;
    this.renderer.preview(this.current, this.state, this.az, (now - this.start) / 1000);
    view.getContext("2d")!.drawImage(this.canvas, 0, 0);
    this.anim = requestAnimationFrame(this.loop);
  };
  /** 検証用: 描画結果を返す。 */
  debugOpen(id: string) { const a = catalog.byId.get(id); if (a) this.open(a); }
}
