export function createMediaController() {
  let microphoneEnabled = true;
  let cameraEnabled = true;
  let localStream = null;

  return {
    getState() {
      return { microphoneEnabled, cameraEnabled };
    },
    setStream(stream) {
      localStream = stream ?? null;
    },
    toggleMicrophone() {
      microphoneEnabled = !microphoneEnabled;
      localStream?.getAudioTracks().forEach((track) => { track.enabled = microphoneEnabled; });
      return microphoneEnabled;
    },
    toggleCamera() {
      cameraEnabled = !cameraEnabled;
      localStream?.getVideoTracks().forEach((track) => { track.enabled = cameraEnabled; });
      return cameraEnabled;
    },
    stop() {
      localStream?.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
  };
}
