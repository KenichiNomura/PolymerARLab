import type { RecognitionSource, RecognizedStructure } from "./scannerContract";
import { recognizedStructureToGraphJson } from "./scannerContract";
import { recognizeSketchImage } from "./sketchRecognition";

const TARGET_BOND_LENGTH = 1.45;
const MAX_RECOGNITION_DIMENSION = 720;

/**
 * Recognize a captured sketch frame as a molecular graph following the
 * scanner contract. Camera frames are downscaled before analysis so phone
 * captures stay fast and stroke thresholds behave consistently.
 */
export async function recognizeSketch(
  canvas: HTMLCanvasElement,
  source: RecognitionSource,
): Promise<RecognizedStructure> {
  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error("Capture a sketch frame before running recognition.");
  }
  return recognizeSketchImage(recognitionImageData(canvas), source);
}

function recognitionImageData(canvas: HTMLCanvasElement): ImageData {
  const scale = Math.min(1, MAX_RECOGNITION_DIMENSION / Math.max(canvas.width, canvas.height));
  if (scale >= 1) {
    return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  }
  const scaled = document.createElement("canvas");
  scaled.width = Math.round(canvas.width * scale);
  scaled.height = Math.round(canvas.height * scale);
  const context = scaled.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return context.getImageData(0, 0, scaled.width, scaled.height);
}

/**
 * Convert a recognized structure into graph JSON for the import pipeline,
 * mapping image-space coordinates (pixels, y grows downward) into
 * model-space coordinates (roughly Angstrom-scale bonds, y grows upward).
 */
export function recognizedStructureToImportJson(structure: RecognizedStructure): string {
  return recognizedStructureToGraphJson(normalizeSketchGeometry(structure));
}

function normalizeSketchGeometry(structure: RecognizedStructure): RecognizedStructure {
  if (structure.atoms.length === 0) return structure;

  const atomById = new Map(structure.atoms.map((atom) => [atom.id, atom]));
  const bondLengths = structure.bonds
    .map((bond) => {
      const a = atomById.get(bond.a);
      const b = atomById.get(bond.b);
      return a && b ? Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y) : 0;
    })
    .filter((length) => length > 0)
    .sort((a, b) => a - b);

  const reference = bondLengths.length > 0 ? bondLengths[Math.floor(bondLengths.length / 2)] : largestSpan(structure.atoms);
  const scale = reference > 0 ? TARGET_BOND_LENGTH / reference : 1;

  return {
    ...structure,
    atoms: structure.atoms.map((atom) => ({
      ...atom,
      position: { x: atom.position.x * scale, y: -atom.position.y * scale },
    })),
  };
}

function largestSpan(atoms: RecognizedStructure["atoms"]) {
  const xs = atoms.map((atom) => atom.position.x);
  const ys = atoms.map((atom) => atom.position.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
