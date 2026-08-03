import { describe, expect, it } from "vitest";
import { diene14Geometry, enforceDiene14Geometry } from "./dieneGeometry";
import { buildUFFData } from "./lammpsExport";
import { generatePolymerGraph, type AtomSymbol, type BondOrder, type PolymerTemplate } from "./polymerData";
import { classifyAdditionAnchors, deriveRepeatUnit, suggestAdditionAnchors } from "./structureImport";
import { cleanupTemplateGeometry } from "./vseprGeometry";

function template(
  atomSpecs: Array<[string, AtomSymbol, [number, number, number]]>,
  bondSpecs: Array<[string, string, string, BondOrder]>,
  name = "test diene",
): PolymerTemplate {
  return {
    id: "test",
    name,
    shortName: name,
    family: "test",
    repeatLabel: name,
    defaultRepeats: 1,
    maxRepeats: 10,
    step: [5, 0, 0],
    connection: { leftAtomId: atomSpecs[0][0], rightAtomId: atomSpecs[atomSpecs.length - 1][0], order: 1 },
    atoms: atomSpecs.map(([id, element, position]) => ({ id, element, position })),
    bonds: bondSpecs.map(([id, a, b, order]) => ({ id, a, b, order })),
    groups: [],
  };
}

const isoprene = () =>
  template(
    [
      ["c1", "C", [-1, 1, 0]],
      ["c2", "C", [0, 0, 0]],
      ["c3", "C", [1.34, 0, 0]],
      ["c4", "C", [2.34, 1, 0]],
      ["m", "C", [0, -1, 0]],
    ],
    [
      ["b12", "c1", "c2", 2],
      ["b23", "c2", "c3", 1],
      ["b34", "c3", "c4", 2],
      ["b2m", "c2", "m", 1],
    ],
    "isoprene",
  );

describe("generic conjugated-diene 1,4-addition", () => {
  it("recognizes and auto-selects the terminal atoms of a unique 1,3-diene", () => {
    const monomer = isoprene();
    expect(classifyAdditionAnchors(monomer, "c1", "c4")).toMatchObject({
      kind: "diene-1,4",
      atomIds: ["c1", "c2", "c3", "c4"],
      bondIds: ["b12", "b23", "b34"],
    });
    expect(suggestAdditionAnchors(monomer)).toEqual(["c1", "c4"]);
  });

  it("rewrites 2-1-2 to 1-2-1 and records the requested geometry", () => {
    const repeat = deriveRepeatUnit(isoprene(), "c1", "c4", { dieneGeometry: "trans" });
    expect(repeat.bonds.find((bond) => bond.id === "b12")?.order).toBe(1);
    expect(repeat.bonds.find((bond) => bond.id === "b23")?.order).toBe(2);
    expect(repeat.bonds.find((bond) => bond.id === "b34")?.order).toBe(1);
    expect(repeat.connection.addition).toEqual({
      kind: "diene-1,4",
      geometry: "trans",
      centralBondId: "b23",
      leftInnerAtomId: "c2",
      rightInnerAtomId: "c3",
    });
    expect(repeat.name).toContain("trans-1,4-poly(isoprene)");
  });

  it("supports reversed anchors and substituted dienes such as chloroprene", () => {
    const chloroprene = isoprene();
    chloroprene.name = "chloroprene";
    chloroprene.atoms.find((atom) => atom.id === "m")!.element = "Cl";
    const repeat = deriveRepeatUnit(chloroprene, "c4", "c1", { dieneGeometry: "cis" });
    expect(repeat.connection.leftAtomId).toBe("c4");
    expect(repeat.connection.rightAtomId).toBe("c1");
    expect(repeat.connection.addition).toMatchObject({ leftInnerAtomId: "c3", rightInnerAtomId: "c2", geometry: "cis" });
  });

  it("preserves direct multiple-bond addition", () => {
    const ethylene = template(
      [
        ["a", "C", [0, 0, 0]],
        ["b", "C", [1.34, 0, 0]],
      ],
      [["ab", "a", "b", 2]],
      "ethylene",
    );
    expect(classifyAdditionAnchors(ethylene, "a", "b")).toEqual({ kind: "direct", bondId: "ab" });
    expect(deriveRepeatUnit(ethylene, "a", "b").bonds[0].order).toBe(1);

    const acetylene = template(
      [
        ["a", "C", [0, 0, 0]],
        ["b", "C", [1.2, 0, 0]],
      ],
      [["ab", "a", "b", 3]],
      "acetylene",
    );
    expect(deriveRepeatUnit(acetylene, "a", "b").bonds[0].order).toBe(2);
  });

  it("rejects nonconjugated and cyclic anchor paths without revealing atom labels", () => {
    const nonconjugated = isoprene();
    nonconjugated.bonds.find((bond) => bond.id === "b34")!.order = 1;
    expect(() => deriveRepeatUnit(nonconjugated, "c1", "c4")).toThrow(/reactive unsaturated part/);
    try {
      deriveRepeatUnit(nonconjugated, "c1", "c4");
    } catch (error) {
      expect(String(error)).not.toContain("c1");
      expect(String(error)).not.toContain("c4");
    }

    const cyclic = isoprene();
    cyclic.bonds.push({ id: "ring", a: "c1", b: "c4", order: 1 });
    expect(classifyAdditionAnchors(cyclic, "c1", "c4").kind).toBe("unsupported");
  });
});

describe("diene product geometry", () => {
  it("flips one connected side to enforce trans while preserving distances", () => {
    const repeat = deriveRepeatUnit(isoprene(), "c1", "c4", { dieneGeometry: "trans" });
    const positions = repeat.atoms.map((atom) => atom.position);
    const before = Math.hypot(
      positions[3][0] - positions[2][0],
      positions[3][1] - positions[2][1],
      positions[3][2] - positions[2][2],
    );
    const enforced = enforceDiene14Geometry(repeat, positions);
    const after = Math.hypot(
      enforced.positions[3][0] - enforced.positions[2][0],
      enforced.positions[3][1] - enforced.positions[2][1],
      enforced.positions[3][2] - enforced.positions[2][2],
    );
    expect(diene14Geometry(repeat, positions)).toBe("cis");
    expect(diene14Geometry(repeat, enforced.positions)).toBe("trans");
    expect(after).toBeCloseTo(before, 10);
  });

  it("retains the selected geometry in every generated repeat", () => {
    const repeat = deriveRepeatUnit(isoprene(), "c1", "c4", { dieneGeometry: "trans" });
    const enforced = enforceDiene14Geometry(
      repeat,
      repeat.atoms.map((atom) => atom.position),
    ).positions;
    const positioned = {
      ...repeat,
      atoms: repeat.atoms.map((atom, index) => ({ ...atom, position: enforced[index] })),
      twist: Math.PI / 3,
    };
    const graph = generatePolymerGraph(positioned, 3);
    for (let unit = 0; unit < 3; unit++) {
      const positions = positioned.atoms.map((atom) => graph.atoms.find((candidate) => candidate.id === `${atom.id}:${unit}`)!.position);
      expect(diene14Geometry(positioned, positions)).toBe("trans");
    }
    expect(graph.bonds.filter((bond) => bond.templateBondId === "b23").every((bond) => bond.order === 2)).toBe(true);
  });

  it("enforces geometry in fallback layout and exports the retained double bond", () => {
    const repeat = deriveRepeatUnit(isoprene(), "c1", "c4", { dieneGeometry: "trans" });
    const fallback = cleanupTemplateGeometry(repeat, { mode: "polymer" });
    expect(diene14Geometry(fallback, fallback.atoms.map((atom) => atom.position))).toBe("trans");
    const graph = generatePolymerGraph(fallback, 2, { capChainEnds: true });
    const data = buildUFFData(graph, "trans polyisoprene");
    expect(data.text).toContain("# C-C order 2");
    expect(data.text).toContain("UFF sp2-sp2");
  });
});
