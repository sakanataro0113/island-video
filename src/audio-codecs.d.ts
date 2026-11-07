// TypeScript 5.6 の DOM 型に AudioEncoder がないため、使う分だけ宣言する。
interface AudioEncoderConfig { codec: string; sampleRate: number; numberOfChannels: number; bitrate?: number }
interface AudioDataInit { format: "f32-planar"; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: BufferSource }
declare class AudioData { constructor(init: AudioDataInit); close(): void }
declare class AudioEncoder {
  constructor(init: { output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void; error: (e: DOMException) => void });
  readonly state: "unconfigured" | "configured" | "closed";
  configure(config: AudioEncoderConfig): void; encode(data: AudioData): void; flush(): Promise<void>; close(): void;
  static isConfigSupported(config: AudioEncoderConfig): Promise<{ supported?: boolean }>;
}
