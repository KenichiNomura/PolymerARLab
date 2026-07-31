import { describe, expect, it } from "vitest";
import { matchLonePairDots, type AnnotationComponent } from "./lonePairAnnotations";

function component(cx: number, cy: number, size = 4): AnnotationComponent {
  const half = size / 2;
  return {
    minX: cx - half,
    minY: cy - half,
    maxX: cx + half,
    maxY: cy + half,
    cx,
    cy,
    width: size,
    height: size,
  };
}

describe("matchLonePairDots", () => {
  const oxygen = component(50, 50, 20);

  it("matches multiple close dot pairs beside a heteroatom", () => {
    const dots = [
      component(34, 42),
      component(34, 47),
      component(66, 42),
      component(66, 47),
    ];

    const result = matchLonePairDots(dots, [oxygen], 20);

    expect(result.lonePairCount).toBe(2);
    expect(result.annotationComponents).toHaveLength(4);
  });

  it("matches all four lone pairs measured in the terephthalic-acid fixture", () => {
    const topOxygen = component(309.8, 85, 19);
    const bottomOxygen = component(131.2, 390, 19);
    const dots = [
      component(295.9, 73.4, 5),
      component(292.5, 79.5, 4),
      component(323.5, 73.5, 4),
      component(327, 79.5, 5),
      component(115.9, 400.7, 5),
      component(120.5, 405.5, 4),
      component(149.3, 391.9, 5),
      component(147.5, 398.5, 4),
    ];

    const result = matchLonePairDots(dots, [topOxygen, bottomOxygen], 17);

    expect(result.lonePairCount).toBe(4);
    expect(result.annotationComponents).toHaveLength(8);
  });

  it("does not remove paired marks away from a heteroatom", () => {
    const dots = [component(5, 5), component(5, 10)];

    const result = matchLonePairDots(dots, [oxygen], 20);

    expect(result.lonePairCount).toBe(0);
    expect(result.annotationComponents).toEqual([]);
  });

  it("does not remove an isolated radical-like dot", () => {
    const result = matchLonePairDots([component(34, 45)], [oxygen], 20);

    expect(result.lonePairCount).toBe(0);
    expect(result.annotationComponents).toEqual([]);
  });

  it("does not pair components with very different sizes", () => {
    const dots = [component(34, 42, 3), component(34, 47, 9)];

    const result = matchLonePairDots(dots, [oxygen], 20);

    expect(result.lonePairCount).toBe(0);
  });
});
