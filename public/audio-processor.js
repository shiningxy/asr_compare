// AudioWorklet processor for real-time audio processing
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioBuffer = [];
    this.BUFFER_SIZE = 1280; // 80ms at 16kHz - recommended send interval
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input.length === 0) {
      return true;
    }

    const inputData = input[0]; // Get first channel
    
    if (!inputData) {
      return true;
    }

    // Check if audio input has signal
    let hasSignal = false;
    for (let i = 0; i < inputData.length; i++) {
      if (Math.abs(inputData[i]) > 0.001) {
        hasSignal = true;
        break;
      }
    }

    if (hasSignal) {
      // Calculate audio level for debugging
      const level = Math.max(...Array.from(inputData).map(Math.abs));
      console.log('[AudioProcessor] Audio signal detected, level:', level);
    }

    // Add to buffer
    this.audioBuffer.push(new Float32Array(inputData));

    // Check if we have enough data to send
    const totalSamples = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    
    if (totalSamples >= this.BUFFER_SIZE) {
      // Combine audio data
      const combinedData = new Float32Array(totalSamples);
      let offset = 0;
      
      for (const buffer of this.audioBuffer) {
        combinedData.set(buffer, offset);
        offset += buffer.length;
      }

      // Convert to PCM16
      const pcm16 = new Int16Array(combinedData.length);
      for (let i = 0; i < combinedData.length; i++) {
        const sample = Math.max(-1, Math.min(1, combinedData[i]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }

      // Send to main thread
      this.port.postMessage({
        type: 'audioData',
        buffer: pcm16.buffer,
        samples: pcm16.length
      });

      console.log('[AudioProcessor] Processed audio chunk:', pcm16.buffer.byteLength, 'bytes, samples:', pcm16.length);

      // Clear buffer
      this.audioBuffer = [];
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
