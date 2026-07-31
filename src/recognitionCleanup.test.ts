import { describe, expect, it } from "vitest";
import { pruneTinyGraphFragments, pruneTinySmilesFragments } from "./recognitionCleanup";
import type { RecognizedStructure } from "./scannerContract";

describe("pruneTinySmilesFragments", () => {
  const terephthalicAcid = "O=C(O)c1ccc(C(=O)O)cc1";

  it("removes a hallucinated nitrogen fragment beside a dominant molecule", () => {
    const result = pruneTinySmilesFragments(`${terephthalicAcid}.N`);

    expect(result.value).toBe(terephthalicAcid);
    expect(result.warnings.join(" ")).toMatch(/"N".*artifact/);
  });

  it("removes a bracketed ammonia fragment", () => {
    const result = pruneTinySmilesFragments(`[NH3+].${terephthalicAcid}`);

    expect(result.value).toBe(terephthalicAcid);
    expect(result.warnings).toHaveLength(1);
  });

  it("preserves multiple substantial fragments", () => {
    const input = `${terephthalicAcid}.CCO`;
    expect(pruneTinySmilesFragments(input)).toEqual({ value: input, warnings: [] });
  });

  it("does not prune small molecules without a dominant component", () => {
    const input = "N.O";
    expect(pruneTinySmilesFragments(input)).toEqual({ value: input, warnings: [] });
  });
});

describe("pruneTinyGraphFragments", () => {
  function structure(extraAtoms: RecognizedStructure["atoms"], extraBonds: RecognizedStructure["bonds"] = []) {
    const ringAtoms: RecognizedStructure["atoms"] = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index + 1}`,
      element: "C",
      position: { x: index, y: 0 },
      confidence: 0.9,
    }));
    const ringBonds: RecognizedStructure["bonds"] = Array.from({ length: 6 }, (_, index) => ({
      id: `b${index + 1}`,
      a: `c${index + 1}`,
      b: `c${(index + 1) % 6 + 1}`,
      order: "aromatic",
      confidence: 0.9,
    }));
    return {
      source: "image-upload" as const,
      atoms: [...ringAtoms, ...extraAtoms],
      bonds: [...ringBonds, ...extraBonds],
      confidence: 0.9,
      warnings: [],
    };
  }

  it("removes an isolated N from a dominant offline graph", () => {
    const input = structure([
      { id: "n1", element: "N", position: { x: 20, y: 0 }, confidence: 0.4 },
    ]);

    const result = pruneTinyGraphFragments(input);

    expect(result.value.atoms.map((atom) => atom.id)).not.toContain("n1");
    expect(result.value.warnings.join(" ")).toMatch(/disconnected N fragment/);
  });

  it("removes a connected explicit NH3 side fragment by heavy-atom count", () => {
    const atoms: RecognizedStructure["atoms"] = [
      { id: "n1", element: "N", position: { x: 20, y: 0 }, confidence: 0.4 },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `h${index + 1}`,
        element: "H" as const,
        position: { x: 21, y: index },
        confidence: 0.5,
      })),
    ];
    const bonds: RecognizedStructure["bonds"] = Array.from({ length: 3 }, (_, index) => ({
      id: `nh${index + 1}`,
      a: "n1",
      b: `h${index + 1}`,
      order: 1,
      confidence: 0.5,
    }));

    const result = pruneTinyGraphFragments(structure(atoms, bonds));

    expect(result.value.atoms).toHaveLength(6);
    expect(result.value.bonds).toHaveLength(6);
  });
});
