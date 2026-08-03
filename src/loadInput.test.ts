import { describe, expect, it } from "vitest";
import { classifyLoadInput } from "./loadInput";

describe("classifyLoadInput", () => {
  it("honors explicit prefixes case-insensitively", () => {
    expect(classifyLoadInput("SMILES: CO")).toEqual({ kind: "smiles", value: "CO", explicit: true });
    expect(classifyLoadInput("pubchem: CO")).toEqual({ kind: "pubchem", value: "CO", explicit: true });
  });

  it("detects clear structural SMILES", () => {
    expect(classifyLoadInput("CC(=O)O").kind).toBe("smiles");
    expect(classifyLoadInput("c1ccccc1").kind).toBe("smiles");
    expect(classifyLoadInput("[NH4+].[Cl-]").kind).toBe("smiles");
  });

  it("keeps names, CIDs, and atom-only strings on the PubChem path", () => {
    expect(classifyLoadInput("terephthalic acid").kind).toBe("pubchem");
    expect(classifyLoadInput("7489").kind).toBe("pubchem");
    expect(classifyLoadInput("CO").kind).toBe("pubchem");
    expect(classifyLoadInput("CCO").kind).toBe("pubchem");
  });

  it("rejects missing values", () => {
    expect(() => classifyLoadInput("")).toThrow(/Enter a PubChem name/);
    expect(() => classifyLoadInput("smiles: ")).toThrow(/Enter a value/);
  });

  it("honors a selected source while keeping explicit prefixes authoritative", () => {
    expect(classifyLoadInput("2,5-dimethyl-1,3,5-hexatriene", "pubchem")).toEqual({
      kind: "pubchem",
      value: "2,5-dimethyl-1,3,5-hexatriene",
      explicit: false,
    });
    expect(classifyLoadInput("C=C(C)C=C", "smiles").kind).toBe("smiles");
    expect(classifyLoadInput("smiles: C=C", "pubchem")).toEqual({ kind: "smiles", value: "C=C", explicit: true });
  });
});
