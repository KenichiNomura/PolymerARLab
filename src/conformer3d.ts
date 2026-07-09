import { ConformerGenerator, Molecule, Resources } from "openchemlib";
import type { BondOrder, PolymerTemplate } from "./polymerData";

// Real 3D geometry via openchemlib's torsion-library conformer generator.
// The template's graph is converted to a molfile, embedded in 3D (openchemlib
// saturates free valences with hydrogens internally; only the original atoms
// are read back), and the coordinates replace the heuristic VSEPR layout.
// Callers fall back to the VSEPR layout when this returns null.

const MAX_CONFORMER_ATOMS = 60;
const REPEAT_LINK_BOND = 1.53;

// The conformer generator needs openchemlib's static resources (torsion
// library). They are served like the RDKit assets so the app stays static.
let resourcesReady = false;
let resourcesPromise: Promise<void> | null = null;

export function conformerResourcesReady(): boolean {
  return resourcesReady;
}

export function preloadConformerResources(): Promise<void> {
  if (!resourcesPromise) {
    const url = new URL("vendor/openchemlib/resources.json", document.baseURI ?? window.location.href).toString();
    resourcesPromise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`openchemlib resources failed to load (HTTP ${response.status}).`);
        return response.text();
      })
      .then((text) => {
        Resources.register(text);
        resourcesReady = true;
      })
      .catch((error) => {
        resourcesPromise = null;
        throw error;
      });
  }
  return resourcesPromise;
}

export interface Conformer3DOptions {
  mode: "molecule" | "polymer";
  /** Also emit the hydrogens openchemlib adds to satisfy valences. */
  includeHydrogens?: boolean;
}

interface HydrogenRecord {
  parentIndex: number;
  position: Vec3;
}

export function templateTo3D(template: PolymerTemplate, options: Conformer3DOptions): PolymerTemplate | null {
  if (!resourcesReady) return null;
  if (template.atoms.length < 2 || template.atoms.length > MAX_CONFORMER_ATOMS) return null;

  try {
    // fromMolfile reorders atoms during parsing (hydrogens move to the end),
    // so use the variant that reports molfile-index -> molecule-index.
    const { molecule: mol, map } = Molecule.fromMolfileWithAtomMap(templateToMolfile(template));
    if (mol.getAllAtoms() !== template.atoms.length || map.length < template.atoms.length) return null;

    const generator = new ConformerGenerator(42);
    const conformer = generator.getOneConformerAsMolecule(mol);
    if (!conformer) return null;

    let positions = template.atoms.map((_, index): Vec3 => {
      const atom = map[index];
      return [conformer.getAtomX(atom), conformer.getAtomY(atom), conformer.getAtomZ(atom)];
    });
    let hydrogens = options.includeHydrogens ? collectGeneratedHydrogens(conformer, template, map) : [];

    if (options.mode === "polymer") {
      const aligned = alignToConnection(template, positions, hydrogens);
      if (!aligned) return null;
      positions = aligned.positions;
      hydrogens = dropChainLinkHydrogens(template, aligned.hydrogens);
      return withHydrogens(
        {
          ...template,
          atoms: template.atoms.map((atom, index) => ({ ...atom, position: roundVec(positions[index]) })),
          step: [round(aligned.stepX), 0, 0],
        },
        hydrogens,
      );
    }

    const centered = centerPositions([...positions, ...hydrogens.map((hydrogen) => hydrogen.position)]);
    return withHydrogens(
      {
        ...template,
        atoms: template.atoms.map((atom, index) => ({ ...atom, position: roundVec(centered[index]) })),
      },
      hydrogens.map((hydrogen, index) => ({ ...hydrogen, position: centered[positions.length + index] })),
    );
  } catch {
    return null;
  }
}

// The conformer generator saturates free valences with hydrogens and places
// them in 3D; keep them, attached to their template parent atoms.
function collectGeneratedHydrogens(
  conformer: Molecule,
  template: PolymerTemplate,
  map: number[],
): HydrogenRecord[] {
  const templateIndexByMolAtom = new Map<number, number>();
  template.atoms.forEach((_, index) => templateIndexByMolAtom.set(map[index], index));

  const hydrogens: HydrogenRecord[] = [];
  for (let bond = 0; bond < conformer.getAllBonds(); bond++) {
    const a = conformer.getBondAtom(0, bond);
    const b = conformer.getBondAtom(1, bond);
    const generated = (atom: number) => !templateIndexByMolAtom.has(atom) && conformer.getAtomicNo(atom) === 1;
    const hydrogenAtom = generated(a) ? a : generated(b) ? b : -1;
    if (hydrogenAtom < 0) continue;
    const parentIndex = templateIndexByMolAtom.get(hydrogenAtom === a ? b : a);
    if (parentIndex == null) continue;
    hydrogens.push({
      parentIndex,
      position: [conformer.getAtomX(hydrogenAtom), conformer.getAtomY(hydrogenAtom), conformer.getAtomZ(hydrogenAtom)],
    });
  }
  return hydrogens;
}

// Attachment atoms give one hydrogen each to the repeat link, so hide the
// hydrogen pointing along the chain axis (outward) on each side.
function dropChainLinkHydrogens(template: PolymerTemplate, hydrogens: HydrogenRecord[]): HydrogenRecord[] {
  const leftIndex = template.atoms.findIndex((atom) => atom.id === template.connection.leftAtomId);
  const rightIndex = template.atoms.findIndex((atom) => atom.id === template.connection.rightAtomId);

  const dropOutermost = (records: HydrogenRecord[], parentIndex: number, direction: 1 | -1) => {
    let dropAt = -1;
    let best = -Infinity;
    records.forEach((record, index) => {
      if (record.parentIndex !== parentIndex) return;
      const along = record.position[0] * direction;
      if (along > best) {
        best = along;
        dropAt = index;
      }
    });
    return dropAt < 0 ? records : records.filter((_, index) => index !== dropAt);
  };

  let result = dropOutermost(hydrogens, leftIndex, -1);
  result = dropOutermost(result, rightIndex, 1);
  return result;
}

function withHydrogens(template: PolymerTemplate, hydrogens: HydrogenRecord[]): PolymerTemplate {
  if (hydrogens.length === 0) return template;
  const atoms = [...template.atoms];
  const bonds = [...template.bonds];
  hydrogens.forEach((hydrogen, index) => {
    const parent = template.atoms[hydrogen.parentIndex];
    atoms.push({ id: `hx${index + 1}`, element: "H", position: roundVec(hydrogen.position) });
    bonds.push({ id: `hxb${index + 1}`, a: parent.id, b: `hx${index + 1}`, order: 1 });
  });
  return { ...template, atoms, bonds };
}

type Vec3 = [number, number, number];

function templateToMolfile(template: PolymerTemplate): string {
  // openchemlib's conformer generator does not resolve molfile type-4
  // (delocalized) bonds, producing puckered rings, so kekulize first.
  const kekulized = kekulizeAromaticBonds(template);
  if (!kekulized) throw new Error("Aromatic system could not be kekulized.");

  const indexById = new Map(template.atoms.map((atom, index) => [atom.id, index + 1]));
  const lines = [
    "",
    "  PolymerARLab",
    "",
    `${pad(template.atoms.length, 3)}${pad(template.bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`,
  ];
  for (const atom of template.atoms) {
    lines.push(
      `${coord(atom.position[0])}${coord(atom.position[1])}${coord(atom.position[2])} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  }
  for (const bond of template.bonds) {
    const a = indexById.get(bond.a);
    const b = indexById.get(bond.b);
    if (!a || !b) throw new Error(`Bond ${bond.id} references unknown atom.`);
    const type = bond.order === "aromatic" ? kekulized.get(bond.id)! : bond.order;
    lines.push(`${pad(a, 3)}${pad(b, 3)}${pad(type, 3)}  0`);
  }
  lines.push("M  END", "");
  return lines.join("\n");
}

// Assign alternating single/double bonds to the aromatic subgraph: every
// aromatic carbon gets exactly one double bond, aromatic nitrogens may take
// one (pyridine) or none (pyrrole), aromatic O/S never do.
function kekulizeAromaticBonds(template: PolymerTemplate): Map<string, 1 | 2> | null {
  const aromaticBonds = template.bonds.filter((bond) => bond.order === "aromatic");
  const assignment = new Map<string, 1 | 2>();
  if (aromaticBonds.length === 0) return assignment;

  const elementById = new Map(template.atoms.map((atom) => [atom.id, atom.element]));
  const neighbors = new Map<string, Array<{ bondId: string; atomId: string }>>();
  for (const bond of aromaticBonds) {
    if (!neighbors.has(bond.a)) neighbors.set(bond.a, []);
    if (!neighbors.has(bond.b)) neighbors.set(bond.b, []);
    neighbors.get(bond.a)!.push({ bondId: bond.id, atomId: bond.b });
    neighbors.get(bond.b)!.push({ bondId: bond.id, atomId: bond.a });
  }

  const needsDouble = (atomId: string) => elementById.get(atomId) === "C";
  const mayDouble = (atomId: string) => {
    const element = elementById.get(atomId);
    return element === "C" || element === "N";
  };
  const covered = new Set<string>();

  const solve = (): boolean => {
    const pending = [...neighbors.keys()].find((atomId) => needsDouble(atomId) && !covered.has(atomId));
    if (!pending) return true;
    for (const { bondId, atomId } of neighbors.get(pending)!) {
      if (assignment.get(bondId) === 1 || covered.has(atomId) || !mayDouble(atomId)) continue;
      assignment.set(bondId, 2);
      covered.add(pending);
      covered.add(atomId);
      if (solve()) return true;
      assignment.delete(bondId);
      covered.delete(pending);
      covered.delete(atomId);
    }
    // Mark remaining bonds of this atom single and fail this branch if the
    // atom truly cannot be covered.
    return false;
  };

  if (!solve()) return null;
  for (const bond of aromaticBonds) {
    if (!assignment.has(bond.id)) assignment.set(bond.id, 1);
  }
  return assignment as Map<string, 1 | 2>;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width);
}

function coord(value: number): string {
  return value.toFixed(4).padStart(10);
}

// Rigidly rotate the conformer so the left->right attachment vector lies
// along +x, with the left attachment at the origin. The repeat step is the
// attachment span plus one linking bond.
function alignToConnection(
  template: PolymerTemplate,
  positions: Vec3[],
  hydrogens: HydrogenRecord[],
): { positions: Vec3[]; hydrogens: HydrogenRecord[]; stepX: number } | null {
  const leftIndex = template.atoms.findIndex((atom) => atom.id === template.connection.leftAtomId);
  const rightIndex = template.atoms.findIndex((atom) => atom.id === template.connection.rightAtomId);
  if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) return null;

  const origin = positions[leftIndex];
  const axis = subVec(positions[rightIndex], origin);
  const axisLength = Math.hypot(...axis);
  if (axisLength < 0.1) return null;

  const u1: Vec3 = [axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength];
  const helper: Vec3 = Math.abs(u1[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u2 = normalizeVec(crossVec(helper, u1));
  const u3 = crossVec(u1, u2);

  const transform = (position: Vec3): Vec3 => {
    const relative = subVec(position, origin);
    return [dotVec(relative, u1), dotVec(relative, u2), dotVec(relative, u3)];
  };

  const alignedPositions = positions.map(transform);
  const alignedHydrogens = hydrogens.map((hydrogen) => ({ ...hydrogen, position: transform(hydrogen.position) }));
  const allPoints = [...alignedPositions, ...alignedHydrogens.map((hydrogen) => hydrogen.position)];

  return {
    positions: alignedPositions,
    hydrogens: alignedHydrogens,
    stepX: clashFreeStepX(allPoints, axisLength, leftIndex, rightIndex),
  };
}

// Widen the per-unit translation so neighbouring repeat units do not overlap.
// Starts from the ideal (attachment span + one link bond) and grows only as much
// as needed, so slim backbones (e.g. polyethylene) stay tight while bulky
// side-groups get room. Consecutive units alternate the syndiotactic y/z flip
// (see orientSyndiotacticSideGroup), so both orderings are checked.
const MIN_INTERUNIT_CONTACT = 1.15; // Å; closest allowed non-bonded approach between units (mild residual is relieved by the LAMMPS warm-up)
const STEP_INCREMENT = 0.1;

function clashFreeStepX(points: Vec3[], axisLength: number, leftIndex: number, rightIndex: number): number {
  const base = axisLength + REPEAT_LINK_BOND;
  const flipped = points.map((p): Vec3 => [p[0], -p[1], -p[2]]);
  const min2 = MIN_INTERUNIT_CONTACT * MIN_INTERUNIT_CONTACT;

  const clashes = (stepX: number): boolean => {
    for (const [a, b] of [
      [points, flipped],
      [flipped, points],
    ] as const) {
      for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
          if (i === rightIndex && j === leftIndex) continue; // the inter-unit link bond itself
          const dx = a[i][0] - (b[j][0] + stepX);
          const dy = a[i][1] - b[j][1];
          const dz = a[i][2] - b[j][2];
          if (dx * dx + dy * dy + dz * dz < min2) return true;
        }
      }
    }
    return false;
  };

  let stepX = base;
  const cap = base + 15;
  while (stepX < cap && clashes(stepX)) stepX += STEP_INCREMENT;
  return stepX;
}

function centerPositions(positions: Vec3[]): Vec3[] {
  const centroid: Vec3 = [0, 0, 0];
  for (const position of positions) {
    centroid[0] += position[0] / positions.length;
    centroid[1] += position[1] / positions.length;
    centroid[2] += position[2] / positions.length;
  }
  return positions.map((position) => subVec(position, centroid));
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalizeVec(a: Vec3): Vec3 {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function roundVec(value: Vec3): Vec3 {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
