import { describe, it, expect, vi } from "vitest";
import { floatTo16BitPCM, int16ToBase64, PcmChunker } from "./pcm";

describe("floatTo16BitPCM", () => {
  it("converts full-scale values with clipping", () => {
    const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 1.5, -1.5]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768]);
  });

  it("scales mid-range values", () => {
    const out = floatTo16BitPCM(new Float32Array([0.5, -0.5]));
    expect(out[0]).toBe(16383); // floor(0.5 * 32767)
    expect(out[1]).toBe(-16384); // floor(-0.5 * 32768)
  });
});

describe("int16ToBase64", () => {
  it("encodes little-endian bytes", () => {
    // 0x0102 little-endian => bytes [0x02, 0x01]
    const b64 = int16ToBase64(new Int16Array([0x0102]));
    expect(atob(b64)).toBe("\x02\x01");
  });
});

describe("PcmChunker", () => {
  it("emits a base64 chunk once the sample threshold is reached", () => {
    const onChunk = vi.fn();
    const chunker = new PcmChunker(256, onChunk);
    chunker.push(new Float32Array(128)); // below threshold
    expect(onChunk).not.toHaveBeenCalled();
    chunker.push(new Float32Array(128)); // reaches 256
    expect(onChunk).toHaveBeenCalledTimes(1);
    const decoded = atob(onChunk.mock.calls[0][0]);
    expect(decoded.length).toBe(512); // 256 samples * 2 bytes
  });

  it("flush emits the remainder and resets", () => {
    const onChunk = vi.fn();
    const chunker = new PcmChunker(256, onChunk);
    chunker.push(new Float32Array(100));
    chunker.flush();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(atob(onChunk.mock.calls[0][0]).length).toBe(200);
    chunker.flush(); // nothing buffered — no extra emit
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it("discard drops buffered samples without emitting", () => {
    const onChunk = vi.fn();
    const chunker = new PcmChunker(256, onChunk);
    chunker.push(new Float32Array(100));
    chunker.discard();
    chunker.flush();
    expect(onChunk).not.toHaveBeenCalled();
  });
});
