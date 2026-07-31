export interface AnnotationComponent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * Match compact dot components into electron pairs close to heteroatom
 * glyphs. The caller is responsible for deciding which components are
 * dot-like and which glyphs are heteroatoms.
 */
export function matchLonePairDots<T extends AnnotationComponent>(
  dotCandidates: T[],
  heteroatomComponents: AnnotationComponent[],
  glyphScale: number,
): { annotationComponents: T[]; lonePairCount: number } {
  const possiblePairs: Array<{ a: T; b: T; distance: number }> = [];
  const maxPairDistance = Math.max(10, glyphScale * 0.7);

  for (let a = 0; a < dotCandidates.length; a++) {
    for (let b = a + 1; b < dotCandidates.length; b++) {
      const first = dotCandidates[a];
      const second = dotCandidates[b];
      const sizeRatio = Math.max(componentSize(first), componentSize(second)) /
        Math.max(1, Math.min(componentSize(first), componentSize(second)));
      if (sizeRatio > 2.2) continue;

      const distance = Math.hypot(second.cx - first.cx, second.cy - first.cy);
      if (distance > maxPairDistance) continue;
      const midpoint = { x: (first.cx + second.cx) / 2, y: (first.cy + second.cy) / 2 };
      const besideHeteroatom = heteroatomComponents.some(
        (component) => distanceToComponent(midpoint, component) <= glyphScale * 1.35,
      );
      if (besideHeteroatom) possiblePairs.push({ a: first, b: second, distance });
    }
  }

  possiblePairs.sort((a, b) => a.distance - b.distance);
  const annotationSet = new Set<T>();
  let lonePairCount = 0;
  for (const pair of possiblePairs) {
    if (annotationSet.has(pair.a) || annotationSet.has(pair.b)) continue;
    annotationSet.add(pair.a);
    annotationSet.add(pair.b);
    lonePairCount += 1;
  }

  return { annotationComponents: [...annotationSet], lonePairCount };
}

function componentSize(component: AnnotationComponent) {
  return Math.max(component.width, component.height);
}

function distanceToComponent(point: { x: number; y: number }, component: AnnotationComponent) {
  const dx = Math.max(component.minX - point.x, 0, point.x - component.maxX);
  const dy = Math.max(component.minY - point.y, 0, point.y - component.maxY);
  return Math.hypot(dx, dy);
}
