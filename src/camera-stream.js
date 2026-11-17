export function openCameraStream(mediaDevices) {
  return mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
  });
}

export function stopCameraStream(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}
