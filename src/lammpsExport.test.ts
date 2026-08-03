import { describe, expect, it } from "vitest";
import { buildUFFData } from "./lammpsExport";
import type { AtomSymbol, BondOrder, MolecularGraph } from "./polymerData";

interface TestAtom {
  id: string;
  element?: AtomSymbol;
}

function graph(atoms: TestAtom[], bonds: Array<[string, string, BondOrder]>): MolecularGraph {
  return {
    templateId: "test",
    templateName: "test",
    repeatCount: 1,
    atoms: atoms.map((atom, index) => ({
      id: atom.id,
      templateAtomId: atom.id,
      element: atom.element ?? "C",
      position: [index * 1.2, (index % 2) * 0.3, 0],
      unit: 0,
      label: atom.id,
    })),
    bonds: bonds.map(([a, b, order], index) => ({ id: `b${index}`, templateBondId: `b${index}`, a, b, order, unit: 0 })),
    groups: [],
    warnings: [],
    byproducts: [],
  };
}

function dihedralCoefficients(text: string): string[] {
  const section = text.split("Dihedral Coeffs # harmonic\n\n")[1]?.split("\n\n")[0];
  return section?.split("\n").filter(Boolean) ?? [];
}

describe("UFF-derived LAMMPS dihedrals", () => {
  it("uses the UFF threefold carbon sp3-sp3 barrier and splits it over terms", () => {
    const data = buildUFFData(
      graph(
        [{ id: "j" }, { id: "k" }, { id: "i1", element: "H" }, { id: "i2", element: "H" }, { id: "l1", element: "H" }, { id: "l2", element: "H" }],
        [["j", "k", 1], ["j", "i1", 1], ["j", "i2", 1], ["k", "l1", 1], ["k", "l2", 1]],
      ),
      "alkane",
    );

    expect(data.text).toContain("4 dihedrals");
    expect(data.text).toContain("1 dihedral types");
    expect(dihedralCoefficients(data.text)).toEqual(["1 0.2649 1 3 # C(sp3)-C(sp3) order 1; UFF sp3-sp3; 4 terms/bond"]);
  });

  it("uses a strong planar twofold term for an sp2-sp2 double bond", () => {
    const data = buildUFFData(
      graph(
        [{ id: "i", element: "H" }, { id: "j" }, { id: "k" }, { id: "l", element: "H" }],
        [["i", "j", 1], ["j", "k", 2], ["k", "l", 1]],
      ),
      "alkene",
    );

    const [coeff] = dihedralCoefficients(data.text);
    expect(coeff).toMatch(/^1 19\.4868 -1 2 # C\(sp2\)-C\(sp2\) order 2; UFF sp2-sp2/);
  });

  it("distinguishes default and conjugated sp2-sp3 torsions", () => {
    const defaultData = buildUFFData(
      graph(
        [
          { id: "i", element: "H" },
          { id: "j" },
          { id: "j2", element: "H" },
          { id: "k" },
          { id: "l" },
          { id: "m", element: "H" },
        ],
        [["i", "j", 1], ["j", "j2", 1], ["j", "k", 1], ["k", "l", 2], ["l", "m", 1]],
      ),
      "sp2-sp3",
    );
    expect(dihedralCoefficients(defaultData.text)[0]).toContain(" 1 3 # C(sp2)-C(sp3) order 1; UFF conjugated sp3-sp2");
    expect(defaultData.text).toContain("2 dihedral types");
    expect(defaultData.text).toMatch(/Dihedrals\n\n(?:.*\n)*\d+ 2 \d+ \d+ \d+ \d+/);

    const nonConjugatedData = buildUFFData(
      graph(
        [{ id: "i", element: "H" }, { id: "j" }, { id: "j2", element: "H" }, { id: "k" }, { id: "l", element: "H" }, { id: "l2", element: "H" }],
        [["i", "j", 1], ["j", "j2", 1], ["j", "k", 1], ["k", "l", 1], ["k", "l2", 2]],
      ),
      "mixed",
    );
    expect(dihedralCoefficients(nonConjugatedData.text).some((line) => line.includes(" -1 6 #") && line.includes("UFF sp2-sp3"))).toBe(true);
  });

  it("emits no torsion across a linear central atom", () => {
    const data = buildUFFData(
      graph(
        [{ id: "i", element: "H" }, { id: "j" }, { id: "k" }, { id: "l", element: "H" }],
        [["i", "j", 1], ["j", "k", 3], ["k", "l", 1]],
      ),
      "alkyne",
    );
    expect(data.counts.dihedrals).toBe(0);
    expect(data.text).toContain("0 dihedral types");
    expect(data.text).not.toContain("Dihedral Coeffs");
  });
});
