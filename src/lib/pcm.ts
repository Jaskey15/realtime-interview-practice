export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  // Chunk to avoid call-stack limits on large arrays
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Accumulates Float32 audio frames and emits base64 PCM16 chunks of
 * `chunkSamples` samples. Call flush() at utterance end, discard() on barge-in.
 */
export class PcmChunker {
  private buffer: Float32Array;
  private length = 0;

  constructor(
    private chunkSamples: number,
    private onChunk: (base64: string) => void,
  ) {
    this.buffer = new Float32Array(chunkSamples);
  }

  push(frame: Float32Array): void {
    let offset = 0;
    while (offset < frame.length) {
      const take = Math.min(frame.length - offset, this.chunkSamples - this.length);
      this.buffer.set(frame.subarray(offset, offset + take), this.length);
      this.length += take;
      offset += take;
      if (this.length === this.chunkSamples) this.emit();
    }
  }

  flush(): void {
    if (this.length > 0) this.emit();
  }

  discard(): void {
    this.length = 0;
  }

  private emit(): void {
    const samples = floatTo16BitPCM(this.buffer.subarray(0, this.length));
    this.length = 0;
    this.onChunk(int16ToBase64(samples));
  }
}
