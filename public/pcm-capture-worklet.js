/* global AudioWorkletProcessor, registerProcessor */
// AudioWorklet processor: forwards mono Float32 frames to the main thread.
// Registered as "pcm-capture"; loaded from use-realtime via audioWorklet.addModule.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      // Copy — the engine reuses the underlying buffer between calls.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
