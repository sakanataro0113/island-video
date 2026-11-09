import { VOICE_LIST, VOICE_NAME, applySpots, engine, paramsOf, plainText, playSample, prepareOne, stopSample, type Entry, type Settings, type Spot } from "./voice";
import { draftOf, onSettingsChange, same, saveSettings, source, sourceNote } from "./settings";
import { settings } from "./voice";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag); const { class: c, ...rest } = props as any;
  if (c) e.className = c; Object.assign(e, rest); e.append(...kids); return e;
};

/** 台本の1文。どの話の、誰の文か。 */
export type Line = { episode: string; cut: number; speaker?: string; narration: string };
type Person = { name: string; tags: string[] };
const NARRATOR = "語り";
const CUSTOM = "__custom";

/** 「音声一覧」と「読み方」のページ。どちらも同じ下書きを編集し、保存すると両方に効く。 */
export class VoicePages {
  private draft: Settings = draftOf();
  private status = "";
  private statusError = false;
  private built = false;
  /** 下書きを作ったときの設定。編集していなければ、新しく読み込んだ設定に置き換える。 */
  private base: Settings = draftOf();
  constructor(private lines: Line[], private people: Person[]) {
    onSettingsChange(() => {
      if (same(this.draft, this.base)) { this.draft = draftOf(); this.base = draftOf(); if (this.built) this.build(true); }
      else this.refresh();
    });
    for (const page of ["view-voices", "view-readings"]) {
      const root = $(page);
      root.querySelector<HTMLButtonElement>(".save")!.onclick = () => void this.save();
      root.querySelector<HTMLButtonElement>(".revert")!.onclick = () => { this.draft = draftOf(); this.base = draftOf(); this.status = ""; this.build(true); };
    }
    window.addEventListener("beforeunload", e => { if (this.dirty()) e.preventDefault(); });
  }
  dirty() { return !same(this.draft, settings); }
  /** 表示する。初回だけ組み立てる。 */
  show() { if (!this.built) this.build(true); else this.refresh(); }
  private async save() {
    this.status = "保存しています…"; this.statusError = false; this.refresh();
    try { await saveSettings(this.draft); this.draft = draftOf(); this.base = draftOf(); this.status = "保存しました。映像タブの読み上げに反映しました。"; }
    catch (e) { this.status = "保存できませんでした: " + (e as Error).message; this.statusError = true; }
    this.build(true);
  }
  /** 保存の状態と、台本での件数などを更新する。 */
  private refresh() {
    const dirty = this.dirty();
    const base = dirty ? "保存していない変更があります。" : source === "saved" ? "保存済みの設定を使っています。" : source === "default" ? "まだ一度も保存していません。voices.yaml の初期値を使っています。" : "";
    for (const page of ["view-voices", "view-readings"]) {
      const root = $(page), p = root.querySelector<HTMLParagraphElement>(".save-state")!;
      p.textContent = [this.status || base, source === "unavailable" ? sourceNote : ""].filter(Boolean).join("\n");
      p.classList.toggle("error", this.statusError || source === "unavailable");
      root.querySelector<HTMLButtonElement>(".save")!.disabled = !dirty;
      root.querySelector<HTMLButtonElement>(".revert")!.hidden = !dirty;
    }
    this.updateReadCount();
  }
  private changed() { this.status = ""; this.statusError = false; this.refresh(); }
  private build(force = false) {
    if (this.built && !force) return;
    this.built = true;
    this.buildVoices(); this.buildReadings(); this.refresh();
  }

  // ---- 音声一覧 ----
  private buildVoices() {
    $("view-voices").querySelector(".engine-note")!.textContent = engine.engine === "chirp"
      ? "いまは Chirp 3: HD(voices.yaml の engine: chirp)で読み上げています。話し方の指示は使われません。"
      : `いまは ${engine.model} で読み上げています。試聴も1回ごとに少額の料金がかかります(1文で0.1円前後)。同じ文と設定の試聴は、2回目から無料です。`;
    const rows = $("voice-rows"); rows.replaceChildren();
    rows.append(this.voiceRow(NARRATOR, ["歴史家"], this.lines.filter(l => !l.speaker)));
    for (const p of this.people) rows.append(this.voiceRow(p.name, p.tags, this.lines.filter(l => l.speaker === p.name)));
  }
  private entryOf(who: string): Entry | undefined { return who === NARRATOR ? this.draft.narrator : this.draft.characters[who]; }
  private setEntry(who: string, e: Entry | undefined) {
    if (who === NARRATOR) { if (e) this.draft.narrator = e; }
    else if (e) this.draft.characters[who] = e; else delete this.draft.characters[who];
    this.changed();
  }
  private voiceRow(who: string, tags: string[], lines: Line[]) {
    const id = "v-" + [...who].map(c => c.charCodeAt(0).toString(36)).join("");
    const e = this.entryOf(who), known = !e || VOICE_LIST.some(v => v.name === e.voice);
    const select = el("select", { id: id + "-voice" });
    if (who !== NARRATOR) select.append(el("option", { value: "", textContent: "読み上げない(字幕のみ)" }));
    for (const g of ["男性", "女性"] as const) {
      const group = el("optgroup", { label: g });
      for (const v of VOICE_LIST.filter(v => v.gender === g)) group.append(el("option", { value: v.name, textContent: `${v.name} — ${v.feel}` }));
      select.append(group);
    }
    select.append(el("option", { value: CUSTOM, textContent: "Voice design で作った声(ID を入力)" }));
    select.value = !e ? "" : known ? e.voice : CUSTOM;
    const custom = el("input", { id: id + "-id", type: "text", placeholder: "voice_…", value: e && !known ? e.voice : "", hidden: !(e && !known) });
    custom.setAttribute("aria-label", `${who}の声の ID`);
    const style = el("input", { id: id + "-style", type: "text", value: e?.style ?? "", placeholder: who === NARRATOR ? "例: Narration" : "例: 落ち着いた低い声で、ゆっくり", maxLength: 300, disabled: !e || engine.engine === "chirp" });
    const sampleDefault = plainText(lines[0]?.narration ?? (who === NARRATOR ? "この約束が守られたのは、わずか二年だった。" : `わしは${who}だ。`));
    const sample = el("input", { id: id + "-sample", type: "text", value: sampleDefault, disabled: !e });
    const playBtn = el("button", { type: "button", textContent: "試聴", disabled: !e });
    const note = el("p", { class: "hint" });
    const read = el("p", { class: "hint" });
    const showRead = () => { const t = applySpots(plainText(sample.value), this.draft.spots); read.textContent = t !== plainText(sample.value) ? `読ませる文: ${t}` : ""; };
    showRead();
    const current = (): Entry | undefined => {
      const v = select.value === CUSTOM ? custom.value.trim() : select.value;
      return v ? { voice: v, style: style.value.trim() } : undefined;
    };
    const update = () => {
      custom.hidden = select.value !== CUSTOM;
      const next = current(), ok = !next || VOICE_NAME.test(next.voice);
      style.disabled = sample.disabled = playBtn.disabled = !next || !ok;
      if (engine.engine === "chirp") style.disabled = true;
      note.textContent = next && !ok ? "ID は voice_ で始まる英数字です。" : "";
      note.classList.toggle("error", !!next && !ok);
      if (ok) this.setEntry(who, next);
    };
    select.onchange = () => { if (select.value === CUSTOM) custom.focus(); update(); };
    custom.oninput = style.oninput = update;
    sample.oninput = showRead;
    playBtn.onclick = async () => {
      const next = current(), params = next && paramsOf(next), text = applySpots(plainText(sample.value), this.draft.spots);
      if (!params || !text) return;
      if (playBtn.dataset.state === "playing") { stopSample(); return; }
      playBtn.disabled = true; playBtn.dataset.state = "loading"; playBtn.replaceChildren(el("span", { class: "spinner small" }), "作成中…"); note.textContent = ""; note.classList.remove("error");
      try {
        const buf = await prepareOne({ params, text });
        playBtn.dataset.state = "playing"; playBtn.textContent = "停止"; playBtn.disabled = false;
        playSample(buf, () => { playBtn.dataset.state = ""; playBtn.textContent = "試聴"; });
      } catch (err) {
        note.textContent = "試聴できませんでした: " + (err as Error).message; note.classList.add("error");
        playBtn.dataset.state = ""; playBtn.textContent = "試聴"; playBtn.disabled = false;
      }
    };
    const field = (label: string, input: HTMLElement, ...extra: Node[]) => el("div", { class: "field" }, el("label", { class: "lab", htmlFor: input.id, textContent: label }), input, ...extra);
    return el("section", { class: "voice-row" },
      el("header", {}, el("h2", { textContent: who === NARRATOR ? "語り(歴史家)" : who }), el("span", { class: "tags", textContent: tags.join("・") }), el("span", { class: "count", textContent: `台本の${who === NARRATOR ? "語り" : "セリフ"} ${lines.length}件` })),
      el("div", { class: "fields" },
        field("声", select, custom),
        field("話し方の指示", style),
        el("div", { class: "field wide" }, el("label", { class: "lab", htmlFor: sample.id, textContent: "試聴する文" }), el("div", { class: "try-row" }, sample, playBtn), read, note)));
  }

  // ---- 読み方 ----
  private readEpisode = "";
  private editing: { key: string; li: HTMLLIElement } | null = null;
  private buildReadings() {
    const pick = $<HTMLSelectElement>("read-episode"), only = $<HTMLInputElement>("read-changed");
    const episodes = [...new Set(this.lines.map(l => l.episode))];
    if (!pick.options.length) {
      for (const e of episodes) pick.append(el("option", { value: e, textContent: e }));
      pick.append(el("option", { value: "", textContent: "すべての話" }));
      this.readEpisode = episodes[0] ?? "";
      pick.value = this.readEpisode;
      pick.onchange = () => { this.readEpisode = pick.value; this.renderLines(); };
      only.onchange = () => this.renderLines();
    }
    this.renderLines();
  }
  private shown(): Line[] {
    const only = $<HTMLInputElement>("read-changed").checked;
    return this.lines.filter(l => (!this.readEpisode || l.episode === this.readEpisode) && (!only || this.draft.spots[plainText(l.narration)]?.length));
  }
  private renderLines() {
    this.editing = null;
    const list = $("read-lines"); list.replaceChildren();
    const lines = this.shown();
    if (!lines.length) list.append(el("li", { class: "empty", textContent: "該当する文はありません。" }));
    for (const l of lines) list.append(this.lineBlock(l));
    this.updateReadCount();
  }
  private updateReadCount() {
    const out = $("read-count"); if (!out) return;
    const lines = this.lines.filter(l => !this.readEpisode || l.episode === this.readEpisode);
    out.textContent = `${lines.length}文のうち、読みを変えた文 ${lines.filter(l => this.draft.spots[plainText(l.narration)]?.length).length}`;
  }
  /** 同じ文(字幕の飾りを除いて同じ)のブロックを、すべて描き直す。 */
  private redrawKey(key: string) {
    for (const li of $("read-lines").querySelectorAll<HTMLLIElement>("li.read-line")) if (li.dataset.key === key) li.replaceWith(this.lineBlock(this.lines[Number(li.dataset.index)]!));
    this.updateReadCount();
  }
  private lineBlock(l: Line): HTMLLIElement {
    const key = plainText(l.narration), spots = this.draft.spots[key] ?? [];
    const li = el("li", { class: "read-line" }); li.dataset.key = key; li.dataset.index = String(this.lines.indexOf(l));
    const entry = l.speaker ? this.draft.characters[l.speaker] : this.draft.narrator, params = entry && paramsOf(entry);
    const play = el("button", { type: "button", class: "small", textContent: "試聴", disabled: !params, title: params ? "" : "この人物は読み上げない設定です(音声一覧タブで変えられます)" });
    const editBtn = el("button", { type: "button", class: "plain", textContent: "読みを変える" });
    const text = el("p", { class: "rl-text" }); text.setAttribute("aria-label", key);
    const chars = [...key];
    for (let i = 0; i < chars.length;) {
      const sp = spots.find(p => p.start === i);
      if (sp) {
        const r = el("ruby", { class: "spot", title: `「${chars.slice(i, i + sp.length).join("")}」を「${sp.to}」と読む。クリックで編集` }, chars.slice(i, i + sp.length).join(""), el("rt", { textContent: sp.to }));
        r.dataset.start = String(i); r.dataset.len = String(sp.length); text.append(r); i += sp.length;
      } else { const c = el("span", { class: "ch", textContent: chars[i] }); c.dataset.i = String(i); text.append(c); i++; }
    }
    const speech = applySpots(key, this.draft.spots);
    const dup = this.lines.filter(x => x !== l && plainText(x.narration) === key).length;
    li.append(
      el("div", { class: "rl-head" }, el("span", { class: "where", textContent: `${l.episode} カット${l.cut}` }), el("span", { class: l.speaker ? "who line" : "who", textContent: l.speaker ?? "語り" }), el("span", { class: "grow" }), editBtn, play),
      text,
      speech !== key ? el("p", { class: "rl-speech", textContent: `読ませる文: ${speech}` }) : "",
      dup ? el("p", { class: "hint", textContent: `同じ文がほかに${dup}か所あり、そちらも同じ読みになります。` }) : "");
    // クリックとドラッグで範囲を選ぶ
    let anchor = -1, head = -1, dragged = false;
    const indexOf = (t: EventTarget | null): { i: number; spot?: Spot } | null => {
      const n = (t as HTMLElement | null)?.closest?.<HTMLElement>("[data-i],[data-start]"); if (!n || !text.contains(n)) return null;
      if (n.dataset.start) { const st = Number(n.dataset.start); return { i: st, spot: spots.find(p => p.start === st) }; }
      return { i: Number(n.dataset.i) };
    };
    const mark = (a: number, b: number) => { const [lo, hi] = a <= b ? [a, b] : [b, a]; text.querySelectorAll<HTMLElement>(".ch").forEach(c => c.classList.toggle("sel", Number(c.dataset.i) >= lo && Number(c.dataset.i) <= hi)); };
    text.onpointerdown = e => { const hit = indexOf(e.target); if (!hit) return; e.preventDefault(); anchor = head = hit.i; dragged = false; if (!hit.spot) mark(anchor, head); };
    text.onpointerover = e => { if (anchor < 0 || !(e.buttons & 1)) return; const hit = indexOf(e.target); if (!hit || hit.spot || hit.i === head) return; head = hit.i; dragged = true; mark(anchor, head); };
    text.onpointerup = e => {
      if (anchor < 0) return;
      const hit = indexOf(e.target), a = anchor; anchor = -1;
      if (!dragged && hit?.spot) { this.openEditor(li, l, key, hit.spot.start, hit.spot.length, hit.spot.to); return; }
      let lo = Math.min(a, head), hi = Math.max(a, head);
      if (!dragged) [lo, hi] = runAround(chars, lo, spots);
      if (spots.some(p => p.start <= hi && lo < p.start + p.length)) { mark(-1, -1); return; } // 読みを変えた箇所にまたがる範囲は選ばない
      this.openEditor(li, l, key, lo, hi - lo + 1, "");
    };
    editBtn.onclick = () => this.openEditor(li, l, key, -1, 0, "");
    play.onclick = () => void this.playLine(play, params!, speech);
    return li;
  }
  private async playLine(btn: HTMLButtonElement, params: Record<string, string>, text: string) {
    if (btn.dataset.state === "playing") { stopSample(); return; }
    btn.disabled = true; btn.replaceChildren(el("span", { class: "spinner small" }), "作成中…");
    try {
      const buf = await prepareOne({ params, text });
      btn.dataset.state = "playing"; btn.textContent = "停止"; btn.disabled = false;
      playSample(buf, () => { btn.dataset.state = ""; btn.textContent = "試聴"; });
    } catch (e) { btn.textContent = "試聴"; btn.disabled = false; btn.title = (e as Error).message; alertNote(btn, "試聴できませんでした: " + (e as Error).message); }
  }
  /** ブロックの下に、読みを編集する欄を開く。start が -1 なら、変える部分を入力してもらう。 */
  private openEditor(li: HTMLLIElement, l: Line, key: string, start: number, length: number, to: string) {
    if (this.editing && this.editing.li !== li) this.editing.li.querySelector(".rl-edit")?.remove(), this.editing.li.querySelectorAll(".sel").forEach(c => c.classList.remove("sel"));
    li.querySelector(".rl-edit")?.remove();
    this.editing = { key, li };
    const chars = [...key], spots = this.draft.spots[key] ?? [], existing = spots.find(p => p.start === start && p.length === length);
    const id = "rl-" + li.dataset.index;
    const part = el("input", { id: id + "-part", type: "text", value: start >= 0 ? chars.slice(start, start + length).join("") : "", maxLength: 50 });
    const occ = el("select", { id: id + "-occ" }); occ.setAttribute("aria-label", "何番目か");
    const reading = el("input", { id: id + "-to", type: "text", value: to, placeholder: "例: おさ", maxLength: 50 });
    const ok = el("button", { type: "button", textContent: "決定" });
    const undo = el("button", { type: "button", class: "plain", textContent: "この箇所を元に戻す", hidden: !existing });
    const close = el("button", { type: "button", class: "plain", textContent: "閉じる" });
    const preview = el("p", { class: "hint" });
    let pos = start;
    const find = () => {
      const p = [...part.value.trim()], hits: number[] = [];
      if (p.length) for (let i = 0; i + p.length <= chars.length; i++) if (chars.slice(i, i + p.length).join("") === p.join("")) hits.push(i);
      occ.replaceChildren(...hits.map((h, n) => el("option", { value: String(h), textContent: `${n + 1}番目(…${chars.slice(Math.max(0, h - 3), h + p.length + 3).join("")}…)` })));
      occ.hidden = hits.length < 2;
      pos = hits.includes(pos) ? pos : hits[0] ?? -1;
      if (pos >= 0) occ.value = String(pos);
      update();
    };
    const update = () => {
      const len = [...part.value.trim()].length;
      li.querySelectorAll<HTMLElement>(".ch").forEach(c => c.classList.toggle("sel", pos >= 0 && Number(c.dataset.i) >= pos && Number(c.dataset.i) < pos + len));
      const clash = pos >= 0 && spots.some(p => p !== existing && p.start < pos + len && pos < p.start + p.length);
      ok.disabled = pos < 0 || !reading.value.trim() || clash;
      preview.classList.toggle("error", (pos < 0 && !!part.value.trim()) || clash);
      preview.textContent = pos < 0 ? (part.value.trim() ? "この文には見つかりません。" : "変える部分を入れるか、文の中をクリックしてください。")
        : clash ? "読みを変えたほかの箇所と重なっています。先にそちらを元に戻してください。"
        : reading.value.trim() ? `読ませる文: ${applySpots(key, { [key]: [...spots.filter(p => p !== existing), { start: pos, length: len, to: reading.value.trim() }] })}` : "読み方を入れてください。";
    };
    part.oninput = find; occ.onchange = () => { pos = Number(occ.value); update(); }; reading.oninput = update;
    const commit = (next: Spot | null) => {
      const rest = spots.filter(p => p !== existing && !(next && p.start < next.start + next.length && next.start < p.start + p.length));
      const all = next ? [...rest, next].sort((a, b) => a.start - b.start) : rest;
      if (all.length) this.draft.spots[key] = all; else delete this.draft.spots[key];
      this.editing = null; this.changed(); this.redrawKey(key);
      $("read-lines").querySelector<HTMLLIElement>(`li[data-index="${li.dataset.index}"]`)?.querySelector<HTMLButtonElement>(".rl-head button.small")?.focus();
    };
    ok.onclick = () => commit({ start: pos, length: [...part.value.trim()].length, to: reading.value.trim() });
    undo.onclick = () => commit(null);
    close.onclick = () => { li.querySelector(".rl-edit")?.remove(); li.querySelectorAll(".sel").forEach(c => c.classList.remove("sel")); this.editing = null; };
    reading.onkeydown = part.onkeydown = e => { if (e.key === "Enter" && !ok.disabled) ok.click(); if (e.key === "Escape") close.click(); };
    li.append(el("div", { class: "rl-edit" },
      el("div", { class: "field" }, el("label", { class: "lab", htmlFor: part.id, textContent: "変える部分" }), el("div", { class: "try-row" }, part, occ)),
      el("div", { class: "field" }, el("label", { class: "lab", htmlFor: reading.id, textContent: "読み方(ひらがな・カタカナ)" }), reading),
      el("div", { class: "rl-actions" }, ok, undo, close), preview));
    find();
    (start >= 0 ? reading : part).focus();
  }
}

/** クリックした文字の前後で、同じ種類の文字(漢字、カタカナ、数字、英字)が続く範囲。ひらがなと記号は1字だけ。 */
function runAround(chars: string[], i: number, spots: Spot[]): [number, number] {
  const kind = (c?: string) => !c ? "" : /[\p{Script=Han}々〆ヶ]/u.test(c) ? "kanji" : /[\p{Script=Katakana}ー]/u.test(c) ? "kata" : /[0-9０-９]/.test(c) ? "num" : /[A-Za-zＡ-Ｚａ-ｚ]/.test(c) ? "latin" : "single";
  const k = kind(chars[i]); if (k === "single") return [i, i];
  const free = (j: number) => !spots.some(p => p.start <= j && j < p.start + p.length);
  let lo = i, hi = i;
  while (lo > 0 && kind(chars[lo - 1]) === k && free(lo - 1)) lo--;
  while (hi < chars.length - 1 && kind(chars[hi + 1]) === k && free(hi + 1)) hi++;
  return [lo, hi];
}
function alertNote(near: HTMLElement, msg: string) {
  const li = near.closest("li"); li?.querySelector(".rl-error")?.remove();
  li?.append(el("p", { class: "hint error rl-error", textContent: msg }));
}
