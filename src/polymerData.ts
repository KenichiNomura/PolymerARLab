export type AtomSymbol = "H" | "C" | "N" | "O" | "S" | "P" | "F" | "Cl" | "Br" | "I";
export type BondOrder = 1 | 2 | 3 | "aromatic";

/** How monomers join: addition opens a multiple bond; condensation expels a
 *  small byproduct molecule (water) each time a link bond forms. */
export type PolymerMechanism = "addition" | "condensation";

export interface ByproductInfo {
  formula: "H2O";
  label: string;
}

/** What a chain-end anchor regains when capped: a plain hydrogen, or a full
 *  hydroxyl for a condensation acid carbon (so the end reads -COOH, not -CHO). */
export type ChainCapKind = "H" | "OH";

/** One byproduct molecule released by a formed link bond, referencing the two
 *  graph atoms it departed from. Metadata only — never part of atoms/bonds, so
 *  exports (LAMMPS, USDZ) stay byproduct-free by construction. */
export interface ByproductSite {
  id: string;
  atomA: string;
  atomB: string;
  unit: number;
  formula: "H2O";
}

/** Free-floating caption sprite in molecule space (e.g. "A"/"B" over the
 *  side-by-side monomer preview). Display-only; ignored by exports. */
export interface SceneTag {
  label: string;
  position: [number, number, number];
}

export interface TemplateAtom {
  id: string;
  element: AtomSymbol;
  position: [number, number, number];
  label?: string;
}

export interface TemplateBond {
  id: string;
  a: string;
  b: string;
  order: BondOrder;
}

export interface TemplateGroup {
  id: string;
  label: string;
  atomIds: string[];
  bondIds: string[];
  color: number;
}

export interface PolymerTemplate {
  id: string;
  name: string;
  shortName: string;
  family: string;
  repeatLabel: string;
  defaultRepeats: number;
  maxRepeats: number;
  step: [number, number, number];
  connection: {
    leftAtomId: string;
    rightAtomId: string;
    order: BondOrder;
    /** Defaults to "addition" (no byproduct). */
    mechanism?: PolymerMechanism;
    /** Released once per inter-unit link when mechanism is "condensation". */
    byproduct?: ByproductInfo;
    /** Chain-end caps; default "H". "OH" restores a condensation acid end. */
    leftCap?: ChainCapKind;
    rightCap?: ChainCapKind;
  };
  /** Template bonds that already released a byproduct when the unit was built
   *  (the internal A-B bond of a merged two-monomer condensation unit). */
  byproductSites?: Array<{ bondId: string; byproduct: ByproductInfo }>;
  /** Caption sprites (molecule-mode display only, copied verbatim to the graph). */
  tags?: SceneTag[];
  atoms: TemplateAtom[];
  bonds: TemplateBond[];
  groups: TemplateGroup[];
  /** Atoms already carry final 3D coordinates; skip conformer/VSEPR layout. */
  explicitGeometry?: boolean;
  /** Radians to rotate each successive repeat unit about the backbone (+x) axis
   *  so side groups spiral clear of neighbours. Defaults to PI (syndiotactic flip). */
  twist?: number;
}

export interface GraphAtom {
  id: string;
  templateAtomId: string;
  element: AtomSymbol;
  position: [number, number, number];
  unit: number;
  label: string;
}

export interface GraphBond {
  id: string;
  templateBondId: string;
  a: string;
  b: string;
  order: BondOrder;
  unit: number;
}

export interface GraphGroup {
  id: string;
  templateGroupId: string;
  label: string;
  color: number;
  atomIds: string[];
  bondIds: string[];
}

export interface MolecularGraph {
  templateId: string;
  templateName: string;
  repeatCount: number;
  atoms: GraphAtom[];
  bonds: GraphBond[];
  groups: GraphGroup[];
  warnings: string[];
  /** Water molecules released while forming this chain (condensation only). */
  byproducts: ByproductSite[];
  /** Caption sprites (e.g. "A"/"B" over the monomer pair preview). */
  tags?: SceneTag[];
}

function atom(id: string, element: AtomSymbol, x: number, y: number, z = 0, label?: string): TemplateAtom {
  return { id, element, position: [x, y, z], label };
}

function bond(id: string, a: string, b: string, order: BondOrder): TemplateBond {
  return { id, a, b, order };
}

function ringAtoms(prefix: string, centerX: number, centerY: number, radius = 0.84): TemplateAtom[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI / 3);
    return atom(`${prefix}${index}`, "C", centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  });
}

function aromaticRingBonds(prefix: string): TemplateBond[] {
  return Array.from({ length: 6 }, (_, index) =>
    bond(`${prefix}${index}${(index + 1) % 6}`, `${prefix}${index}`, `${prefix}${(index + 1) % 6}`, "aromatic"),
  );
}

export const POLYMER_TEMPLATES: PolymerTemplate[] = [
  {
    id: "polystyrene",
    name: "Polystyrene",
    shortName: "PS",
    family: "Aromatic vinyl polymer",
    repeatLabel: "[-CH2-CH(Ph)-]n",
    defaultRepeats: 4,
    maxRepeats: 12,
    step: [2.9, 0, 0],
    connection: { leftAtomId: "bb0", rightAtomId: "bb1", order: 1 },
    atoms: [
      atom("bb0", "C", 0, 0, 0, "backbone"),
      atom("bb1", "C", 1.45, 0, 0, "backbone"),
      ...ringAtoms("ph", 1.45, 1.58),
    ],
    bonds: [
      bond("bb", "bb0", "bb1", 1),
      bond("phenylAttach", "bb1", "ph0", 1),
      ...aromaticRingBonds("ph"),
    ],
    groups: [
      {
        id: "backbone",
        label: "Vinyl backbone",
        atomIds: ["bb0", "bb1"],
        bondIds: ["bb"],
        color: 0x36b37e,
      },
      {
        id: "phenyl",
        label: "Phenyl ring",
        atomIds: ["ph0", "ph1", "ph2", "ph3", "ph4", "ph5"],
        bondIds: ["ph01", "ph12", "ph23", "ph34", "ph45", "ph50"],
        color: 0xf2b84b,
      },
    ],
  },
  {
    id: "pet",
    name: "Polyethylene terephthalate",
    shortName: "PET",
    family: "Aromatic polyester",
    repeatLabel: "[-O-CH2-CH2-O-CO-Ph-CO-]n",
    defaultRepeats: 4,
    maxRepeats: 8,
    step: [10.35, 0, 0],
    connection: { leftAtomId: "oLeft", rightAtomId: "ch2b", order: 1 },
    atoms: [
      atom("oLeft", "O", 0, 0, 0, "ester O"),
      atom("cCarbonylA", "C", 1.18, 0, 0, "carbonyl C"),
      atom("oCarbonylA", "O", 1.18, 1.08, 0, "carbonyl O"),
      ...ringAtoms("ar", 3.07, 0),
      atom("cCarbonylB", "C", 4.96, 0, 0, "carbonyl C"),
      atom("oCarbonylB", "O", 4.96, -1.08, 0, "carbonyl O"),
      atom("oRight", "O", 6.14, 0, 0, "ester O"),
      atom("ch2a", "C", 7.38, 0, 0, "ethylene"),
      atom("ch2b", "C", 8.72, 0, 0, "ethylene"),
    ],
    bonds: [
      bond("esterA", "oLeft", "cCarbonylA", 1),
      bond("carbonylA", "cCarbonylA", "oCarbonylA", 2),
      bond("arylCarbonylA", "cCarbonylA", "ar3", 1),
      ...aromaticRingBonds("ar"),
      bond("arylCarbonylB", "ar0", "cCarbonylB", 1),
      bond("carbonylB", "cCarbonylB", "oCarbonylB", 2),
      bond("esterB", "cCarbonylB", "oRight", 1),
      bond("etherA", "oRight", "ch2a", 1),
      bond("ethylene", "ch2a", "ch2b", 1),
    ],
    groups: [
      {
        id: "aromatic",
        label: "Terephthalate ring",
        atomIds: ["ar0", "ar1", "ar2", "ar3", "ar4", "ar5"],
        bondIds: ["ar01", "ar12", "ar23", "ar34", "ar45", "ar50"],
        color: 0xf2b84b,
      },
      {
        id: "ester",
        label: "Ester carbonyls",
        atomIds: ["oLeft", "cCarbonylA", "oCarbonylA", "cCarbonylB", "oCarbonylB", "oRight"],
        bondIds: ["esterA", "carbonylA", "carbonylB", "esterB"],
        color: 0xff6b4a,
      },
      {
        id: "glycol",
        label: "Ethylene spacer",
        atomIds: ["oRight", "ch2a", "ch2b"],
        bondIds: ["etherA", "ethylene"],
        color: 0x44c7d8,
      },
    ],
  },
  {
    id: "pan",
    name: "Polyacrylonitrile",
    shortName: "PAN",
    family: "Nitrile vinyl polymer",
    repeatLabel: "[-CH2-CH(CN)-]n",
    defaultRepeats: 4,
    maxRepeats: 14,
    step: [2.9, 0, 0],
    connection: { leftAtomId: "bb0", rightAtomId: "bb1", order: 1 },
    atoms: [
      atom("bb0", "C", 0, 0, 0, "backbone"),
      atom("bb1", "C", 1.45, 0, 0, "backbone"),
      atom("cyanoC", "C", 1.45, 1.22, 0, "nitrile C"),
      atom("cyanoN", "N", 1.45, 2.36, 0, "nitrile N"),
    ],
    bonds: [
      bond("bb", "bb0", "bb1", 1),
      bond("cyanoAttach", "bb1", "cyanoC", 1),
      bond("nitrile", "cyanoC", "cyanoN", 3),
    ],
    groups: [
      {
        id: "backbone",
        label: "Vinyl backbone",
        atomIds: ["bb0", "bb1"],
        bondIds: ["bb"],
        color: 0x36b37e,
      },
      {
        id: "nitrile",
        label: "Nitrile group",
        atomIds: ["cyanoC", "cyanoN"],
        bondIds: ["nitrile"],
        color: 0x3f8cff,
      },
    ],
  },
  {
    id: "nylon66",
    name: "Nylon 6,6 segment",
    shortName: "PA66",
    family: "Polyamide",
    repeatLabel: "[-NH-(CH2)6-NH-CO-(CH2)4-CO-]n",
    defaultRepeats: 4,
    maxRepeats: 6,
    step: [13.2, 0, 0],
    connection: { leftAtomId: "nA", rightAtomId: "cCarbonylB", order: 1 },
    atoms: [
      atom("nA", "N", 0, 0, 0, "amide N"),
      atom("m1", "C", 1.28, 0, 0, "methylene"),
      atom("m2", "C", 2.56, 0, 0, "methylene"),
      atom("m3", "C", 3.84, 0, 0, "methylene"),
      atom("m4", "C", 5.12, 0, 0, "methylene"),
      atom("m5", "C", 6.4, 0, 0, "methylene"),
      atom("m6", "C", 7.68, 0, 0, "methylene"),
      atom("nB", "N", 8.96, 0, 0, "amide N"),
      atom("cCarbonylA", "C", 10.16, 0, 0, "carbonyl C"),
      atom("oCarbonylA", "O", 10.16, 1.08, 0, "carbonyl O"),
      atom("d1", "C", 11.44, 0, 0, "diacid spacer"),
      atom("d2", "C", 12.72, 0, 0, "diacid spacer"),
      atom("d3", "C", 14.0, 0, 0, "diacid spacer"),
      atom("d4", "C", 15.28, 0, 0, "diacid spacer"),
      atom("cCarbonylB", "C", 16.48, 0, 0, "carbonyl C"),
      atom("oCarbonylB", "O", 16.48, -1.08, 0, "carbonyl O"),
    ],
    bonds: [
      bond("nA-m1", "nA", "m1", 1),
      bond("m1-m2", "m1", "m2", 1),
      bond("m2-m3", "m2", "m3", 1),
      bond("m3-m4", "m3", "m4", 1),
      bond("m4-m5", "m4", "m5", 1),
      bond("m5-m6", "m5", "m6", 1),
      bond("m6-nB", "m6", "nB", 1),
      bond("amideA", "nB", "cCarbonylA", 1),
      bond("carbonylA", "cCarbonylA", "oCarbonylA", 2),
      bond("acidA", "cCarbonylA", "d1", 1),
      bond("d1-d2", "d1", "d2", 1),
      bond("d2-d3", "d2", "d3", 1),
      bond("d3-d4", "d3", "d4", 1),
      bond("acidB", "d4", "cCarbonylB", 1),
      bond("carbonylB", "cCarbonylB", "oCarbonylB", 2),
    ],
    groups: [
      {
        id: "amide",
        label: "Amide groups",
        atomIds: ["nB", "cCarbonylA", "oCarbonylA", "cCarbonylB", "oCarbonylB"],
        bondIds: ["amideA", "carbonylA", "carbonylB"],
        color: 0xff6b4a,
      },
      {
        id: "aliphatic",
        label: "Aliphatic spacers",
        atomIds: ["m1", "m2", "m3", "m4", "m5", "m6", "d1", "d2", "d3", "d4"],
        bondIds: ["m1-m2", "m2-m3", "m3-m4", "m4-m5", "m5-m6", "d1-d2", "d2-d3", "d3-d4"],
        color: 0x36b37e,
      },
    ],
  },
];

export function getTemplate(id: string): PolymerTemplate {
  return POLYMER_TEMPLATES.find((template) => template.id === id) ?? POLYMER_TEMPLATES[0];
}

// Rotate a repeat unit's local coordinates about the backbone (+x) axis. At
// angle = PI this is the syndiotactic y/z flip; conformer-derived polymers pass
// a per-unit angle chosen to spiral side groups clear of neighbours (see
// bestTwist in conformer3d.ts).
function rotateAboutBackbone(position: [number, number, number], angle: number): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [x, y, z] = position;
  return [x, y * cos - z * sin, y * sin + z * cos];
}

function addVec(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec(a: [number, number, number], scalar: number): [number, number, number] {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function bondOrderValue(order: BondOrder): number {
  return order === "aromatic" ? 1.5 : order;
}

// Per-element index labels for a set of atoms in order: C1, C2, O1, H1, H2, ...
// Shared by the 3D atom labels and the "Make Polymer from Monomer" anchor picker
// so users can match what they see to what they select.
export function elementLabels(atoms: Array<{ id: string; element: AtomSymbol }>): Map<string, string> {
  const counts = new Map<AtomSymbol, number>();
  const labels = new Map<string, string>();
  for (const atom of atoms) {
    const next = (counts.get(atom.element) ?? 0) + 1;
    counts.set(atom.element, next);
    labels.set(atom.id, `${atom.element}${next}`);
  }
  return labels;
}

export function generatePolymerGraph(
  template: PolymerTemplate,
  repeatCount: number,
  options: { capChainEnds?: boolean } = {},
): MolecularGraph {
  const safeRepeats = Math.min(template.maxRepeats, Math.max(1, Math.round(repeatCount)));
  const atoms: GraphAtom[] = [];
  const bonds: GraphBond[] = [];
  const groups: GraphGroup[] = [];
  const byproducts: ByproductSite[] = [];
  const atomByTemplateAndUnit = new Map<string, GraphAtom>();
  const labels = elementLabels(template.atoms);
  const twist = template.twist ?? Math.PI;
  const templateBondById = new Map(template.bonds.map((templateBond) => [templateBond.id, templateBond]));

  for (let unit = 0; unit < safeRepeats; unit++) {
    const unitBase = scaleVec(template.step, unit);

    for (const templateAtom of template.atoms) {
      const id = `${templateAtom.id}:${unit}`;
      const localPosition = rotateAboutBackbone(templateAtom.position, unit * twist);
      const position = addVec(unitBase, localPosition);
      const graphAtom: GraphAtom = {
        id,
        templateAtomId: templateAtom.id,
        element: templateAtom.element,
        position,
        unit,
        label: labels.get(templateAtom.id) ?? templateAtom.element,
      };
      atomByTemplateAndUnit.set(id, graphAtom);
      atoms.push(graphAtom);
    }

    for (const templateBond of template.bonds) {
      bonds.push({
        id: `${templateBond.id}:${unit}`,
        templateBondId: templateBond.id,
        a: `${templateBond.a}:${unit}`,
        b: `${templateBond.b}:${unit}`,
        order: templateBond.order,
        unit,
      });
    }

    for (const templateGroup of template.groups) {
      groups.push({
        id: `${templateGroup.id}:${unit}`,
        templateGroupId: templateGroup.id,
        label: `${templateGroup.label} ${unit + 1}`,
        color: templateGroup.color,
        atomIds: templateGroup.atomIds.map((id) => `${id}:${unit}`),
        bondIds: templateGroup.bondIds.map((id) => `${id}:${unit}`),
      });
    }

    // Internal condensation bonds (merged two-monomer units) released one
    // byproduct when the unit itself was assembled — one site per unit.
    for (const site of template.byproductSites ?? []) {
      const templateBond = templateBondById.get(site.bondId);
      if (!templateBond) continue;
      byproducts.push({
        id: `internal:${site.bondId}:${unit}`,
        atomA: `${templateBond.a}:${unit}`,
        atomB: `${templateBond.b}:${unit}`,
        unit,
        formula: site.byproduct.formula,
      });
    }

    if (unit > 0) {
      bonds.push({
        id: `repeat-link:${unit - 1}-${unit}`,
        templateBondId: "repeat-link",
        a: `${template.connection.rightAtomId}:${unit - 1}`,
        b: `${template.connection.leftAtomId}:${unit}`,
        order: template.connection.order,
        unit,
      });
      if (template.connection.mechanism === "condensation") {
        byproducts.push({
          id: `link:${unit - 1}-${unit}`,
          atomA: `${template.connection.rightAtomId}:${unit - 1}`,
          atomB: `${template.connection.leftAtomId}:${unit}`,
          unit,
          formula: template.connection.byproduct?.formula ?? "H2O",
        });
      }
    }
  }

  // Cap the two open chain-end valences with hydrogen so the tiled polymer is a
  // complete molecule (no dangling bonds) in both the 3D view and exports. Only
  // the very first left anchor and last right anchor are open; every other
  // anchor is satisfied by a repeat-link bond.
  if (options.capChainEnds) {
    capChainEnd(atoms, bonds, atomByTemplateAndUnit, `${template.connection.leftAtomId}:0`, -1, template.connection.leftCap ?? "H");
    capChainEnd(
      atoms,
      bonds,
      atomByTemplateAndUnit,
      `${template.connection.rightAtomId}:${safeRepeats - 1}`,
      1,
      template.connection.rightCap ?? "H",
    );
  }

  return {
    templateId: template.id,
    templateName: template.name,
    repeatCount: safeRepeats,
    atoms,
    bonds,
    groups,
    warnings: validateGraph(atoms, bonds),
    byproducts,
    tags: template.tags,
  };
}

// Caps a chain-end anchor's open valence, placed along the atom's open valence
// (opposite the average direction of its existing neighbors). `fallbackSign`
// aims the cap along the chain axis (+/-x) if the neighbor geometry is
// degenerate. Cap kinds: "H" adds one hydrogen; "OH" adds a hydroxyl so a
// condensation acid carbon reads -COOH again instead of an aldehyde.
const CHAIN_CAP_BOND = 1.09;
const CHAIN_CAP_CO_BOND = 1.36;
const CHAIN_CAP_OH_BOND = 0.96;

function capChainEnd(
  atoms: GraphAtom[],
  bonds: GraphBond[],
  atomById: Map<string, GraphAtom>,
  anchorId: string,
  fallbackSign: 1 | -1,
  kind: ChainCapKind,
) {
  const anchor = atomById.get(anchorId);
  if (!anchor) return;

  const neighbors: Array<[number, number, number]> = [];
  for (const bond of bonds) {
    const otherId = bond.a === anchorId ? bond.b : bond.b === anchorId ? bond.a : null;
    if (!otherId) continue;
    const other = atomById.get(otherId);
    if (other) neighbors.push(other.position);
  }
  if (neighbors.length === 0) return;

  const centroid: [number, number, number] = [0, 0, 0];
  for (const position of neighbors) {
    centroid[0] += position[0] / neighbors.length;
    centroid[1] += position[1] / neighbors.length;
    centroid[2] += position[2] / neighbors.length;
  }
  let dir: [number, number, number] = [
    anchor.position[0] - centroid[0],
    anchor.position[1] - centroid[1],
    anchor.position[2] - centroid[2],
  ];
  let length = Math.hypot(dir[0], dir[1], dir[2]);
  if (length < 1e-6) {
    dir = [fallbackSign, 0, 0];
    length = 1;
  }
  const unitDir: [number, number, number] = [dir[0] / length, dir[1] / length, dir[2] / length];

  if (kind === "H") {
    const capPosition: [number, number, number] = [
      anchor.position[0] + unitDir[0] * CHAIN_CAP_BOND,
      anchor.position[1] + unitDir[1] * CHAIN_CAP_BOND,
      anchor.position[2] + unitDir[2] * CHAIN_CAP_BOND,
    ];
    const capId = `cap:${anchorId}`;
    atoms.push({ id: capId, templateAtomId: "chain-cap", element: "H", position: capPosition, unit: anchor.unit, label: "H" });
    bonds.push({ id: `capbond:${anchorId}`, templateBondId: "chain-cap", a: anchorId, b: capId, order: 1, unit: anchor.unit });
    return;
  }

  // "OH": oxygen along the open valence, hydrogen bent off the C-O axis so the
  // C-O-H angle is roughly tetrahedral rather than linear.
  const oxygenPosition: [number, number, number] = [
    anchor.position[0] + unitDir[0] * CHAIN_CAP_CO_BOND,
    anchor.position[1] + unitDir[1] * CHAIN_CAP_CO_BOND,
    anchor.position[2] + unitDir[2] * CHAIN_CAP_CO_BOND,
  ];
  const helper: [number, number, number] = Math.abs(unitDir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let perp: [number, number, number] = [
    unitDir[1] * helper[2] - unitDir[2] * helper[1],
    unitDir[2] * helper[0] - unitDir[0] * helper[2],
    unitDir[0] * helper[1] - unitDir[1] * helper[0],
  ];
  const perpLength = Math.hypot(perp[0], perp[1], perp[2]) || 1;
  perp = [perp[0] / perpLength, perp[1] / perpLength, perp[2] / perpLength];
  const bend = Math.cos(Math.PI * 0.39); // ~109deg C-O-H
  const rise = Math.sin(Math.PI * 0.39);
  const hydrogenPosition: [number, number, number] = [
    oxygenPosition[0] + (unitDir[0] * bend + perp[0] * rise) * CHAIN_CAP_OH_BOND,
    oxygenPosition[1] + (unitDir[1] * bend + perp[1] * rise) * CHAIN_CAP_OH_BOND,
    oxygenPosition[2] + (unitDir[2] * bend + perp[2] * rise) * CHAIN_CAP_OH_BOND,
  ];
  const oxygenId = `cap:${anchorId}`;
  const hydrogenId = `caph:${anchorId}`;
  atoms.push({ id: oxygenId, templateAtomId: "chain-cap", element: "O", position: oxygenPosition, unit: anchor.unit, label: "O" });
  atoms.push({ id: hydrogenId, templateAtomId: "chain-cap", element: "H", position: hydrogenPosition, unit: anchor.unit, label: "H" });
  bonds.push({ id: `capbond:${anchorId}`, templateBondId: "chain-cap", a: anchorId, b: oxygenId, order: 1, unit: anchor.unit });
  bonds.push({ id: `capbond-h:${anchorId}`, templateBondId: "chain-cap", a: oxygenId, b: hydrogenId, order: 1, unit: anchor.unit });
}

export function summarizeBondOrders(graph: MolecularGraph): Record<string, number> {
  const summary: Record<string, number> = { single: 0, double: 0, triple: 0, aromatic: 0 };
  for (const graphBond of graph.bonds) {
    if (graphBond.order === 1) summary.single += 1;
    else if (graphBond.order === 2) summary.double += 1;
    else if (graphBond.order === 3) summary.triple += 1;
    else summary.aromatic += 1;
  }
  return summary;
}

function validateGraph(atoms: GraphAtom[], bonds: GraphBond[]): string[] {
  const warnings: string[] = [];
  const valenceByAtom = new Map<string, number>();
  const atomById = new Map(atoms.map((graphAtom) => [graphAtom.id, graphAtom]));
  const maxValence: Partial<Record<AtomSymbol, number>> = {
    H: 1,
    C: 4,
    N: 4,
    O: 2,
    F: 1,
    Cl: 1,
    Br: 1,
    I: 1,
  };

  for (const graphBond of bonds) {
    valenceByAtom.set(graphBond.a, (valenceByAtom.get(graphBond.a) ?? 0) + bondOrderValue(graphBond.order));
    valenceByAtom.set(graphBond.b, (valenceByAtom.get(graphBond.b) ?? 0) + bondOrderValue(graphBond.order));
  }

  for (const [atomId, valence] of valenceByAtom) {
    const graphAtom = atomById.get(atomId);
    if (!graphAtom) continue;
    const max = maxValence[graphAtom.element];
    if (max && valence > max + 0.01) {
      warnings.push(`${graphAtom.element} ${atomId.replace(":", " repeat ")} has high valence ${valence}.`);
    }
  }

  return warnings;
}
