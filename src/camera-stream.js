export function openCameraStream(mediaDevices, { zoom = false } = {}) {
  return mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 }, height: { ideal: 1080 }, ...(zoom ? { zoom: true } : {})
    }
  });
}

export function stopCameraStream(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}
