export type AtomSymbol = "H" | "C" | "N" | "O" | "S" | "P" | "F" | "Cl" | "Br" | "I";
export type BondOrder = 1 | 2 | 3 | "aromatic";

/** How monomers join: addition opens a multiple bond; condensation expels a
 *  small byproduct molecule (water or HCl) each time a link bond forms. */
export type PolymerMechanism = "addition" | "condensation";

/** H2O from a -COOH acid; HCl from a -COCl acyl chloride. */
export type ByproductFormula = "H2O" | "HCl";

export interface ByproductInfo {
  formula: ByproductFormula;
  label: string;
}

/** What a chain-end anchor regains when capped: a plain hydrogen, a full
 *  hydroxyl for a condensation acid carbon (so the end reads -COOH, not -CHO),
 *  or a chlorine for an acyl-chloride carbon (the end reads -COCl again). */
export type ChainCapKind = "H" | "OH" | "Cl";

/** One byproduct molecule released by a formed link bond, referencing the two
 *  graph atoms it departed from. Metadata only — never part of atoms/bonds, so
 *  exports (LAMMPS, USDZ) stay byproduct-free by construction. */
export interface ByproductSite {
  id: string;
  atomA: string;
  atomB: string;
  unit: number;
  formula: ByproductFormula;
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
  /** Small molecules (H2O/HCl) released while forming this chain (condensation only). */
  byproducts: ByproductSite[];
  /** Caption sprites (e.g. "A"/"B" over the monomer pair preview). */
  tags?: SceneTag[];
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
// condensation acid carbon reads -COOH again instead of an aldehyde; "Cl" adds
// a chlorine so an acyl-chloride carbon reads -COCl again.
const CHAIN_CAP_BOND = 1.09;
const CHAIN_CAP_CO_BOND = 1.36;
const CHAIN_CAP_OH_BOND = 0.96;
const CHAIN_CAP_CCL_BOND = 1.79;

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

  if (kind === "H" || kind === "Cl") {
    const bondLength = kind === "H" ? CHAIN_CAP_BOND : CHAIN_CAP_CCL_BOND;
    const capPosition: [number, number, number] = [
      anchor.position[0] + unitDir[0] * bondLength,
      anchor.position[1] + unitDir[1] * bondLength,
      anchor.position[2] + unitDir[2] * bondLength,
    ];
    const capId = `cap:${anchorId}`;
    atoms.push({ id: capId, templateAtomId: "chain-cap", element: kind, position: capPosition, unit: anchor.unit, label: kind });
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
