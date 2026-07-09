import { showScanStatus } from "./ui/status";
import { setBackgroundVisible, type ThreeRuntime } from "./scene/threeScene";

// iPhone-friendly camera overlay: live camera behind the 3D preview, with
// frame capture feeding the sketch recognition pipeline.

export interface CameraOverlayOptions {
  videoEl: HTMLVideoElement;
  toggleButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
  overlayEl: HTMLElement;
  getRuntime: () => ThreeRuntime | null;
}

export function createCameraOverlay(options: CameraOverlayOptions) {
  let stream: MediaStream | null = null;

  async function toggle() {
    if (stream) {
      stop();
      return;
    }

    options.toggleButton.disabled = true;
    showScanStatus("Requesting camera permission...");
    try {
      stream = await requestCameraStream();
      options.videoEl.srcObject = stream;
      options.videoEl.muted = true;
      options.videoEl.setAttribute("playsinline", "true");
      await options.videoEl.play();

      document.body.classList.add("camera-active");
      options.overlayEl.classList.add("camera-overlay");
      const runtime = options.getRuntime();
      if (runtime) setBackgroundVisible(runtime, false);
      options.toggleButton.classList.add("is-active");
      options.toggleButton.setAttribute("aria-pressed", "true");
      options.toggleButton.title = "Stop camera";
      options.captureButton.disabled = false;
      showScanStatus("Camera overlay active. Capture your sketch, then verify the structure model.");
    } catch (error) {
      showScanStatus(cameraErrorMessage(error), true);
      stop();
    } finally {
      options.toggleButton.disabled = false;
    }
  }

  function stop() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    options.videoEl.pause();
    options.videoEl.srcObject = null;
    document.body.classList.remove("camera-active");
    options.overlayEl.classList.remove("camera-overlay");
    const runtime = options.getRuntime();
    if (runtime) setBackgroundVisible(runtime, true);
    options.toggleButton.classList.remove("is-active");
    options.toggleButton.setAttribute("aria-pressed", "false");
    options.toggleButton.title = "Camera";
    options.captureButton.disabled = true;
  }

  // Draws the current video frame onto the canvas; false when not ready.
  function drawFrameTo(canvas: HTMLCanvasElement): boolean {
    if (!stream || options.videoEl.videoWidth === 0) {
      showScanStatus("Camera is not ready yet.", true);
      return false;
    }
    canvas.width = options.videoEl.videoWidth;
    canvas.height = options.videoEl.videoHeight;
    canvas.getContext("2d")!.drawImage(options.videoEl, 0, 0, canvas.width, canvas.height);
    return true;
  }

  return { toggle, stop, drawFrameTo, isActive: () => stream !== null };
}

async function requestCameraStream(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error("Camera needs a trusted HTTPS page. Use localhost or the deployed site.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser did not expose getUserMedia camera access.");
  }

  const constraints: MediaStreamConstraints = {
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    const name = (error as DOMException).name;
    if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") throw error;
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function cameraErrorMessage(error: unknown) {
  const err = error as DOMException | Error;
  if ("name" in err && err.name === "NotAllowedError") {
    return "Camera permission was blocked. In Safari, allow Camera for this site and reload.";
  }
  if ("name" in err && err.name === "NotFoundError") {
    return "No camera was found for this browser tab.";
  }
  return `Camera unavailable: ${err.message || String(error)}`;
}
