import type { AtomSymbol, BondOrder, PolymerTemplate, TemplateAtom, TemplateBond, TemplateGroup } from "./polymerData";

export type StructureImportFormat = "auto" | "smiles" | "molfile" | "json";

export const IMPORTED_TEMPLATE_ID = "imported-structure";

export interface AttachmentSelection {
  leftAtomId?: string;
  rightAtomId?: string;
}

export interface StructureImportResult {
  template: PolymerTemplate;
  detectedFormat: Exclude<StructureImportFormat, "auto">;
  messages: string[];
}

interface ParsedAtom {
  id: string;
  element: AtomSymbol;
  aromatic?: boolean;
  x?: number;
  y?: number;
  z?: number;
}

interface ParsedBond {
  id: string;
  a: string;
  b: string;
  order: BondOrder;
}

interface ParsedStructure {
  name?: string;
  repeatLabel?: string;
  defaultRepeats?: number;
  leftAttachmentAtomId?: string;
  rightAttachmentAtomId?: string;
  atoms: ParsedAtom[];
  bonds: ParsedBond[];
  warnings?: string[];
}

const SUPPORTED_ATOMS = new Set<AtomSymbol>(["H", "C", "N", "O", "S", "P", "F", "Cl", "Br", "I"]);
const SUPPORTED_ATOM_LIST = [...SUPPORTED_ATOMS].join(", ");

export function importStructure(
  rawInput: string,
  format: StructureImportFormat,
  attachments: AttachmentSelection = {},
): StructureImportResult {
  const source = rawInput.trim();
  if (!source) {
    throw new Error("Paste a SMILES string, Molfile, or graph JSON first.");
  }

  const detectedFormat = detectFormat(source, format);
  const parsed =
    detectedFormat === "json"
      ? parseGraphJson(source)
      : detectedFormat === "molfile"
        ? parseMolfile(source)
        : parseSmiles(source);

  const attachmentNotes: string[] = [];
  return {
    template: buildTemplate(parsed, attachments, attachmentNotes),
    detectedFormat,
    messages: [`Imported ${detectedFormat.toUpperCase()} repeat unit.`, ...(parsed.warnings ?? []), ...attachmentNotes],
  };
}

// Build a single-molecule template straight from an SDF/molfile, keeping the
// file's own coordinates (centered, not rescaled). Used for PubChem 3D records:
// `is3d` sets `explicitGeometry` so the conformer/VSEPR layout is skipped and
// the authentic coordinates render as-is; a 2D-only record leaves the flag off
// so the conformer regenerates 3D. Deliberately avoids `withPositions`, whose
// `normalizePositions` scales x/y but drops z and would distort real 3D.
export function buildMoleculeTemplate3D(sdf: string, name: string, is3d: boolean): PolymerTemplate {
  const parsed = parseMolfile(sdf);
  validateParsedStructure(parsed);

  const count = parsed.atoms.length;
  const centroid: [number, number, number] = [0, 0, 0];
  for (const atom of parsed.atoms) {
    centroid[0] += (atom.x ?? 0) / count;
    centroid[1] += (atom.y ?? 0) / count;
    centroid[2] += (atom.z ?? 0) / count;
  }
  const atoms: TemplateAtom[] = parsed.atoms.map((atom) => ({
    id: atom.id,
    element: atom.element,
    position: [(atom.x ?? 0) - centroid[0], (atom.y ?? 0) - centroid[1], (atom.z ?? 0) - centroid[2]],
  }));
  const bonds: TemplateBond[] = parsed.bonds.map((bond) => ({ id: bond.id, a: bond.a, b: bond.b, order: bond.order }));

  const label = safeLabel(name, "PubChem molecule");
  return {
    id: IMPORTED_TEMPLATE_ID,
    name: label,
    shortName: label.length > 18 ? `${label.slice(0, 17)}…` : label,
    family: "PubChem",
    repeatLabel: label,
    defaultRepeats: 1,
    maxRepeats: 1,
    step: [0, 0, 0],
    connection: { leftAtomId: atoms[0].id, rightAtomId: atoms[1].id, order: 1 },
    explicitGeometry: is3d,
    atoms,
    bonds,
    groups: [
      {
        id: "molecule",
        label: label,
        atomIds: atoms.map((atom) => atom.id),
        bondIds: bonds.map((bond) => bond.id),
        color: 0x44c7d8,
      },
    ],
  };
}

// Turn a loaded monomer into a tileable repeat unit given two backbone anchor
// atoms. Strips hydrogens (the conformer re-adds them and drops the two
// chain-axis ones) and, for a vinyl monomer, opens the C=C by reducing the
// anchor-anchor bond order — so the addition-polymer backbone is single-bonded.
// Returns a molecule-less template (explicitGeometry off) for the conformer
// polymer path to lay out and align.
export function deriveRepeatUnit(molecule: PolymerTemplate, anchorAId: string, anchorBId: string): PolymerTemplate {
  if (anchorAId === anchorBId) throw new Error("Pick two different anchor atoms.");
  const byId = new Map(molecule.atoms.map((atom) => [atom.id, atom]));
  const anchorA = byId.get(anchorAId);
  const anchorB = byId.get(anchorBId);
  if (!anchorA || !anchorB) throw new Error("Anchor atom is not part of this molecule.");
  if (anchorA.element === "H" || anchorB.element === "H") throw new Error("Anchor atoms must be heavy atoms, not hydrogen.");

  // Drop hydrogens and any bond touching one.
  const heavyIds = new Set(molecule.atoms.filter((atom) => atom.element !== "H").map((atom) => atom.id));
  const atoms: TemplateAtom[] = molecule.atoms
    .filter((atom) => heavyIds.has(atom.id))
    .map((atom) => ({ id: atom.id, element: atom.element, position: [...atom.position] as [number, number, number] }));
  const bonds: TemplateBond[] = molecule.bonds
    .filter((bond) => heavyIds.has(bond.a) && heavyIds.has(bond.b))
    .map((bond) => ({ id: bond.id, a: bond.a, b: bond.b, order: bond.order }));

  if (atoms.length < 2) throw new Error("Need at least two heavy atoms to make a repeat unit.");

  // Open the anchor valences: reduce a double/triple bond between the anchors by
  // one (a single or absent bond already leaves open valences after H removal).
  for (const bond of bonds) {
    const spansAnchors = (bond.a === anchorAId && bond.b === anchorBId) || (bond.a === anchorBId && bond.b === anchorAId);
    if (spansAnchors && (bond.order === 2 || bond.order === 3)) {
      bond.order = (bond.order - 1) as BondOrder;
    }
  }

  const span = Math.hypot(
    anchorA.position[0] - anchorB.position[0],
    anchorA.position[1] - anchorB.position[1],
    anchorA.position[2] - anchorB.position[2],
  );
  const label = safeLabel(`poly(${molecule.name})`, "Derived repeat unit");
  return {
    id: IMPORTED_TEMPLATE_ID,
    name: label,
    shortName: label.length > 18 ? `${label.slice(0, 17)}…` : label,
    family: "Derived polymer",
    repeatLabel: label,
    defaultRepeats: 4,
    maxRepeats: 10,
    step: [Math.max(2.4, span + 1.5), 0, 0],
    connection: { leftAtomId: anchorAId, rightAtomId: anchorBId, order: 1 },
    explicitGeometry: false,
    atoms,
    bonds,
    groups: [
      {
        id: "repeat-unit",
        label: "Repeat unit",
        atomIds: atoms.map((atom) => atom.id),
        bondIds: bonds.map((bond) => bond.id),
        color: 0x44c7d8,
      },
    ],
  };
}

export function updateTemplateAttachments(
  template: PolymerTemplate,
  leftAtomId: string,
  rightAtomId: string,
): PolymerTemplate {
  if (leftAtomId === rightAtomId) {
    throw new Error("Choose two different attachment atoms.");
  }
  const atomIds = new Set(template.atoms.map((atom) => atom.id));
  if (!atomIds.has(leftAtomId) || !atomIds.has(rightAtomId)) {
    throw new Error("Attachment atom is not part of the imported repeat unit.");
  }
  return {
    ...template,
    connection: {
      ...template.connection,
      leftAtomId,
      rightAtomId,
    },
  };
}

function detectFormat(source: string, format: StructureImportFormat): Exclude<StructureImportFormat, "auto"> {
  if (format !== "auto") return format;
  if (source.startsWith("{") || source.startsWith("[")) return "json";
  if (/V2000|V3000|M\s+END/.test(source) || /^\s*\d+\s+\d+\s+0\s+0\s+0\s+0/m.test(source)) return "molfile";
  return "smiles";
}

function parseGraphJson(source: string): ParsedStructure {
  const parsed = JSON.parse(source) as any;
  const atomsInput = Array.isArray(parsed) ? parsed : parsed.atoms;
  const bondsInput = Array.isArray(parsed) ? [] : parsed.bonds;
  if (!Array.isArray(atomsInput)) throw new Error("Graph JSON needs an atoms array.");
  if (!Array.isArray(bondsInput)) throw new Error("Graph JSON needs a bonds array.");

  const atoms = atomsInput.map((item: any, index: number): ParsedAtom => {
    const element = normalizeElement(String(item.element ?? item.symbol ?? ""));
    const sourceId = item.id == null ? `a${index + 1}` : String(item.id);
    const position = Array.isArray(item.position) ? item.position : null;
    return {
      id: sanitizeId(sourceId, `a${index + 1}`),
      element,
      x: numberOrUndefined(item.x ?? position?.[0]),
      y: numberOrUndefined(item.y ?? position?.[1]),
      z: numberOrUndefined(item.z ?? position?.[2]),
    };
  });

  const idMap = new Map<string, string>();
  atomsInput.forEach((item: any, index: number) => {
    const sourceId = item.id == null ? `a${index + 1}` : String(item.id);
    idMap.set(String(sourceId), atoms[index].id);
  });

  const bonds = bondsInput.map((item: any, index: number): ParsedBond => {
    const rawA = String(item.a ?? item.from ?? item.source);
    const rawB = String(item.b ?? item.to ?? item.target);
    const a = idMap.get(rawA);
    const b = idMap.get(rawB);
    if (!a || !b) {
      throw new Error(`Bond ${index + 1} references unknown atom "${!a ? rawA : rawB}". Check the bond's "a"/"b" atom ids.`);
    }
    return {
      id: sanitizeId(String(item.id ?? `b${index + 1}`), `b${index + 1}`),
      a,
      b,
      order: normalizeBondOrder(item.order ?? 1, `bond ${index + 1}`),
    };
  });

  const warnings: string[] = [];
  const declaredLeft = parsed.leftAttachmentAtomId ?? parsed.leftAttachment;
  const declaredRight = parsed.rightAttachmentAtomId ?? parsed.rightAttachment;
  const leftAttachmentAtomId = idMap.get(String(declaredLeft ?? ""));
  const rightAttachmentAtomId = idMap.get(String(declaredRight ?? ""));
  if (declaredLeft != null && !leftAttachmentAtomId) {
    warnings.push(`Left attachment atom "${declaredLeft}" was not found in the atoms list; the leftmost atom will be used instead.`);
  }
  if (declaredRight != null && !rightAttachmentAtomId) {
    warnings.push(`Right attachment atom "${declaredRight}" was not found in the atoms list; the rightmost atom will be used instead.`);
  }

  return {
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    repeatLabel: typeof parsed.repeatLabel === "string" ? parsed.repeatLabel : undefined,
    defaultRepeats: numberOrUndefined(parsed.degreeOfPolymerization ?? parsed.defaultRepeats),
    leftAttachmentAtomId,
    rightAttachmentAtomId,
    atoms,
    bonds,
    warnings,
  };
}

function parseMolfile(source: string): ParsedStructure {
  const lines = source.replace(/\r/g, "").split("\n");
  const countsIndex = lines.findIndex((line) => /^\s*\d+\s+\d+/.test(line));
  if (countsIndex < 0) throw new Error("Molfile counts line was not found.");

  const counts = lines[countsIndex].trim().split(/\s+/);
  const atomCount = Number(counts[0]);
  const bondCount = Number(counts[1]);
  if (!Number.isFinite(atomCount) || atomCount < 2) throw new Error("Molfile needs at least two atoms.");

  const atoms: ParsedAtom[] = [];
  const atomStart = countsIndex + 1;
  for (let index = 0; index < atomCount; index++) {
    const fields = (lines[atomStart + index] ?? "").trim().split(/\s+/);
    if (fields.length < 4) throw new Error(`Molfile atom line ${index + 1} is incomplete.`);
    atoms.push({
      id: `a${index + 1}`,
      element: normalizeElement(fields[3]),
      x: Number(fields[0]),
      y: Number(fields[1]),
      z: Number(fields[2]),
    });
  }

  const bonds: ParsedBond[] = [];
  const bondStart = atomStart + atomCount;
  for (let index = 0; index < bondCount; index++) {
    const fields = (lines[bondStart + index] ?? "").trim().split(/\s+/);
    if (fields.length < 3) throw new Error(`Molfile bond line ${index + 1} is incomplete.`);
    const aIndex = Number(fields[0]);
    const bIndex = Number(fields[1]);
    const a = atoms[aIndex - 1]?.id;
    const b = atoms[bIndex - 1]?.id;
    if (!a || !b) throw new Error(`Molfile bond ${index + 1} references an unknown atom.`);
    bonds.push({
      id: `b${index + 1}`,
      a,
      b,
      order: normalizeBondOrder(Number(fields[2]), `Molfile bond line ${index + 1}`),
    });
  }

  return {
    name: molfileName(lines, countsIndex),
    atoms,
    bonds,
  };
}

function molfileName(lines: string[], countsIndex: number) {
  // A full V2000 header is: name, program, comment, counts. When the leading
  // blank name line was trimmed away, lines[0] is the program line (for
  // example "     RDKit          2D"), which should not become the name.
  if (countsIndex < 3) return "Imported Molfile";
  const name = lines[0]?.trim();
  return name || "Imported Molfile";
}

function parseSmiles(source: string): ParsedStructure {
  const atoms: ParsedAtom[] = [];
  const bonds: ParsedBond[] = [];
  const branches: string[] = [];
  const rings = new Map<string, { atomId: string; order?: BondOrder }>();
  let currentAtomId: string | null = null;
  let pendingOrder: BondOrder | undefined;
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "-") {
      pendingOrder = 1;
      index += 1;
      continue;
    }
    if (char === "=") {
      pendingOrder = 2;
      index += 1;
      continue;
    }
    if (char === "#") {
      pendingOrder = 3;
      index += 1;
      continue;
    }
    if (char === ":") {
      pendingOrder = "aromatic";
      index += 1;
      continue;
    }
    if (char === "(") {
      if (!currentAtomId) throw new Error("SMILES branch started before an atom.");
      branches.push(currentAtomId);
      index += 1;
      continue;
    }
    if (char === ")") {
      const branchAtomId = branches.pop();
      if (!branchAtomId) throw new Error("SMILES branch closed without a start.");
      currentAtomId = branchAtomId;
      index += 1;
      continue;
    }
    if (char === ".") {
      throw new Error("Disconnected SMILES fragments are not supported for repeat units.");
    }
    if (/\d/.test(char)) {
      if (!currentAtomId) throw new Error("SMILES ring marker appeared before an atom.");
      const existing = rings.get(char);
      if (existing) {
        const start = atoms.find((atom) => atom.id === existing.atomId);
        const end = atoms.find((atom) => atom.id === currentAtomId);
        bonds.push({
          id: `b${bonds.length + 1}`,
          a: existing.atomId,
          b: currentAtomId,
          order: pendingOrder ?? existing.order ?? inferDefaultBond(start, end),
        });
        rings.delete(char);
      } else {
        rings.set(char, { atomId: currentAtomId, order: pendingOrder });
      }
      pendingOrder = undefined;
      index += 1;
      continue;
    }

    const parsedAtom = readSmilesAtom(source, index);
    if (!parsedAtom) {
      throw new Error(
        `Unsupported SMILES token "${char}" at position ${index + 1}. Supported atoms: ${SUPPORTED_ATOM_LIST}; bonds: - = # :; branches ( ); ring closures 0-9.`,
      );
    }

    const atomId = `a${atoms.length + 1}`;
    const atom: ParsedAtom = { id: atomId, element: parsedAtom.element, aromatic: parsedAtom.aromatic };
    atoms.push(atom);
    if (currentAtomId) {
      const previousAtom = atoms.find((candidate) => candidate.id === currentAtomId);
      bonds.push({
        id: `b${bonds.length + 1}`,
        a: currentAtomId,
        b: atomId,
        order: pendingOrder ?? inferDefaultBond(previousAtom, atom),
      });
    }
    currentAtomId = atomId;
    pendingOrder = undefined;
    index = parsedAtom.nextIndex;
  }

  if (branches.length > 0) throw new Error("SMILES branch was not closed.");
  if (rings.size > 0) throw new Error("SMILES ring marker was not closed.");
  if (atoms.length < 2) throw new Error("SMILES repeat unit needs at least two atoms.");

  return {
    name: source.length <= 32 ? source : "Imported SMILES",
    repeatLabel: `[${source}]n`,
    atoms,
    bonds,
  };
}

function readSmilesAtom(source: string, index: number): { element: AtomSymbol; aromatic?: boolean; nextIndex: number } | null {
  const char = source[index];
  if (char === "[") {
    const closeIndex = source.indexOf("]", index + 1);
    if (closeIndex < 0) throw new Error("Bracket atom is missing a closing bracket.");
    const content = source.slice(index + 1, closeIndex);
    const match = content.match(/^([A-Z][a-z]?|[cnosp])/);
    if (!match) throw new Error(`Bracket atom [${content}] is not supported.`);
    const raw = match[1];
    return {
      element: normalizeElement(raw),
      aromatic: raw === raw.toLowerCase(),
      nextIndex: closeIndex + 1,
    };
  }

  const twoChar = source.slice(index, index + 2);
  if (twoChar === "Cl" || twoChar === "Br") {
    return { element: twoChar, nextIndex: index + 2 };
  }
  if ("CNOPSFHI".includes(char)) {
    return { element: normalizeElement(char), nextIndex: index + 1 };
  }
  if ("cnosp".includes(char)) {
    return { element: normalizeElement(char), aromatic: true, nextIndex: index + 1 };
  }
  return null;
}

function buildTemplate(parsed: ParsedStructure, attachments: AttachmentSelection, notes: string[] = []): PolymerTemplate {
  validateParsedStructure(parsed);
  const positionedAtoms = withPositions(parsed.atoms, parsed.bonds);
  const atomIds = new Set(positionedAtoms.map((atom) => atom.id));
  const defaultAttachments = chooseDefaultAttachments(positionedAtoms);
  const leftAtomId = atomIds.has(attachments.leftAtomId ?? "")
    ? attachments.leftAtomId!
    : parsed.leftAttachmentAtomId && atomIds.has(parsed.leftAttachmentAtomId)
      ? parsed.leftAttachmentAtomId
      : defaultAttachments.leftAtomId;
  const rightAtomId = atomIds.has(attachments.rightAtomId ?? "")
    ? attachments.rightAtomId!
    : parsed.rightAttachmentAtomId && atomIds.has(parsed.rightAttachmentAtomId)
      ? parsed.rightAttachmentAtomId
      : defaultAttachments.rightAtomId;

  if (leftAtomId === rightAtomId) {
    throw new Error(
      `Imported repeat unit needs two different attachment atoms (both resolved to "${leftAtomId}"). Pick distinct left/right connection atoms.`,
    );
  }

  const leftDefaulted = !atomIds.has(attachments.leftAtomId ?? "") && !(parsed.leftAttachmentAtomId && atomIds.has(parsed.leftAttachmentAtomId));
  const rightDefaulted = !atomIds.has(attachments.rightAtomId ?? "") && !(parsed.rightAttachmentAtomId && atomIds.has(parsed.rightAttachmentAtomId));
  const wantsPolymerAttachments =
    attachments.leftAtomId != null ||
    attachments.rightAtomId != null ||
    parsed.leftAttachmentAtomId != null ||
    parsed.rightAttachmentAtomId != null ||
    parsed.defaultRepeats != null;
  if (wantsPolymerAttachments && (leftDefaulted || rightDefaulted)) {
    const sides = [leftDefaulted ? `left ${leftAtomId}` : "", rightDefaulted ? `right ${rightAtomId}` : ""].filter(Boolean).join(", ");
    notes.push(`Repeat-unit connection auto-selected (${sides}). Adjust it with the connection selectors if needed.`);
  }

  const atoms: TemplateAtom[] = positionedAtoms.map((atom) => ({
    id: atom.id,
    element: atom.element,
    position: [atom.x ?? 0, atom.y ?? 0, atom.z ?? 0],
  }));
  const bonds: TemplateBond[] = parsed.bonds.map((bond) => ({
    id: bond.id,
    a: bond.a,
    b: bond.b,
    order: bond.order,
  }));
  const aromaticBondIds = bonds.filter((bond) => bond.order === "aromatic").map((bond) => bond.id);
  const aromaticAtomIds = new Set(
    parsed.bonds
      .filter((bond) => bond.order === "aromatic")
      .flatMap((bond) => [bond.a, bond.b]),
  );
  const groups: TemplateGroup[] = [
    {
      id: "repeat-unit",
      label: "Imported repeat unit",
      atomIds: atoms.map((atom) => atom.id),
      bondIds: bonds.map((bond) => bond.id),
      color: 0x44c7d8,
    },
  ];
  if (aromaticBondIds.length > 0) {
    groups.push({
      id: "aromatic",
      label: "Aromatic bonds",
      atomIds: atoms
        .filter((atom) => aromaticAtomIds.has(atom.id) || parsed.atoms.find((parsedAtom) => parsedAtom.id === atom.id)?.aromatic)
        .map((atom) => atom.id),
      bondIds: aromaticBondIds,
      color: 0xf2b84b,
    });
  }

  const xs = atoms.map((atom) => atom.position[0]);
  const span = Math.max(...xs) - Math.min(...xs);
  const repeatCount = Math.min(10, Math.max(1, Math.round(parsed.defaultRepeats ?? 4)));

  return {
    id: IMPORTED_TEMPLATE_ID,
    name: safeLabel(parsed.name, "Imported repeat unit"),
    shortName: "Imported",
    family: "Imported structure",
    repeatLabel: safeLabel(parsed.repeatLabel, "Imported repeat unit"),
    defaultRepeats: repeatCount,
    maxRepeats: 10,
    step: [Math.max(2.4, span + 1.45), 0, 0],
    connection: {
      leftAtomId,
      rightAtomId,
      order: 1,
    },
    atoms,
    bonds,
    groups,
  };
}

function validateParsedStructure(parsed: ParsedStructure) {
  if (parsed.atoms.length < 2) throw new Error("Repeat unit needs at least two atoms.");
  if (parsed.bonds.length < 1) throw new Error("Repeat unit needs at least one bond.");

  const atomIds = new Set<string>();
  for (const atom of parsed.atoms) {
    if (atomIds.has(atom.id)) throw new Error(`Duplicate atom id "${atom.id}".`);
    atomIds.add(atom.id);
    if (!SUPPORTED_ATOMS.has(atom.element)) throw new Error(`Unsupported atom "${atom.element}".`);
  }

  const bondIds = new Set<string>();
  for (const bond of parsed.bonds) {
    if (bondIds.has(bond.id)) throw new Error(`Duplicate bond id "${bond.id}".`);
    bondIds.add(bond.id);
    if (!atomIds.has(bond.a) || !atomIds.has(bond.b)) throw new Error(`Bond "${bond.id}" references an unknown atom.`);
    if (bond.a === bond.b) throw new Error(`Bond "${bond.id}" connects an atom to itself.`);
  }
}

function withPositions(atoms: ParsedAtom[], bonds: ParsedBond[]): ParsedAtom[] {
  const hasUsableCoordinates = hasCoordinateSpread(atoms);
  const positioned = atoms.map((atom) => ({ ...atom }));
  if (!hasUsableCoordinates) {
    const layout = forceLayout(positioned, bonds);
    positioned.forEach((atom, index) => {
      atom.x = layout[index].x;
      atom.y = layout[index].y;
      atom.z = 0;
    });
  }
  return normalizePositions(positioned);
}

function hasCoordinateSpread(atoms: ParsedAtom[]) {
  const xs = atoms.map((atom) => atom.x).filter((value): value is number => Number.isFinite(value));
  const ys = atoms.map((atom) => atom.y).filter((value): value is number => Number.isFinite(value));
  if (xs.length !== atoms.length || ys.length !== atoms.length) return false;
  return Math.max(...xs) - Math.min(...xs) > 0.01 || Math.max(...ys) - Math.min(...ys) > 0.01;
}

function forceLayout(atoms: ParsedAtom[], bonds: ParsedBond[]) {
  const count = atoms.length;
  const positions = atoms.map((_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: Math.cos(angle) * 1.3, y: Math.sin(angle) * 1.3 };
  });
  const atomIndex = new Map(atoms.map((atom, index) => [atom.id, index]));

  for (let iteration = 0; iteration < 220; iteration++) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));

    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        const dx = positions[a].x - positions[b].x;
        const dy = positions[a].y - positions[b].y;
        const distanceSq = Math.max(0.08, dx * dx + dy * dy);
        const force = 0.035 / distanceSq;
        forces[a].x += dx * force;
        forces[a].y += dy * force;
        forces[b].x -= dx * force;
        forces[b].y -= dy * force;
      }
    }

    for (const bond of bonds) {
      const a = atomIndex.get(bond.a);
      const b = atomIndex.get(bond.b);
      if (a == null || b == null) continue;
      const dx = positions[b].x - positions[a].x;
      const dy = positions[b].y - positions[a].y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const target = bond.order === 3 ? 1.18 : bond.order === 2 || bond.order === "aromatic" ? 1.28 : 1.38;
      const pull = (distance - target) * 0.045;
      const fx = (dx / distance) * pull;
      const fy = (dy / distance) * pull;
      forces[a].x += fx;
      forces[a].y += fy;
      forces[b].x -= fx;
      forces[b].y -= fy;
    }

    for (let index = 0; index < count; index++) {
      forces[index].x -= positions[index].x * 0.004;
      forces[index].y -= positions[index].y * 0.004;
      positions[index].x += clamp(forces[index].x, -0.08, 0.08);
      positions[index].y += clamp(forces[index].y, -0.08, 0.08);
    }
  }

  return positions;
}

function normalizePositions(atoms: ParsedAtom[]): ParsedAtom[] {
  const xs = atoms.map((atom) => atom.x ?? 0);
  const ys = atoms.map((atom) => atom.y ?? 0);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const scale = 1.32 / Math.max(0.1, Math.min(2.4, Math.max(spanX / Math.max(1, atoms.length - 1), spanY / 2)));
  return atoms.map((atom) => ({
    ...atom,
    x: ((atom.x ?? 0) - centerX) * scale,
    y: ((atom.y ?? 0) - centerY) * scale,
    z: atom.z ?? 0,
  }));
}

function chooseDefaultAttachments(atoms: ParsedAtom[]) {
  const sorted = [...atoms].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  return {
    leftAtomId: sorted[0].id,
    rightAtomId: sorted[sorted.length - 1].id,
  };
}

function inferDefaultBond(a?: ParsedAtom, b?: ParsedAtom): BondOrder {
  return a?.aromatic && b?.aromatic ? "aromatic" : 1;
}

function normalizeElement(value: string): AtomSymbol {
  const raw = value.trim();
  if (!raw) throw new Error(`Missing element symbol. Supported atoms: ${SUPPORTED_ATOM_LIST}.`);
  const aromatic = raw.toLowerCase();
  const normalized = aromatic.length === 1 && "cnosp".includes(aromatic)
    ? (aromatic.toUpperCase() as AtomSymbol)
    : (raw[0]?.toUpperCase() + raw.slice(1).toLowerCase()) as AtomSymbol;
  if (!SUPPORTED_ATOMS.has(normalized)) {
    throw new Error(`Unsupported atom "${value}". Supported atoms: ${SUPPORTED_ATOM_LIST}.`);
  }
  return normalized;
}

function normalizeBondOrder(value: unknown, context: string): BondOrder {
  if (value === "aromatic" || value === 4 || value === "4" || value === ":") return "aromatic";
  if (value === 3 || value === "3" || value === "#") return 3;
  if (value === 2 || value === "2" || value === "=") return 2;
  if (value === 1 || value === "1" || value === "-" || value === "single") return 1;
  throw new Error(`Invalid bond order "${String(value)}" on ${context}. Use 1, 2, 3, or "aromatic" (4).`);
}

function sanitizeId(value: string, fallback: string) {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function safeLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const label = value.trim().replace(/[<>"']/g, "");
  return label || fallback;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
