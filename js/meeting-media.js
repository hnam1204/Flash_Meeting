export function createMediaController() {
  let microphoneEnabled = true;
  let cameraEnabled = true;

  return {
    getState() {
      return { microphoneEnabled, cameraEnabled };
    },
    toggleMicrophone() {
      microphoneEnabled = !microphoneEnabled;
      return microphoneEnabled;
    },
    toggleCamera() {
      cameraEnabled = !cameraEnabled;
      return cameraEnabled;
    }
  };
}
