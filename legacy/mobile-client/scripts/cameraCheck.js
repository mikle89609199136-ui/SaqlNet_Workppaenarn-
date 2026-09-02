// Vanilla: check if camera is available and expose result globally
(async function initCameraCheck() {
  async function hasCamera() {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videInputs = devices.filter(d => d.kind === 'videoinput');
      return videInputs.length > 0;
    } catch (e) {
      console.error('Camera check error:', e);
      return false;
    }
  }
  try {
    window.__CAMERA_HAS__ = Boolean(await hasCamera());
  } catch {
    window.__CAMERA_HAS__ = false;
  }
})();
