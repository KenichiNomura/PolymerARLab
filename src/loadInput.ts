export type LoadInputKind = "smiles" | "pubchem";

export interface ClassifiedLoadInput {
  kind: LoadInputKind;
  value: string;
  explicit: boolean;
}

/**
 * Classify the shared Load field while preserving PubChem behavior for
 * ambiguous atom-only strings such as CO. Prefixes always win.
 */
export function classifyLoadInput(rawInput: string): ClassifiedLoadInput {
  const input = rawInput.trim();
  if (!input) throw new Error("Enter a PubChem name, CID, or SMILES string.");

  const prefixed = input.match(/^(smiles|pubchem)\s*:\s*(.*)$/i);
  if (prefixed) {
    const value = prefixed[2].trim();
    if (!value) throw new Error(`Enter a value after "${prefixed[1].toLowerCase()}:".`);
    return {
      kind: prefixed[1].toLowerCase() as LoadInputKind,
      value,
      explicit: true,
    };
  }

  if (isClearSmiles(input)) return { kind: "smiles", value: input, explicit: false };
  return { kind: "pubchem", value: input, explicit: false };
}

function isClearSmiles(input: string) {
  if (/^\d+$/.test(input)) return false;
  if (/\s/.test(input)) return false;
  // Bonds, branches, rings, stereochemistry, charges, fragments, and bracket
  // atoms are strong structural signals. Plain atom sequences stay ambiguous.
  return /[\[\]()=#@+\-./\\]/.test(input) || /\d/.test(input);
}
