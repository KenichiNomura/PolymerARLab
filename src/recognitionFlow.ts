import { aiAccessToken, aiRecognitionEndpoint, recognizeSketchWithAI } from "./aiRecognition";
import type { RecognitionSource } from "./scannerContract";
import { recognizeSketch, recognizedStructureToImportJson } from "./scannerPipeline";
import type { StructureImportFormat } from "./structureImport";
import { showScanStatus } from "./ui/status";

// Sketch recognition orchestration: AI (Claude via the deployed Worker)
// first when this device has both the endpoint and the shared access token,
// falling back to the free on-device recognizer otherwise or on failure.

export interface ImportOutcome {
  ok: boolean;
  message?: string;
}

export interface RecognitionFlowOptions {
  canvas: HTMLCanvasElement;
  setPolymerMode: (on: boolean) => void;
  setImportInput: (format: StructureImportFormat, value: string) => void;
  importStructure: (options?: { repeatOverride?: number }) => Promise<ImportOutcome>;
}

export async function runSketchRecognition(source: RecognitionSource, options: RecognitionFlowOptions) {
  const endpoint = aiRecognitionEndpoint();
  if (endpoint && aiAccessToken()) {
    showScanStatus("AI recognition (Claude) in progress...");
    try {
      const ai = await recognizeSketchWithAI(options.canvas, endpoint);
      options.setPolymerMode(ai.isRepeatUnit);
      options.setImportInput("smiles", ai.smiles);
      const repeatOverride = ai.isRepeatUnit && ai.repeatCount > 0 ? ai.repeatCount : undefined;
      const outcome = await options.importStructure({ repeatOverride });
      if (!outcome.ok) throw new Error(`the recognized SMILES "${ai.smiles}" did not import (${outcome.message})`);
      const notes = ai.notes.length > 0 ? ` ${ai.notes.join(" ")}` : "";
      showScanStatus(`AI recognition: ${ai.smiles} (confidence ${(ai.confidence * 100).toFixed(0)}%).${notes}`, ai.notes.length > 0);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showScanStatus(`AI recognition unavailable (${message}) - trying on-device recognizer...`, true);
    }
  }

  showScanStatus("Recognizing sketch...");
  try {
    const recognized = await recognizeSketch(options.canvas, source);
    options.setPolymerMode(recognized.polymer?.isRepeatUnit ?? false);
    options.setImportInput("json", recognizedStructureToImportJson(recognized));
    await options.importStructure();
    const confidence = `Recognition confidence ${(recognized.confidence * 100).toFixed(0)}%.`;
    showScanStatus([confidence, ...recognized.warnings].join(" "), recognized.warnings.length > 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showScanStatus(`Sketch recognition failed: ${message}`, true);
  }
}
