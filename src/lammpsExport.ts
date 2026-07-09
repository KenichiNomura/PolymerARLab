import { getElementInfo } from "./elements";
import type { AtomSymbol, BondOrder, GraphAtom, MolecularGraph } from "./polymerData";

// Export the displayed structure (with hydrogens) as a self-contained LAMMPS
// setup using a pragmatic, generic UFF-style force field: no external ffield
// file is needed. Non-reactive, so the full typed topology (atoms, bonds,
// angles, dihedrals, impropers) plus all coefficients are written. Bond r0/K and
// per-element van der Waals follow UFF; angle/dihedral/improper force constants
// are generic (approximate) per the "not super accurate" brief.

const ELEMENT_MASS: Record<AtomSymbol, number> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  P: 30.974,
  S: 32.06,
  Cl: 35.45,
  Br: 79.904,
  I: 126.904,
};

// UFF non-bonded parameters: x = distance at the vdW minimum (Å), D = well depth
// (kcal/mol). Essentially per element. Combined with geometric mixing.
const UFF_VDW: Record<AtomSymbol, { x: number; d: number }> = {
  H: { x: 2.886, d: 0.044 },
  C: { x: 3.851, d: 0.105 },
  N: { x: 3.66, d: 0.069 },
  O: { x: 3.5, d: 0.06 },
  F: { x: 3.364, d: 0.05 },
  P: { x: 4.147, d: 0.305 },
  S: { x: 4.035, d: 0.274 },
  Cl: { x: 3.947, d: 0.227 },
  Br: { x: 4.189, d: 0.251 },
  I: { x: 4.5, d: 0.339 },
};

// UFF effective charges Z* for bond force constants.
const UFF_ZSTAR: Record<AtomSymbol, number> = {
  H: 0.712,
  C: 1.912,
  N: 2.544,
  O: 2.3,
  F: 1.735,
  P: 2.863,
  S: 2.703,
  Cl: 2.348,
  Br: 2.519,
  I: 2.65,
};

type Hybridization = "sp" | "sp2" | "sp3" | "terminal";

// Equilibrium angle (degrees) for a central atom by element + hybridization.
function equilibriumAngle(element: AtomSymbol, hyb: Hybridization): number {
  if (hyb === "sp") return 180;
  if (hyb === "sp2") return 120;
  // sp3 (or default): element-specific bends.
  switch (element) {
    case "N":
      return 106.7;
    case "O":
      return 104.51;
    case "S":
      return 92.1;
    case "P":
      return 93.8;
    default:
      return 109.47;
  }
}

const LAMBDA = 0.1332; // UFF bond-order correction coefficient
const BOND_K_PREFACTOR = 664.12; // kcal/mol/Å for UFF bond force constants
const ANGLE_K = 100.0; // generic harmonic angle stiffness (kcal/mol/rad^2)
const DIHEDRAL_K = 0.1; // generic weak torsion barrier (kcal/mol)
const IMPROPER_K = 10.0; // generic sp2 planarity stiffness (kcal/mol/rad^2)
const BOX_PADDING = 10; // Ångström of empty space around the molecule.

export interface LammpsCounts {
  atoms: number;
  bonds: number;
  angles: number;
  dihedrals: number;
  impropers: number;
}

export interface LammpsData {
  text: string;
  elementsInTypeOrder: AtomSymbol[];
  counts: LammpsCounts;
}

function bondOrderNumber(order: BondOrder): number {
  return order === "aromatic" ? 1.5 : order;
}

export function buildUFFData(graph: MolecularGraph, title: string): LammpsData {
  const atoms = graph.atoms;
  const indexById = new Map(atoms.map((atom, index) => [atom.id, index]));

  // Adjacency with bond orders.
  const neighbors = new Map<string, Array<{ id: string; order: BondOrder }>>();
  for (const atom of atoms) neighbors.set(atom.id, []);
  for (const bond of graph.bonds) {
    neighbors.get(bond.a)?.push({ id: bond.b, order: bond.order });
    neighbors.get(bond.b)?.push({ id: bond.a, order: bond.order });
  }

  const hybById = new Map<string, Hybridization>();
  for (const atom of atoms) hybById.set(atom.id, perceiveHybridization(neighbors.get(atom.id) ?? []));

  // Atom types = element, in order of first appearance.
  const elements: AtomSymbol[] = [];
  const atomTypeByElement = new Map<AtomSymbol, number>();
  for (const atom of atoms) {
    if (!atomTypeByElement.has(atom.element)) {
      elements.push(atom.element);
      atomTypeByElement.set(atom.element, elements.length);
    }
  }

  // Bond types keyed by sorted element pair + order.
  const bondTypeKey = (a: GraphAtom, b: GraphAtom, order: BondOrder) => {
    const [e1, e2] = [a.element, b.element].sort();
    return `${e1}-${e2}|${order}`;
  };
  const bondTypes = new Map<string, { type: number; a: AtomSymbol; b: AtomSymbol; order: BondOrder }>();
  const bondRows: Array<[number, number, number]> = []; // [type, atomIndex1, atomIndex2]
  for (const bond of graph.bonds) {
    const a = atoms[indexById.get(bond.a)!];
    const b = atoms[indexById.get(bond.b)!];
    const key = bondTypeKey(a, b, bond.order);
    let entry = bondTypes.get(key);
    if (!entry) {
      const [e1, e2] = [a.element, b.element].sort() as [AtomSymbol, AtomSymbol];
      entry = { type: bondTypes.size + 1, a: e1, b: e2, order: bond.order };
      bondTypes.set(key, entry);
    }
    bondRows.push([entry.type, indexById.get(bond.a)! + 1, indexById.get(bond.b)! + 1]);
  }

  // Angle types keyed by central element + hybridization.
  const angleTypes = new Map<string, { type: number; element: AtomSymbol; hyb: Hybridization }>();
  const angleRows: Array<[number, number, number, number]> = [];
  for (const atom of atoms) {
    const nbrs = neighbors.get(atom.id) ?? [];
    if (nbrs.length < 2) continue;
    const hyb = hybById.get(atom.id)!;
    const key = `${atom.element}|${hyb}`;
    let entry = angleTypes.get(key);
    if (!entry) {
      entry = { type: angleTypes.size + 1, element: atom.element, hyb };
      angleTypes.set(key, entry);
    }
    const center = indexById.get(atom.id)! + 1;
    for (let i = 0; i < nbrs.length; i++) {
      for (let j = i + 1; j < nbrs.length; j++) {
        angleRows.push([entry.type, indexById.get(nbrs[i].id)! + 1, center, indexById.get(nbrs[j].id)! + 1]);
      }
    }
  }

  // Dihedrals: one generic type over every i-j-k-l across a central bond j-k.
  const dihedralRows: Array<[number, number, number, number, number]> = [];
  for (const bond of graph.bonds) {
    const jId = bond.a;
    const kId = bond.b;
    const jNbrs = (neighbors.get(jId) ?? []).filter((n) => n.id !== kId);
    const kNbrs = (neighbors.get(kId) ?? []).filter((n) => n.id !== jId);
    for (const i of jNbrs) {
      for (const l of kNbrs) {
        if (i.id === l.id) continue;
        dihedralRows.push([
          1,
          indexById.get(i.id)! + 1,
          indexById.get(jId)! + 1,
          indexById.get(kId)! + 1,
          indexById.get(l.id)! + 1,
        ]);
      }
    }
  }

  // Impropers: one generic type for each 3-coordinate sp2 center (planarity).
  const improperRows: Array<[number, number, number, number, number]> = [];
  for (const atom of atoms) {
    const nbrs = neighbors.get(atom.id) ?? [];
    if (nbrs.length !== 3 || hybById.get(atom.id) !== "sp2") continue;
    const c = indexById.get(atom.id)! + 1;
    const [n1, n2, n3] = nbrs.map((n) => indexById.get(n.id)! + 1);
    improperRows.push([1, c, n1, n2, n3]);
  }

  const [lo, hi] = boundingBox(atoms);

  // -- Assemble --
  const L: string[] = [];
  L.push(`# ${title} - LAMMPS UFF-style (Polymer AR Lab). units real, atom_style full.`);
  L.push("");
  L.push(`${atoms.length} atoms`);
  L.push(`${bondRows.length} bonds`);
  L.push(`${angleRows.length} angles`);
  L.push(`${dihedralRows.length} dihedrals`);
  L.push(`${improperRows.length} impropers`);
  L.push("");
  L.push(`${elements.length} atom types`);
  L.push(`${bondTypes.size} bond types`);
  L.push(`${angleTypes.size} angle types`);
  L.push(`${dihedralRows.length > 0 ? 1 : 0} dihedral types`);
  L.push(`${improperRows.length > 0 ? 1 : 0} improper types`);
  L.push("");
  L.push(`${fixed(lo[0])} ${fixed(hi[0])} xlo xhi`);
  L.push(`${fixed(lo[1])} ${fixed(hi[1])} ylo yhi`);
  L.push(`${fixed(lo[2])} ${fixed(hi[2])} zlo zhi`);
  L.push("");

  L.push("Masses", "");
  for (const element of elements) L.push(`${atomTypeByElement.get(element)} ${ELEMENT_MASS[element] ?? 0} # ${element}`);
  L.push("");

  L.push("Pair Coeffs # lj/cut", "");
  for (const element of elements) {
    const vdw = UFF_VDW[element] ?? { x: 3.5, d: 0.06 };
    const sigma = vdw.x / Math.pow(2, 1 / 6);
    L.push(`${atomTypeByElement.get(element)} ${num(vdw.d)} ${num(sigma)} # ${element}`);
  }
  L.push("");

  L.push("Bond Coeffs # harmonic", "");
  for (const entry of bondTypes.values()) {
    const ri = getElementInfo(entry.a).radius;
    const rj = getElementInfo(entry.b).radius;
    const n = bondOrderNumber(entry.order);
    const r0 = (ri + rj) * (1 - LAMBDA * Math.log(n));
    const k = 0.5 * BOND_K_PREFACTOR * ((UFF_ZSTAR[entry.a] ?? 1) * (UFF_ZSTAR[entry.b] ?? 1)) / Math.pow(r0, 3);
    L.push(`${entry.type} ${num(k)} ${num(r0)} # ${entry.a}-${entry.b} order ${entry.order}`);
  }
  L.push("");

  L.push("Angle Coeffs # harmonic", "");
  for (const entry of angleTypes.values()) {
    const theta0 = equilibriumAngle(entry.element, entry.hyb);
    L.push(`${entry.type} ${num(ANGLE_K)} ${num(theta0)} # ${entry.element} ${entry.hyb}`);
  }
  L.push("");

  if (dihedralRows.length > 0) {
    // harmonic: K, d(+1/-1), n
    L.push("Dihedral Coeffs # harmonic", "", `1 ${num(DIHEDRAL_K)} 1 3 # generic weak torsion`, "");
  }
  if (improperRows.length > 0) {
    // umbrella: K, omega0 (deg) — 0 for planar sp2
    L.push("Improper Coeffs # umbrella", "", `1 ${num(IMPROPER_K)} 0.0 # generic sp2 planarity`, "");
  }

  L.push("Atoms # full", "");
  atoms.forEach((atom, index) => {
    const type = atomTypeByElement.get(atom.element)!;
    L.push(`${index + 1} 1 ${type} 0.0 ${fixed(atom.position[0])} ${fixed(atom.position[1])} ${fixed(atom.position[2])}`);
  });
  L.push("");

  L.push("Bonds", "");
  bondRows.forEach((row, index) => L.push(`${index + 1} ${row[0]} ${row[1]} ${row[2]}`));
  L.push("");

  if (angleRows.length > 0) {
    L.push("Angles", "");
    angleRows.forEach((row, index) => L.push(`${index + 1} ${row[0]} ${row[1]} ${row[2]} ${row[3]}`));
    L.push("");
  }
  if (dihedralRows.length > 0) {
    L.push("Dihedrals", "");
    dihedralRows.forEach((row, index) => L.push(`${index + 1} ${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]}`));
    L.push("");
  }
  if (improperRows.length > 0) {
    L.push("Impropers", "");
    improperRows.forEach((row, index) => L.push(`${index + 1} ${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]}`));
    L.push("");
  }

  return {
    text: L.join("\n"),
    elementsInTypeOrder: elements,
    counts: {
      atoms: atoms.length,
      bonds: bondRows.length,
      angles: angleRows.length,
      dihedrals: dihedralRows.length,
      impropers: improperRows.length,
    },
  };
}

export function buildUFFInput(elements: AtomSymbol[], name: string, counts: LammpsCounts): string {
  const species = elements.join(" ");
  return [
    `# Relax ${name} with a generic UFF-style force field (self-contained; approximate).`,
    "# Coefficients are embedded in the data file - no external ffield needed.",
    "# FIRE minimization, then NVT @ 300 K for 2 ps.",
    "",
    "units           real",
    "atom_style      full",
    "boundary        s s s          # finite molecule (shrink-wrapped); use 'p p p' for a periodic cell",
    "",
    "pair_style      lj/cut 10.0",
    "pair_modify     mix geometric tail no",
    "bond_style      harmonic",
    counts.angles > 0 ? "angle_style     harmonic" : "angle_style     none",
    counts.dihedrals > 0 ? "dihedral_style  harmonic" : "dihedral_style  none",
    counts.impropers > 0 ? "improper_style  umbrella" : "improper_style  none",
    "",
    "# N^2 neighbor build (no bins): robust for a single molecule in a large",
    "# vacuum box, avoids 'Too many neighbor bins'. Fine for these small systems.",
    "neighbor        2.0 nsq",
    "neigh_modify    delay 0 every 1 check yes",
    "",
    `read_data       ${name}.data`,
    "",
    "thermo          100",
    "thermo_style    custom step temp pe etotal",
    "",
    "# One trajectory (multi-frame XYZ) spanning the FIRE relaxation and the NVT",
    "# run. Declared before minimize so both phases are recorded; 'first yes'",
    "# guarantees the initial (pre-relaxation) frame is written.",
    `dump            traj all xyz 20 ${name}.traj.xyz`,
    `dump_modify     traj element ${species} sort id first yes`,
    "",
    "# FIRE energy minimization",
    "min_style       fire",
    "minimize        1.0e-6 1.0e-8 10000 100000",
    "",
    "# NVT at 300 K for 2 ps (0.5 fs timestep x 4000 steps)",
    "timestep        0.5",
    "velocity        all create 300.0 12345 mom yes rot yes dist gaussian",
    "fix             nvt all nvt temp 300.0 300.0 100.0",
    "run             4000",
    "",
    `write_data      ${name}.relaxed.data`,
    "",
  ].join("\n");
}

function perceiveHybridization(nbrs: Array<{ id: string; order: BondOrder }>): Hybridization {
  if (nbrs.length <= 1) return "terminal";
  if (nbrs.some((n) => n.order === 3)) return "sp";
  if (nbrs.some((n) => n.order === 2 || n.order === "aromatic")) return "sp2";
  return "sp3";
}

function boundingBox(atoms: GraphAtom[]): [[number, number, number], [number, number, number]] {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const atom of atoms) {
    for (let axis = 0; axis < 3; axis++) {
      lo[axis] = Math.min(lo[axis], atom.position[axis]);
      hi[axis] = Math.max(hi[axis], atom.position[axis]);
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(lo[axis]) || !Number.isFinite(hi[axis])) {
      lo[axis] = -BOX_PADDING;
      hi[axis] = BOX_PADDING;
    } else {
      lo[axis] -= BOX_PADDING;
      hi[axis] += BOX_PADDING;
    }
  }
  return [lo, hi];
}

function fixed(value: number): string {
  return value.toFixed(4);
}

function num(value: number): string {
  return Number(value.toFixed(4)).toString();
}

// Download a text file via a transient object-URL anchor (mirrors usdzExport).
export function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}
