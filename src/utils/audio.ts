const PCM_CHUNK_BYTES = 1280;

function floatTo16BitPCM(float32Array: Float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i += 1) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export async function fileToPCM16(file: File, sampleRate = 16000) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const offlineContext = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * sampleRate), sampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  const renderedBuffer = await offlineContext.startRendering();
  await audioContext.close();
  const channelData = renderedBuffer.getChannelData(0);
  return floatTo16BitPCM(channelData);
}

export async function blobToPCM16(blob: Blob, sampleRate = 16000) {
  const file = new File([blob], 'recording.webm', { type: blob.type });
  return fileToPCM16(file, sampleRate);
}

export function chunkPCMData(buffer: ArrayBuffer, chunkBytes = PCM_CHUNK_BYTES) {
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes, buffer.byteLength);
    chunks.push(buffer.slice(offset, end));
  }
  return chunks;
}

export const PCM_BYTES_PER_SECOND = 32000; // 16000 samples * 2 bytes
