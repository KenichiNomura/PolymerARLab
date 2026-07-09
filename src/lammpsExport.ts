import type { AtomSymbol, MolecularGraph } from "./polymerData";

// Export the displayed structure (with hydrogens) as LAMMPS ReaxFF input.
// ReaxFF is a bond-order potential: it infers bonds from geometry, so the data
// file carries only atoms + masses + a box (atom_style charge, charges 0 for
// QEq). No force-field coefficients are invented — the user supplies ffield.reax.

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

const BOX_PADDING = 10; // Ångström of empty space around the molecule.

export interface ReaxFFData {
  text: string;
  elementsInTypeOrder: AtomSymbol[];
  atomCount: number;
}

export function buildReaxFFData(graph: MolecularGraph, title: string): ReaxFFData {
  // Atom types = unique elements in order of first appearance; this order must
  // match the pair_coeff element list in the input script.
  const elements: AtomSymbol[] = [];
  const typeByElement = new Map<AtomSymbol, number>();
  for (const atom of graph.atoms) {
    if (!typeByElement.has(atom.element)) {
      elements.push(atom.element);
      typeByElement.set(atom.element, elements.length);
    }
  }

  const [lo, hi] = boundingBox(graph);

  const lines: string[] = [];
  lines.push(`# ${title} - LAMMPS ReaxFF data (Polymer AR Lab). units real, atom_style charge.`);
  lines.push("");
  lines.push(`${graph.atoms.length} atoms`);
  lines.push(`${elements.length} atom types`);
  lines.push("");
  lines.push(`${fixed(lo[0])} ${fixed(hi[0])} xlo xhi`);
  lines.push(`${fixed(lo[1])} ${fixed(hi[1])} ylo yhi`);
  lines.push(`${fixed(lo[2])} ${fixed(hi[2])} zlo zhi`);
  lines.push("");
  lines.push("Masses");
  lines.push("");
  for (const element of elements) {
    lines.push(`${typeByElement.get(element)} ${ELEMENT_MASS[element] ?? 0} # ${element}`);
  }
  lines.push("");
  lines.push("Atoms # charge");
  lines.push("");
  graph.atoms.forEach((atom, index) => {
    const type = typeByElement.get(atom.element)!;
    lines.push(`${index + 1} ${type} 0.0 ${fixed(atom.position[0])} ${fixed(atom.position[1])} ${fixed(atom.position[2])}`);
  });
  lines.push("");

  return { text: lines.join("\n"), elementsInTypeOrder: elements, atomCount: graph.atoms.length };
}

export function buildReaxFFInput(elements: AtomSymbol[], name: string): string {
  const species = elements.join(" ");
  return [
    `# Relax ${name} with ReaxFF: FIRE minimization, then NVT @ 300 K for 2 ps.`,
    `# Provide a ReaxFF force-field file 'ffield.reax' with parameters for: ${elements.join(", ")}.`,
    `# Element order below must match the atom types in ${name}.data.`,
    "",
    "units           real",
    "atom_style      charge",
    "boundary        s s s          # finite molecule (shrink-wrapped); use 'p p p' for a periodic cell",
    "",
    `read_data       ${name}.data`,
    "",
    "pair_style      reaxff NULL",
    `pair_coeff      * * ffield.reax ${species}`,
    "fix             qeq all qeq/reaxff 1 0.0 10.0 1e-6 reaxff",
    "",
    "thermo          100",
    "thermo_style    custom step temp pe etotal",
    "",
    "# One trajectory (multi-frame XYZ) spanning the minimization and the NVT run.",
    `dump            traj all xyz 100 ${name}.traj.xyz`,
    `dump_modify     traj element ${species} sort id`,
    "",
    "# FIRE energy minimization",
    "min_style       fire",
    "minimize        1.0e-6 1.0e-8 10000 100000",
    "",
    "# NVT at 300 K for 2 ps (0.25 fs timestep x 8000 steps)",
    "timestep        0.25",
    "velocity        all create 300.0 12345 mom yes rot yes dist gaussian",
    "fix             nvt all nvt temp 300.0 300.0 25.0",
    "run             8000",
    "",
    `write_data      ${name}.relaxed.data`,
    "",
  ].join("\n");
}

function boundingBox(graph: MolecularGraph): [[number, number, number], [number, number, number]] {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const atom of graph.atoms) {
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

// Download a text file via a transient object-URL anchor (mirrors usdzExport).
export function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}
