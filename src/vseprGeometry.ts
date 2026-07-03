import type { BondOrder, PolymerTemplate, TemplateAtom, TemplateBond } from "./polymerData";

export type GeometryCleanupMethod = "vsepr-browser";

export interface GeometryCleanupOptions {
  mode: "molecule" | "polymer";
}

export interface GeometryCleanupResult {
  template: PolymerTemplate;
  changed: boolean;
  method: GeometryCleanupMethod;
  messages: string[];
}

type Vec3 = [number, number, number];

interface Neighbor {
  atomId: string;
  bond: TemplateBond;
}

interface PositionedTemplate {
  template: PolymerTemplate;
  messages: string[];
}

const DEFAULT_SINGLE_BOND = 1.45;
const MAX_BROWSER_VSEPR_ATOMS = 32;
const TETRAHEDRAL_ANGLE = (109.5 * Math.PI) / 180;
const TRIGONAL_ANGLE = (120 * Math.PI) / 180;

export function cleanupTemplateGeometry(
  template: PolymerTemplate,
  options: GeometryCleanupOptions,
): GeometryCleanupResult {
  if (template.atoms.length < 2 || template.atoms.length > MAX_BROWSER_VSEPR_ATOMS) {
    return unchanged(template, ["VSEPR cleanup skipped for this structure size."]);
  }

  const adjacency = buildAdjacency(template);
  const atomById = atomMap(template);

  if (options.mode === "polymer") {
    const cleanedRepeat = cleanupDirectRepeatUnit(template, atomById, adjacency);
    if (cleanedRepeat) {
      return {
        template: cleanedRepeat.template,
        changed: true,
        method: "vsepr-browser",
        messages: cleanedRepeat.messages,
      };
    }
    return unchanged(template, ["VSEPR cleanup kept the existing polymer geometry."]);
  }

  if (hasCycle(template, adjacency)) {
    return unchanged(template, ["VSEPR cleanup kept the existing ring geometry."]);
  }

  const cleanedMolecule = layoutAcyclicMolecule(template, atomById, adjacency);
  if (!cleanedMolecule) return unchanged(template, ["VSEPR cleanup kept the existing molecule geometry."]);

  return {
    template: cleanedMolecule.template,
    changed: true,
    method: "vsepr-browser",
    messages: cleanedMolecule.messages,
  };
}

function cleanupDirectRepeatUnit(
  template: PolymerTemplate,
  atomById: Map<string, TemplateAtom>,
  adjacency: Map<string, Neighbor[]>,
): PositionedTemplate | null {
  const left = atomById.get(template.connection.leftAtomId);
  const right = atomById.get(template.connection.rightAtomId);
  if (!left || !right) return null;

  const backboneBond = template.bonds.find((bond) => connects(bond, left.id, right.id));
  if (!backboneBond) return null;

  const repeatLength = targetBondLength(backboneBond.order);
  const positions = new Map<string, Vec3>();
  positions.set(left.id, [0, 0, 0]);
  positions.set(right.id, [repeatLength, 0, 0]);

  const placed = new Set([left.id, right.id]);
  const blocked = new Set([left.id, right.id]);

  for (const anchor of [left, right]) {
    const branchNeighbors = (adjacency.get(anchor.id) ?? []).filter(
      (neighbor) => !blocked.has(neighbor.atomId),
    );

    branchNeighbors.forEach((neighbor, index) => {
      const component = collectComponent(neighbor.atomId, blocked, adjacency);
      if (componentHasCycle(component, adjacency)) {
        placeCyclicBranch(template, atomById, adjacency, positions, anchor.id, neighbor, index, branchNeighbors.length);
      } else {
        placeAcyclicBranch(template, atomById, adjacency, positions, placed, anchor.id, neighbor, index, branchNeighbors.length);
      }
      for (const atomId of component) placed.add(atomId);
    });
  }

  const projected = projectTemplateAlongConnection(template, left, right, repeatLength);
  for (const atom of template.atoms) {
    if (!positions.has(atom.id)) {
      positions.set(atom.id, projected.get(atom.id) ?? atom.position);
    }
  }

  return {
    template: templateWithPositions(template, positions, repeatLength),
    messages: ["Applied browser VSEPR cleanup to the direct polymer repeat axis."],
  };
}

function layoutAcyclicMolecule(
  template: PolymerTemplate,
  atomById: Map<string, TemplateAtom>,
  adjacency: Map<string, Neighbor[]>,
): PositionedTemplate | null {
  const path = longestAtomPath(template, adjacency);
  if (path.length < 2) return null;

  const positions = new Map<string, Vec3>();
  const placed = new Set<string>();
  positions.set(path[0], [0, 0, 0]);
  placed.add(path[0]);

  const firstBond = findBond(template, path[0], path[1]);
  positions.set(path[1], [targetBondLength(firstBond?.order ?? 1), 0, 0]);
  placed.add(path[1]);

  for (let index = 2; index < path.length; index++) {
    const parentId = path[index - 2];
    const centerId = path[index - 1];
    const atomId = path[index];
    const center = atomById.get(centerId);
    const bond = findBond(template, centerId, atomId);
    if (!center || !bond) continue;
    const direction = chooseVseprDirection(center, adjacency, positions, centerId, parentId, index % 2 === 0 ? 1 : -1, 0, 1);
    const origin = positions.get(centerId)!;
    positions.set(atomId, addVec(origin, scaleVec(direction, targetBondLength(bond.order))));
    placed.add(atomId);
  }

  const pathAtoms = new Set(path);
  for (const atomId of path) {
    const branches = (adjacency.get(atomId) ?? []).filter(
      (neighbor) => !pathAtoms.has(neighbor.atomId) && !placed.has(neighbor.atomId),
    );
    branches.forEach((neighbor, index) => {
      const parentId = path[path.indexOf(atomId) === 0 ? 1 : path.indexOf(atomId) - 1];
      placeAcyclicBranch(template, atomById, adjacency, positions, placed, atomId, neighbor, index, branches.length, parentId);
    });
  }

  centerPositions(positions);

  return {
    template: templateWithPositions(template, positions),
    messages: ["Applied browser VSEPR cleanup to the acyclic molecule."],
  };
}

function placeAcyclicBranch(
  template: PolymerTemplate,
  atomById: Map<string, TemplateAtom>,
  adjacency: Map<string, Neighbor[]>,
  positions: Map<string, Vec3>,
  placed: Set<string>,
  anchorId: string,
  neighbor: Neighbor,
  branchIndex: number,
  branchCount: number,
  preferredKnownAtomId?: string,
) {
  const anchor = atomById.get(anchorId);
  const origin = positions.get(anchorId);
  if (!anchor || !origin) return;

  const knownAtomId = preferredKnownAtomId ?? bestPlacedNeighbor(anchorId, neighbor.atomId, positions, adjacency);
  const direction = chooseVseprDirection(anchor, adjacency, positions, anchorId, knownAtomId, 1, branchIndex, branchCount);
  positions.set(neighbor.atomId, addVec(origin, scaleVec(direction, targetBondLength(neighbor.bond.order))));
  placed.add(neighbor.atomId);
  placeChildren(template, atomById, adjacency, positions, placed, neighbor.atomId, anchorId, 1);
}

function placeChildren(
  template: PolymerTemplate,
  atomById: Map<string, TemplateAtom>,
  adjacency: Map<string, Neighbor[]>,
  positions: Map<string, Vec3>,
  placed: Set<string>,
  atomId: string,
  parentId: string,
  sideSign: number,
) {
  const atom = atomById.get(atomId);
  const origin = positions.get(atomId);
  if (!atom || !origin) return;

  const children = (adjacency.get(atomId) ?? []).filter((neighbor) => neighbor.atomId !== parentId);
  children.forEach((child, index) => {
    if (placed.has(child.atomId)) return;
    const direction = chooseVseprDirection(atom, adjacency, positions, atomId, parentId, sideSign, index, children.length);
    positions.set(child.atomId, addVec(origin, scaleVec(direction, targetBondLength(child.bond.order))));
    placed.add(child.atomId);
    placeChildren(template, atomById, adjacency, positions, placed, child.atomId, atomId, sideSign);
  });
}

function placeCyclicBranch(
  template: PolymerTemplate,
  atomById: Map<string, TemplateAtom>,
  adjacency: Map<string, Neighbor[]>,
  positions: Map<string, Vec3>,
  anchorId: string,
  neighbor: Neighbor,
  branchIndex: number,
  branchCount: number,
) {
  const anchor = atomById.get(anchorId);
  const branchAtom = atomById.get(neighbor.atomId);
  const origin = positions.get(anchorId);
  if (!anchor || !branchAtom || !origin) return;

  const knownAtomId = bestPlacedNeighbor(anchorId, neighbor.atomId, positions, adjacency);
  const desiredDirection = chooseVseprDirection(anchor, adjacency, positions, anchorId, knownAtomId, 1, branchIndex, branchCount);
  const desiredStart = addVec(origin, scaleVec(desiredDirection, targetBondLength(neighbor.bond.order)));
  const sourceDirection = normalizeVec(subVec(branchAtom.position, anchor.position));
  const rotation = angleOf(desiredDirection) - angleOf(sourceDirection);
  const component = collectComponent(neighbor.atomId, new Set([anchorId]), adjacency);

  for (const atomId of component) {
    const atom = atomById.get(atomId);
    if (!atom) continue;
    const relative = subVec(atom.position, branchAtom.position);
    const rotated = rotateZ(relative, rotation);
    positions.set(atomId, addVec(desiredStart, rotated));
  }
}

function chooseVseprDirection(
  atom: TemplateAtom,
  adjacency: Map<string, Neighbor[]>,
  positions: Map<string, Vec3>,
  centerId: string,
  knownAtomId: string | undefined,
  preferredSide: number,
  branchIndex: number,
  branchCount: number,
): Vec3 {
  const knownPosition = knownAtomId ? positions.get(knownAtomId) : undefined;
  const centerPosition = positions.get(centerId);
  const knownDirection = knownPosition && centerPosition ? normalizeVec(subVec(knownPosition, centerPosition)) : [-1, 0, 0] as Vec3;
  const domains = electronDomainCount(atom, adjacency.get(centerId) ?? []);

  if (domains <= 2) {
    return normalizeVec(scaleVec(knownDirection, -1));
  }

  const angle = domains === 3 ? TRIGONAL_ANGLE : TETRAHEDRAL_ANGLE;
  const offsets = branchCount <= 1
    ? [preferredSide]
    : Array.from({ length: branchCount }, (_, index) => (index % 2 === 0 ? 1 : -1) * (1 + Math.floor(index / 2) * 0.45));
  const offset = offsets[branchIndex] ?? preferredSide;
  const candidates = [rotateZ(knownDirection, angle * offset), rotateZ(knownDirection, -angle * offset)];
  const chosen = candidates.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

  if (domains >= 4 && branchCount > 1) {
    const z = branchIndex % 2 === 0 ? 0.28 : -0.28;
    return normalizeVec([chosen[0], chosen[1], z]);
  }

  return normalizeVec(chosen[1] < 0 ? [chosen[0], -chosen[1], chosen[2]] : chosen);
}

function electronDomainCount(atom: TemplateAtom, neighbors: Neighbor[]) {
  const orders = neighbors.map((neighbor) => neighbor.bond.order);
  const hasTriple = orders.includes(3);
  const doubleCount = orders.filter((order) => order === 2 || order === "aromatic").length;

  if (atom.element === "H") return 1;
  if (hasTriple || doubleCount >= 2) return 2;
  if (doubleCount === 1) return 3;
  if (atom.element === "C" || atom.element === "N" || atom.element === "O" || atom.element === "S" || atom.element === "P") {
    return 4;
  }
  return Math.max(2, neighbors.length);
}

function templateWithPositions(template: PolymerTemplate, positions: Map<string, Vec3>, directRepeatLength?: number): PolymerTemplate {
  const atoms = template.atoms.map((atom) => ({
    ...atom,
    position: roundVec(positions.get(atom.id) ?? atom.position),
  }));
  const xs = atoms.map((atom) => atom.position[0]);
  const span = Math.max(...xs) - Math.min(...xs);
  const stepX = directRepeatLength ? Math.max(directRepeatLength * 2, Math.abs(template.step[0])) : Math.max(2.4, span + DEFAULT_SINGLE_BOND);
  return {
    ...template,
    atoms,
    step: [round(stepX), 0, 0],
  };
}

function projectTemplateAlongConnection(
  template: PolymerTemplate,
  left: TemplateAtom,
  right: TemplateAtom,
  repeatLength: number,
) {
  const source = subVec(right.position, left.position);
  const sourceLength = Math.hypot(source[0], source[1]) || DEFAULT_SINGLE_BOND;
  const unit = [source[0] / sourceLength, source[1] / sourceLength, 0] as Vec3;
  const normal = [-unit[1], unit[0], 0] as Vec3;
  const scale = repeatLength / sourceLength;
  const sideAverage = template.atoms
    .filter((atom) => atom.id !== left.id && atom.id !== right.id)
    .reduce((sum, atom) => {
      const relative = subVec(atom.position, left.position);
      return sum + dotVec(relative, normal);
    }, 0);
  const sideSign = sideAverage < 0 ? -1 : 1;
  const positions = new Map<string, Vec3>();

  for (const atom of template.atoms) {
    const relative = subVec(atom.position, left.position);
    const x = dotVec(relative, unit) * scale;
    let y = dotVec(relative, normal) * scale * sideSign;
    if (atom.id !== left.id && atom.id !== right.id && Math.abs(y) < 0.08) y = DEFAULT_SINGLE_BOND * 0.78;
    positions.set(atom.id, [x, y, relative[2] * scale]);
  }

  positions.set(left.id, [0, 0, 0]);
  positions.set(right.id, [repeatLength, 0, 0]);
  return positions;
}

function longestAtomPath(template: PolymerTemplate, adjacency: Map<string, Neighbor[]>) {
  let best: string[] = [];
  for (const atom of template.atoms) {
    const path = longestPathFrom(atom.id, adjacency, new Set());
    if (path.length > best.length) best = path;
  }
  return best;
}

function longestPathFrom(atomId: string, adjacency: Map<string, Neighbor[]>, visited: Set<string>): string[] {
  visited.add(atomId);
  let best = [atomId];
  for (const neighbor of adjacency.get(atomId) ?? []) {
    if (visited.has(neighbor.atomId)) continue;
    const candidate = [atomId, ...longestPathFrom(neighbor.atomId, adjacency, new Set(visited))];
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function hasCycle(template: PolymerTemplate, adjacency: Map<string, Neighbor[]>) {
  const visited = new Set<string>();
  for (const atom of template.atoms) {
    if (visited.has(atom.id)) continue;
    const component = collectComponent(atom.id, new Set(), adjacency);
    for (const atomId of component) visited.add(atomId);
    if (componentHasCycle(component, adjacency)) return true;
  }
  return false;
}

function componentHasCycle(component: Set<string>, adjacency: Map<string, Neighbor[]>) {
  let edgeCount = 0;
  for (const atomId of component) {
    edgeCount += (adjacency.get(atomId) ?? []).filter((neighbor) => component.has(neighbor.atomId)).length;
  }
  return edgeCount / 2 >= component.size;
}

function collectComponent(startId: string, blocked: Set<string>, adjacency: Map<string, Neighbor[]>) {
  const queue = [startId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const atomId = queue.shift()!;
    if (visited.has(atomId) || blocked.has(atomId)) continue;
    visited.add(atomId);
    for (const neighbor of adjacency.get(atomId) ?? []) {
      if (!visited.has(neighbor.atomId) && !blocked.has(neighbor.atomId)) queue.push(neighbor.atomId);
    }
  }
  return visited;
}

function buildAdjacency(template: PolymerTemplate) {
  const adjacency = new Map<string, Neighbor[]>();
  for (const atom of template.atoms) adjacency.set(atom.id, []);
  for (const bond of template.bonds) {
    adjacency.get(bond.a)?.push({ atomId: bond.b, bond });
    adjacency.get(bond.b)?.push({ atomId: bond.a, bond });
  }
  return adjacency;
}

function atomMap(template: PolymerTemplate) {
  return new Map(template.atoms.map((atom) => [atom.id, atom]));
}

function bestPlacedNeighbor(
  atomId: string,
  excludedAtomId: string,
  positions: Map<string, Vec3>,
  adjacency: Map<string, Neighbor[]>,
) {
  return (adjacency.get(atomId) ?? []).find((neighbor) => neighbor.atomId !== excludedAtomId && positions.has(neighbor.atomId))?.atomId;
}

function findBond(template: PolymerTemplate, a: string, b: string) {
  return template.bonds.find((bond) => connects(bond, a, b));
}

function connects(bond: TemplateBond, a: string, b: string) {
  return (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a);
}

function targetBondLength(order: BondOrder) {
  if (order === 3) return 1.2;
  if (order === 2) return 1.34;
  if (order === "aromatic") return 1.39;
  return DEFAULT_SINGLE_BOND;
}

function centerPositions(positions: Map<string, Vec3>) {
  const values = [...positions.values()];
  const minX = Math.min(...values.map((position) => position[0]));
  const maxX = Math.max(...values.map((position) => position[0]));
  const minY = Math.min(...values.map((position) => position[1]));
  const maxY = Math.max(...values.map((position) => position[1]));
  const offset: Vec3 = [-(minX + maxX) / 2, -(minY + maxY) / 2, 0];
  for (const [atomId, position] of positions) {
    positions.set(atomId, addVec(position, offset));
  }
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(a: Vec3, scalar: number): Vec3 {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dotVec(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVec(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function rotateZ(a: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [a[0] * cos - a[1] * sin, a[0] * sin + a[1] * cos, a[2]];
}

function angleOf(a: Vec3) {
  return Math.atan2(a[1], a[0]);
}

function roundVec(value: Vec3): Vec3 {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function unchanged(template: PolymerTemplate, messages: string[]): GeometryCleanupResult {
  return {
    template,
    changed: false,
    method: "vsepr-browser",
    messages,
  };
}
