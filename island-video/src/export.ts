import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { Renderer, drawSubtitle } from "./render";
import type { Script } from "./script";

export const WIDTH = 1080, HEIGHT = 1920, FPS = 30;
const CODECS = [
  { codec: "avc1.640028", mux: "avc", name: "H.264" },
  { codec: "avc1.4d0028", mux: "avc", name: "H.264" },
  { codec: "avc1.42e028", mux: "avc", name: "H.264" },
  { codec: "vp09.00.40.08", mux: "vp9", name: "VP9" },
  { codec: "av01.0.08M.08", mux: "av1", name: "AV1" },
] as const;

export type ExportResult = { data: Uint8Array; codec: string; frames: number; seconds: number };

async function pickCodec() {
  if (typeof VideoEncoder === "undefined") throw new Error("このブラウザは動画の書き出しに対応していません。最新のChromeかEdgeをお試しください。");
  for (const c of CODECS) {
    const config: VideoEncoderConfig = { codec: c.codec, width: WIDTH, height: HEIGHT, bitrate: 8_000_000, framerate: FPS };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return { ...c, config };
  }
  throw new Error("このブラウザで使える動画形式が見つかりませんでした。");
}

/** 1コマずつ描いて書き出す。PCの速さに関係なく、同じ台本から同じコマ列を作る。 */
export async function exportMp4(renderer: Renderer, overlay: HTMLCanvasElement, gl: HTMLCanvasElement, script: Script, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<ExportResult> {
  const picked = await pickCodec();
  const muxer = new Muxer({ target: new ArrayBufferTarget(), fastStart: "in-memory", video: { codec: picked.mux, width: WIDTH, height: HEIGHT, frameRate: FPS } });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = new Error(e.message); } });
  encoder.configure(picked.config);
  const size = [gl.width, gl.height, overlay.width, overlay.height];
  gl.width = overlay.width = WIDTH; gl.height = overlay.height = HEIGHT;
  const out = document.createElement("canvas"); out.width = WIDTH; out.height = HEIGHT;
  const ctx = out.getContext("2d")!;
  const total = Math.max(1, Math.round(script.duration * FPS));
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      if (failure) throw failure;
      const t = i / FPS;
      renderer.render(script, t);
      drawSubtitle(overlay, script, t);
      ctx.drawImage(gl, 0, 0); ctx.drawImage(overlay, 0, 0);
      const frame = new VideoFrame(out, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 2));
      if (i % 5 === 0) { onProgress(i, total); await new Promise(r => setTimeout(r)); }
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    onProgress(total, total);
    return { data: new Uint8Array(muxer.target.buffer), codec: picked.name, frames: total, seconds: total / FPS };
  } finally {
    if (encoder.state !== "closed") encoder.close();
    [gl.width, gl.height, overlay.width, overlay.height] = size;
  }
}

/** 公開ページでは許可を求めてから保存し、Cloudflare版では通常のダウンロードにする。 */
export async function saveFile(filename: string, data: Uint8Array) {
  const claude = (window as any).claude;
  const downloads = claude?.use ? await claude.use("downloads") : null;
  if (downloads) { await downloads.save({ filename, data }); return; }
  const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
