import type { PolymerTemplate } from "./polymerData";

export type Vec3 = [number, number, number];

export interface AttachedPosition {
  parentIndex: number;
  position: Vec3;
}

/**
 * Enforce cis/trans geometry between the two chain segments around the retained
 * double bond. If a flip is needed, rotate the entire right-hand component by
 * 180 degrees about the double-bond axis, preserving all internal distances.
 */
export function enforceDiene14Geometry<T extends AttachedPosition>(
  template: PolymerTemplate,
  sourcePositions: Vec3[],
  sourceAttached: T[] = [],
): { positions: Vec3[]; attached: T[] } {
  const addition = template.connection.addition;
  if (!addition || addition.kind !== "diene-1,4") {
    return { positions: sourcePositions, attached: sourceAttached };
  }

  const indexById = new Map(template.atoms.map((atom, index) => [atom.id, index]));
  const leftAnchor = indexById.get(template.connection.leftAtomId);
  const rightAnchor = indexById.get(template.connection.rightAtomId);
  const leftInner = indexById.get(addition.leftInnerAtomId);
  const rightInner = indexById.get(addition.rightInnerAtomId);
  if (leftAnchor == null || rightAnchor == null || leftInner == null || rightInner == null) {
    return { positions: sourcePositions, attached: sourceAttached };
  }

  const axis = normalize(sub(sourcePositions[rightInner], sourcePositions[leftInner]));
  const leftSide = perpendicular(sub(sourcePositions[leftAnchor], sourcePositions[leftInner]), axis);
  const rightSide = perpendicular(sub(sourcePositions[rightAnchor], sourcePositions[rightInner]), axis);
  if (length(leftSide) < 1e-6 || length(rightSide) < 1e-6) {
    return { positions: sourcePositions, attached: sourceAttached };
  }
  const isCis = dot(leftSide, rightSide) > 0;
  if ((addition.geometry === "cis") === isCis) {
    return { positions: sourcePositions, attached: sourceAttached };
  }

  const rotatingAtomIds = componentAfterRemovingBond(template, addition.rightInnerAtomId, addition.centralBondId);
  const rotatingIndices = new Set(
    [...rotatingAtomIds].map((id) => indexById.get(id)).filter((index): index is number => index != null),
  );
  const origin = sourcePositions[leftInner];
  const rotate = (point: Vec3): Vec3 => {
    const relative = sub(point, origin);
    // Rodrigues rotation for PI radians: r' = 2*u*(u·r) - r.
    const along = scale(axis, 2 * dot(axis, relative));
    return add(origin, sub(along, relative));
  };
  const positions = sourcePositions.map((position, index) => (rotatingIndices.has(index) ? rotate(position) : position));
  const attached = sourceAttached.map((record) =>
    rotatingIndices.has(record.parentIndex) ? ({ ...record, position: rotate(record.position) } as T) : record,
  );
  return { positions, attached };
}

export function diene14Geometry(template: PolymerTemplate, positions: Vec3[]): "cis" | "trans" | null {
  const addition = template.connection.addition;
  if (!addition) return null;
  const indexById = new Map(template.atoms.map((atom, index) => [atom.id, index]));
  const ids = [
    template.connection.leftAtomId,
    addition.leftInnerAtomId,
    addition.rightInnerAtomId,
    template.connection.rightAtomId,
  ];
  const indices = ids.map((id) => indexById.get(id));
  if (indices.some((index) => index == null)) return null;
  const [a, j, k, b] = indices as number[];
  const axis = normalize(sub(positions[k], positions[j]));
  const leftSide = perpendicular(sub(positions[a], positions[j]), axis);
  const rightSide = perpendicular(sub(positions[b], positions[k]), axis);
  if (length(leftSide) < 1e-6 || length(rightSide) < 1e-6) return null;
  return dot(leftSide, rightSide) > 0 ? "cis" : "trans";
}

function componentAfterRemovingBond(template: PolymerTemplate, start: string, excludedBondId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const atomId = queue.shift()!;
    if (visited.has(atomId)) continue;
    visited.add(atomId);
    for (const bond of template.bonds) {
      if (bond.id === excludedBondId || (bond.a !== atomId && bond.b !== atomId)) continue;
      const next = bond.a === atomId ? bond.b : bond.a;
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function perpendicular(vector: Vec3, axis: Vec3): Vec3 {
  return sub(vector, scale(axis, dot(vector, axis)));
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, scalar: number): Vec3 {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const magnitude = length(a) || 1;
  return scale(a, 1 / magnitude);
}
