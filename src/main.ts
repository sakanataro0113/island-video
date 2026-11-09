import { CAMERAS, TIMES, VERBS, parseScript, type Script } from "./script";
import { catalog, ofKind } from "./assets";
import { Gallery } from "./gallery";
import { Renderer, drawSubtitle } from "./render";
import { exportMp4, saveFile, type ExportResult } from "./export";
import yaml from "js-yaml";
import { VoicePlayer, mixVoices, prepareVoices, voiceErrors, type Progress } from "./voice";
import { loadSettings, onSettingsChange } from "./settings";
import { VoicePages, type Line } from "./voice-pages";
import { SubtitleEditor } from "./subtitle-editor";
import { fontString, loadStyle, onStyleChange, style } from "./subtitle-style";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gl = $<HTMLCanvasElement>("gl"), overlay = $<HTMLCanvasElement>("overlay"), text = $<HTMLTextAreaElement>("text");
const seek = $<HTMLInputElement>("seek"), clock = $<HTMLOutputElement>("clock"), play = $<HTMLButtonElement>("play"), message = $<HTMLParagraphElement>("message");

$("vocab").innerHTML = ([["人物", ofKind("人物").map(c => c.name)], ["場所", ofKind("場所").map(p => p.name)], ["時間帯", TIMES], ["カメラ", CAMERAS], ["動作", VERBS]] as const).map(([k, v]) => `<dt>${k}</dt><dd>${v.join("、")}</dd>`).join("");

function say(msg: string, error = false) { message.textContent = msg; message.classList.toggle("error", error); }
let settingsReady = false;
const settingsLoaded = loadSettings();
let renderer: Renderer, script: Script, time = 0, playing = false, last = 0, voiceGen = 0, voiceNote = "";
const voiceBox = $<HTMLInputElement>("voice"), player = new VoicePlayer();
const voiceOn = () => voiceBox.checked;

function show(t: number) {
  time = t;
  renderer.render(script, t);
  drawSubtitle(overlay, script, t);
  seek.value = String(t);
  clock.textContent = `${t.toFixed(1)}秒`;
}
function apply(): boolean {
  try { script = parseScript(text.value, voiceOn()); }
  catch (e) { say((e as Error).message, true); return false; }
  seek.max = String(script.duration);
  report();
  show(Math.min(time, script.duration));
  void refreshVoice();
  return true;
}
function report() {
  const spoken = script.scenes.filter(s => s.voice).length;
  say(`「${script.title}」 ${script.scenes.length}シーン、${script.duration.toFixed(1)}秒` + (voiceOn() ? `、読み上げ ${spoken}カット` : "、音声なし") + (voiceNote ? "\n" + voiceNote : ""), !!voiceNote);
}
/** 音声づくりの進み具合を、映像の下に表示する。動いていることが分かるよう、経過秒も毎秒更新する。 */
const status = { box: $("voice-status"), title: $("vs-title"), count: $<HTMLOutputElement>("vs-count"), fill: $("vs-fill"), now: $("vs-now") };
let statusTimer = 0, statusStart = 0, statusLast: Progress | null = null, statusHide = 0;
function showProgress(p: Progress) {
  clearTimeout(statusHide);
  if (!statusTimer) { statusStart = performance.now(); statusTimer = window.setInterval(() => statusLast && drawProgress(statusLast), 500); }
  statusLast = p; drawProgress(p);
}
function drawProgress(p: Progress) {
  const sec = Math.floor((performance.now() - statusStart) / 1000);
  status.box.hidden = false; status.box.dataset.state = "working";
  status.title.textContent = "音声を作成中";
  status.count.textContent = `${p.done} / ${p.total}(${sec}秒)`;
  status.fill.style.width = `${p.total ? Math.max(3, p.done / p.total * 100) : 0}%`;
  status.now.textContent = p.working.length ? "いま作っている文: " + p.working.map(t => `「${t.length > 18 ? t.slice(0, 18) + "…" : t}」`).join(" ") : "";
}
function endProgress(error?: string) {
  clearInterval(statusTimer); statusTimer = 0;
  if (!statusLast) return;
  const p = statusLast; statusLast = null;
  status.box.dataset.state = error ? "error" : "done";
  status.title.textContent = error ? "音声を作れませんでした" : "音声がそろいました";
  status.count.textContent = `${p.done} / ${p.total}`;
  status.fill.style.width = `${p.total ? p.done / p.total * 100 : 100}%`;
  status.now.textContent = error ?? "";
  if (!error) statusHide = window.setTimeout(() => { status.box.hidden = true; }, 2500);
}
/** 足りない音声を取りに行き、そろったらカットの長さを音声に合わせ直す。 */
async function refreshVoice(): Promise<boolean> {
  if (!voiceOn() || !script) { endProgress(); status.box.hidden = true; return true; }
  // 保存した声の設定が届く前に作ると、使わない声の分まで料金がかかるため待つ
  if (!settingsReady) { status.box.hidden = false; status.box.dataset.state = "working"; status.title.textContent = "声の設定を読み込み中"; status.count.textContent = ""; status.fill.style.width = "0%"; status.now.textContent = ""; return settingsLoaded.then(() => refreshVoice()); }
  const gen = ++voiceGen, wanted = script.scenes.flatMap(s => s.voice ? [s.voice] : []);
  try {
    const made = await prepareVoices(wanted, p => { if (gen === voiceGen) showProgress(p); });
    voiceNote = "";
    if (gen !== voiceGen) return true;
    endProgress();
    if (made || script.scenes.some(s => s.voice)) {
      const wasPlaying = playing; if (wasPlaying) setPlaying(false);
      script = parseScript(text.value, true); seek.max = String(script.duration); report(); show(Math.min(time, script.duration));
      if (wasPlaying) setPlaying(true);
    }
    return true;
  } catch (e) {
    if (gen === voiceGen) { voiceNote = "音声を用意できませんでした: " + (e as Error).message; endProgress((e as Error).message); report(); }
    return false;
  }
}
function setPlaying(v: boolean) {
  playing = v; play.textContent = v ? "停止" : "再生";
  if (v) { last = performance.now(); if (voiceOn()) player.play(script.scenes, time); requestAnimationFrame(tick); }
  else player.stop();
}
function tick(now: number) {
  if (!playing) return;
  const next = time + (now - last) / 1000; last = now;
  if (next >= script.duration) { show(script.duration); setPlaying(false); return; }
  show(next); requestAnimationFrame(tick);
}
play.onclick = () => { if (!playing && time >= script.duration) show(0); setPlaying(!playing); };
seek.oninput = () => { setPlaying(false); show(Number(seek.value)); };
voiceBox.onchange = () => { setPlaying(false); voiceNote = ""; apply(); };
$("apply").onclick = () => { setPlaying(false); if (apply()) show(0); };
$<HTMLInputElement>("file").onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  text.value = await f.text(); setPlaying(false); if (apply()) show(0);
};

const exportBtn = $<HTMLButtonElement>("export"), saveBtn = $<HTMLButtonElement>("save"), progress = $<HTMLProgressElement>("progress");
let abort: AbortController | null = null, result: ExportResult | null = null, resultTitle = "";

async function subtitleFontReady(): Promise<boolean> {
  const chars = script.title + script.scenes.map(s => s.narration).join("");
  try { await Promise.all([document.fonts.load(`700 40px "Noto Sans JP"`, chars), document.fonts.load(fontString(40), chars)]); } catch { return false; }
  return [...document.fonts].some(f => f.family.replace(/"/g, "") === style.font && f.status === "loaded");
}
exportBtn.onclick = async () => {
  if (abort) { abort.abort(); return; }
  if (!apply()) return;
  setPlaying(false);
  result = null; saveBtn.hidden = true;
  abort = new AbortController();
  exportBtn.textContent = "中止"; play.disabled = true; seek.disabled = true; progress.hidden = false; progress.value = 0;
  try {
    const fontOk = await subtitleFontReady();
    if (voiceOn() && !(await refreshVoice())) throw new Error(voiceNote + "\n「音声」のチェックを外すと、音声なしで書き出せます。");
    const current = script;
    const audio = voiceOn() && current.scenes.some(s => s.voice) ? await mixVoices(current.scenes, current.duration) : null;
    const out = await exportMp4(renderer, overlay, gl, current, audio, (done, total) => { progress.value = done / total; say(`書き出し中: ${done} / ${total}コマ`); }, abort.signal);
    result = out; resultTitle = current.title;
    saveBtn.hidden = false;
    const mb = (out.data.length / 1048576).toFixed(1);
    const notes = [out.codec === "H.264" ? "" : "このブラウザではH.264を使えなかったため、一部のアプリで再生できない可能性があります。", fontOk ? "" : "字幕の専用フォントを読み込めず、PCの標準フォントで書き出しました。"].filter(Boolean).join("\n");
    say(`書き出し完了: 1080×1920、30fps、${out.seconds.toFixed(1)}秒、${out.codec}${out.audio ? "、音声 " + out.audio : "、音声なし"}、${mb}MB${notes ? "\n" + notes : ""}`);
  } catch (e) {
    if ((e as Error).name === "AbortError") say("書き出しを中止しました。");
    else say("書き出しできませんでした: " + (e as Error).message, true);
  } finally {
    abort = null; exportBtn.textContent = "MP4を書き出す"; play.disabled = false; seek.disabled = false; progress.hidden = true;
    show(Math.min(time, script.duration));
  }
};
saveBtn.onclick = async () => {
  if (!result) return;
  const name = resultTitle.replace(/[\\/:*?"<>|]/g, "_") + ".mp4";
  try { await saveFile(name, result.data); say(`「${name}」を保存しました。`); }
  catch (e) { const code = (e as any)?.code; say(code === "declined" || code === "cancelled" ? "保存を取り消しました。もう一度保存できます。" : "保存できませんでした: " + ((e as Error).message ?? e), code !== "declined" && code !== "cancelled"); }
};
document.fonts?.load(`700 40px "Noto Sans JP"`, "小さな島").then(() => { if (script) show(time); }).catch(() => {});

const episodes = import.meta.glob("/episodes/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const picker = $<HTMLSelectElement>("episode");
for (const path of Object.keys(episodes).sort()) { const o = document.createElement("option"); o.value = path; o.textContent = episodes[path].match(/^title:\s*(.+)$/m)?.[1] ?? path; picker.append(o); }
picker.onchange = () => { text.value = episodes[picker.value]; setPlaying(false); if (renderer && apply()) show(0); };
text.value = episodes[picker.value] ?? "";
try { renderer = new Renderer(gl); apply(); }
catch (e) { say((e as Error).message, true); }
let gallery: Gallery | null = null;
const lines: Line[] = Object.keys(episodes).sort().flatMap(path => {
  try {
    const ep: any = yaml.load(episodes[path]!), name = String(ep?.title ?? path).replace(/^(第\d+話).*$/, "$1");
    return (ep?.scenes ?? []).flatMap((s: any, i: number) => s?.narration ? [{ episode: name, cut: i + 1, speaker: s.speaker, narration: String(s.narration) }] : []);
  } catch { return []; }
});
const people = ofKind("人物").map(a => ({ name: a.name, tags: a.tags }));
for (const sp of new Set(lines.flatMap(l => l.speaker ? [l.speaker] : []))) if (!people.some(p => p.name === sp)) people.push({ name: sp, tags: [] });
const pages = new VoicePages(lines, people);
const VIEWS = ["video", "assets", "voices", "readings"] as const;
function route() {
  const view = VIEWS.find(v => location.hash === "#" + v) ?? "video";
  for (const v of VIEWS) {
    $("view-" + v).hidden = v !== view;
    if (v === view) $("tab-" + v).setAttribute("aria-current", "page"); else $("tab-" + v).removeAttribute("aria-current");
  }
  if (view !== "video") setPlaying(false);
  if (view === "assets") {
    try { if (!gallery) gallery = new Gallery(() => script); else gallery.draw(); }
    catch (e) { $("asset-errors").hidden = false; $("asset-errors").textContent = (e as Error).message; }
  }
  if (view === "voices" || view === "readings") pages.show();
}
window.addEventListener("hashchange", route);
route();
if (catalog.errors.length) say(say_errors(), true);
if (voiceErrors.length) say(voiceErrors.join("\n"), true);
// 声や読み方を保存したら、映像タブの台本を読み直す(変わった文だけ作り直す)
onSettingsChange(() => { settingsReady = true; if (!renderer) return; setPlaying(false); voiceNote = ""; apply(); });
function say_errors() { return "読み込めなかった素材があります:\n" + catalog.errors.join("\n"); }
// 字幕の見た目: 変えたらプレビューを描き直す。保存済みの見た目を読み込む
const subEditor = new SubtitleEditor($("frame"), () => setPlaying(false));
onStyleChange(() => { if (renderer && script) show(time); document.fonts?.load(fontString(40), "小さな島").then(() => { if (renderer && script) show(time); }).catch(() => {}); });
void loadStyle().then(note => subEditor.loaded(note));
(window as any).__sim = { show, get script() { return script; }, get gallery() { return gallery; }, catalog };
