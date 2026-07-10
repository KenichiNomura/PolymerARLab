import { showScanStatus } from "./ui/status";
import { setBackgroundVisible, type ThreeRuntime } from "./scene/threeScene";

// iPhone-friendly camera overlay: live camera behind the 3D preview, with
// frame capture feeding the sketch recognition pipeline.

export interface CameraOverlayOptions {
  videoEl: HTMLVideoElement;
  toggleButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
  overlayEl: HTMLElement;
  frameEl: HTMLElement;
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

  // Draws the framed region of the current video onto the canvas; false when
  // not ready. Crops to #scanFrameBox so recognition sees only the framed
  // drawing, accounting for the video's object-fit: cover scaling.
  function drawFrameTo(canvas: HTMLCanvasElement): boolean {
    const video = options.videoEl;
    if (!stream || video.videoWidth === 0) {
      showScanStatus("Camera is not ready yet.", true);
      return false;
    }

    const crop = frameCropRegion(video, options.frameEl);
    canvas.width = Math.round(crop.sw);
    canvas.height = Math.round(crop.sh);
    canvas.getContext("2d")!.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
    return true;
  }

  return { toggle, stop, drawFrameTo, isActive: () => stream !== null };
}

// Maps the on-screen viewfinder box to native video pixels. The video fills the
// viewport with object-fit: cover, so it is scaled by s = max(W/vw, H/vh) and
// centered (cropping the overflow). Falls back to the whole frame if the box is
// unavailable or degenerate.
function frameCropRegion(
  video: HTMLVideoElement,
  frameEl: HTMLElement,
): { sx: number; sy: number; sw: number; sh: number } {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const full = { sx: 0, sy: 0, sw: vw, sh: vh };

  const displayW = video.clientWidth;
  const displayH = video.clientHeight;
  const rect = frameEl.getBoundingClientRect();
  if (displayW === 0 || displayH === 0 || rect.width === 0 || rect.height === 0) return full;

  const scale = Math.max(displayW / vw, displayH / vh);
  const offsetX = (displayW - vw * scale) / 2;
  const offsetY = (displayH - vh * scale) / 2;

  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const sx = clamp((rect.left - offsetX) / scale, vw);
  const sy = clamp((rect.top - offsetY) / scale, vh);
  const sw = clamp(rect.width / scale, vw - sx);
  const sh = clamp(rect.height / scale, vh - sy);
  if (sw < 1 || sh < 1) return full;
  return { sx, sy, sw, sh };
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
