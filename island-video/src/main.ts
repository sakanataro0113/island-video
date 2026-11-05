import { CAMERAS, PLACES, SAMPLE, TIMES, VERBS, parseScript, type Script } from "./script";
import { Renderer, drawSubtitle } from "./render";
import { exportMp4, saveFile, type ExportResult } from "./export";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gl = $<HTMLCanvasElement>("gl"), overlay = $<HTMLCanvasElement>("overlay"), text = $<HTMLTextAreaElement>("text");
const seek = $<HTMLInputElement>("seek"), clock = $<HTMLOutputElement>("clock"), play = $<HTMLButtonElement>("play"), message = $<HTMLParagraphElement>("message");

$("vocab").innerHTML = ([["場所", PLACES], ["時間帯", TIMES], ["カメラ", CAMERAS], ["動作", VERBS]] as const).map(([k, v]) => `<dt>${k}</dt><dd>${v.join("、")}</dd>`).join("");

function say(msg: string, error = false) { message.textContent = msg; message.classList.toggle("error", error); }
let renderer: Renderer, script: Script, time = 0, playing = false, last = 0;

function show(t: number) {
  time = t;
  renderer.render(script, t);
  drawSubtitle(overlay, script, t);
  seek.value = String(t);
  clock.textContent = `${t.toFixed(1)}秒`;
}
function apply(): boolean {
  try { script = parseScript(text.value); }
  catch (e) { say((e as Error).message, true); return false; }
  seek.max = String(script.duration);
  say(`「${script.title}」 ${script.scenes.length}シーン、${script.duration}秒`);
  show(Math.min(time, script.duration));
  return true;
}
function setPlaying(v: boolean) { playing = v; play.textContent = v ? "停止" : "再生"; if (v) { last = performance.now(); requestAnimationFrame(tick); } }
function tick(now: number) {
  if (!playing) return;
  const next = time + (now - last) / 1000; last = now;
  if (next >= script.duration) { show(script.duration); setPlaying(false); return; }
  show(next); requestAnimationFrame(tick);
}
play.onclick = () => { if (!playing && time >= script.duration) show(0); setPlaying(!playing); };
seek.oninput = () => { setPlaying(false); show(Number(seek.value)); };
$("apply").onclick = () => { setPlaying(false); if (apply()) show(0); };
$<HTMLInputElement>("file").onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  text.value = await f.text(); setPlaying(false); if (apply()) show(0);
};

const exportBtn = $<HTMLButtonElement>("export"), saveBtn = $<HTMLButtonElement>("save"), progress = $<HTMLProgressElement>("progress");
let abort: AbortController | null = null, result: ExportResult | null = null, resultTitle = "";

async function subtitleFontReady(): Promise<boolean> {
  const chars = script.title + script.scenes.map(s => s.narration).join("");
  try { await document.fonts.load(`700 40px "Noto Sans JP"`, chars); } catch { return false; }
  return [...document.fonts].some(f => f.family.includes("Noto Sans JP") && f.status === "loaded");
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
    const current = script;
    const out = await exportMp4(renderer, overlay, gl, current, (done, total) => { progress.value = done / total; say(`書き出し中: ${done} / ${total}コマ`); }, abort.signal);
    result = out; resultTitle = current.title;
    saveBtn.hidden = false;
    const mb = (out.data.length / 1048576).toFixed(1);
    const notes = [out.codec === "H.264" ? "" : "このブラウザではH.264を使えなかったため、一部のアプリで再生できない可能性があります。", fontOk ? "" : "字幕の専用フォントを読み込めず、PCの標準フォントで書き出しました。"].filter(Boolean).join("\n");
    say(`書き出し完了: 1080×1920、30fps、${out.seconds.toFixed(1)}秒、${out.codec}、${mb}MB${notes ? "\n" + notes : ""}`);
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

text.value = SAMPLE;
try { renderer = new Renderer(gl); apply(); }
catch (e) { say((e as Error).message, true); }
(window as any).__sim = { show, get script() { return script; } };
