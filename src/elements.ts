// CPK-style coloring and covalent radii (Angstrom) for the supported elements.
// Falls back to a generic gray/radius for anything not listed.

export interface ElementInfo {
  color: number;
  radius: number; // covalent radius, used both for bond cutoffs and atom sphere scale
}

const DEFAULT: ElementInfo = { color: 0xb0b0b0, radius: 0.7 };

const ELEMENT_TABLE: Record<string, ElementInfo> = {
  H: { color: 0xffffff, radius: 0.31 },
  C: { color: 0x909090, radius: 0.76 },
  N: { color: 0x3050f8, radius: 0.71 },
  O: { color: 0xff0d0d, radius: 0.66 },
  F: { color: 0x90e050, radius: 0.57 },
  P: { color: 0xff8000, radius: 1.07 },
  S: { color: 0xffff30, radius: 1.05 },
  Cl: { color: 0x1ff01f, radius: 1.02 },
  Br: { color: 0xa62929, radius: 1.2 },
  I: { color: 0x940094, radius: 1.39 },
};

export function getElementInfo(symbol: string): ElementInfo {
  return ELEMENT_TABLE[symbol] ?? DEFAULT;
}
