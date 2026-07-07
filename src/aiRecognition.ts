// Browser client for the AI sketch-recognition Worker (worker/ directory):
// a captured sketch photo goes to the Worker, Claude transcribes it to
// SMILES, and the result flows through the same SMILES import path as typed
// input. When no endpoint is configured (or the network fails), callers fall
// back to the on-device classical recognizer.

// The deployed worker/ instance (see README "AI Recognition Setup").
const DEFAULT_AI_ENDPOINT = "https://polymer-ar-lab-recognizer.kenichi-nomura.workers.dev";
const ENDPOINT_STORAGE_KEY = "polymerARLab.aiEndpoint";
const MAX_UPLOAD_DIMENSION = 1024;
const REQUEST_TIMEOUT_MS = 45_000;

export interface AIRecognitionResult {
  smiles: string;
  isRepeatUnit: boolean;
  repeatCount: number;
  notes: string[];
  confidence: number;
  model: string;
}

// The endpoint can be provided three ways (highest priority first): a
// ?ai=<url> query parameter (persisted), localStorage, or the baked-in
// default. `?ai=off` disables AI recognition (persisted) and `?ai=default`
// restores the baked-in endpoint.
export function aiRecognitionEndpoint(): string {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("ai");
    if (fromQuery === "default") {
      localStorage.removeItem(ENDPOINT_STORAGE_KEY);
    } else if (fromQuery) {
      localStorage.setItem(ENDPOINT_STORAGE_KEY, fromQuery);
    }
    const value = localStorage.getItem(ENDPOINT_STORAGE_KEY) ?? DEFAULT_AI_ENDPOINT;
    return value === "off" ? "" : value;
  } catch {
    return DEFAULT_AI_ENDPOINT;
  }
}

export async function recognizeSketchWithAI(canvas: HTMLCanvasElement, endpoint: string): Promise<AIRecognitionResult> {
  const image = canvasToJpegBase64(canvas);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/recognize", endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, mediaType: "image/jpeg" }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : `AI endpoint returned HTTP ${response.status}.`);
    }
    const smiles = typeof payload.smiles === "string" ? payload.smiles.trim() : "";
    if (!smiles) {
      const note = Array.isArray(payload.notes) && payload.notes.length > 0 ? ` ${payload.notes.join(" ")}` : "";
      throw new Error(`No legible structure was recognized.${note}`);
    }
    return {
      smiles,
      isRepeatUnit: Boolean(payload.isRepeatUnit),
      repeatCount: Number(payload.repeatCount) || 0,
      notes: Array.isArray(payload.notes) ? payload.notes.map(String) : [],
      confidence: Number(payload.confidence) || 0,
      model: typeof payload.model === "string" ? payload.model : "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function canvasToJpegBase64(canvas: HTMLCanvasElement): string {
  const scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(canvas.width, canvas.height));
  let source: HTMLCanvasElement = canvas;
  if (scale < 1) {
    const scaled = document.createElement("canvas");
    scaled.width = Math.round(canvas.width * scale);
    scaled.height = Math.round(canvas.height * scale);
    scaled.getContext("2d")!.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    source = scaled;
  }
  return source.toDataURL("image/jpeg", 0.88).split(",")[1];
}
