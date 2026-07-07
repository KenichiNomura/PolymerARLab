import type { RecognitionSource, RecognizedStructure } from "./scannerContract";
import { recognizedStructureToGraphJson } from "./scannerContract";

const TARGET_BOND_LENGTH = 1.45;

/**
 * Recognize a captured sketch frame as a molecular graph.
 *
 * Real handwritten recognition is roadmap phase 4. Until it lands, this
 * returns a demo fixture (with an explicit warning) so the full
 * capture -> scanner contract -> graph JSON -> import -> render path can be
 * exercised end to end on every device.
 */
export async function recognizeSketch(
  canvas: HTMLCanvasElement,
  source: RecognitionSource,
): Promise<RecognizedStructure> {
  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error("Capture a sketch frame before running recognition.");
  }
  return demoRecognitionFixture(source, canvas.width, canvas.height);
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

function demoRecognitionFixture(source: RecognitionSource, width: number, height: number): RecognizedStructure {
  const bond = Math.min(width, height) * 0.18;
  const originX = width * 0.3;
  const originY = height * 0.55;
  return {
    source,
    name: "Demo scan: ethanol",
    atoms: [
      { id: "a1", element: "C", position: { x: originX, y: originY }, confidence: 0.93 },
      { id: "a2", element: "C", position: { x: originX + bond, y: originY - bond * 0.55 }, confidence: 0.91 },
      { id: "a3", element: "O", position: { x: originX + bond * 2, y: originY }, confidence: 0.88 },
      { id: "a4", element: "H", position: { x: originX + bond * 3, y: originY - bond * 0.45 }, confidence: 0.72 },
    ],
    bonds: [
      { id: "b1", a: "a1", b: "a2", order: 1, confidence: 0.92 },
      { id: "b2", a: "a2", b: "a3", order: 1, confidence: 0.9 },
      { id: "b3", a: "a3", b: "a4", order: 1, confidence: 0.7 },
    ],
    confidence: 0.4,
    warnings: [
      "Handwritten recognition is not implemented yet; this is a demo ethanol result that verifies the scan pipeline.",
    ],
  };
}
