import type { AtomSymbol, BondOrder } from "./polymerData";

export type RecognitionSource = "camera-capture" | "image-upload" | "demo-fixture";

export interface RecognizedPoint {
  x: number;
  y: number;
}

export interface RecognizedAtom {
  id: string;
  element: AtomSymbol;
  position: RecognizedPoint;
  confidence: number;
  labelText?: string;
}

export interface RecognizedBond {
  id: string;
  a: string;
  b: string;
  order: BondOrder;
  confidence: number;
}

export interface RecognizedPolymerHints {
  isRepeatUnit: boolean;
  leftAttachmentAtomId?: string;
  rightAttachmentAtomId?: string;
  repeatCount?: number;
}

export interface RecognizedStructure {
  source: RecognitionSource;
  name?: string;
  atoms: RecognizedAtom[];
  bonds: RecognizedBond[];
  polymer?: RecognizedPolymerHints;
  confidence: number;
  warnings: string[];
}

export interface GraphImportPayload {
  name: string;
  atoms: Array<{
    id: string;
    element: AtomSymbol;
    position: [number, number, number];
  }>;
  bonds: Array<{
    id: string;
    a: string;
    b: string;
    order: BondOrder;
  }>;
  defaultRepeats?: number;
  leftAttachmentAtomId?: string;
  rightAttachmentAtomId?: string;
}

export function recognizedStructureToGraphPayload(structure: RecognizedStructure): GraphImportPayload {
  return {
    name: structure.name ?? "Scanned structure",
    atoms: structure.atoms.map((atom) => ({
      id: atom.id,
      element: atom.element,
      position: [atom.position.x, atom.position.y, 0],
    })),
    bonds: structure.bonds.map((bond) => ({
      id: bond.id,
      a: bond.a,
      b: bond.b,
      order: bond.order,
    })),
    defaultRepeats: structure.polymer?.repeatCount,
    leftAttachmentAtomId: structure.polymer?.leftAttachmentAtomId,
    rightAttachmentAtomId: structure.polymer?.rightAttachmentAtomId,
  };
}

export function recognizedStructureToGraphJson(structure: RecognizedStructure) {
  return JSON.stringify(recognizedStructureToGraphPayload(structure), null, 2);
}
