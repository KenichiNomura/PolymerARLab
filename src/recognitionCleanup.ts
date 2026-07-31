import type { RecognizedStructure } from "./scannerContract";

export interface RecognitionCleanupResult<T> {
  value: T;
  warnings: string[];
}

/**
 * A sketch represents one primary molecule. Remove only tiny dot-separated
 * fragments beside a clearly dominant AI transcription; manually entered
 * SMILES never pass through this cleanup.
 */
export function pruneTinySmilesFragments(smiles: string): RecognitionCleanupResult<string> {
  const fragments = splitSmilesFragments(smiles);
  if (fragments.length < 2) return { value: smiles, warnings: [] };

  const scored = fragments.map((fragment, index) => ({
    fragment,
    index,
    heavyAtoms: countHeavyAtoms(fragment),
    atoms: countAtoms(fragment),
  }));
  const dominant = [...scored].sort(
    (a, b) => b.heavyAtoms - a.heavyAtoms || b.atoms - a.atoms || a.index - b.index,
  )[0];
  if (!dominant || dominant.heavyAtoms < 4) return { value: smiles, warnings: [] };

  const removed = scored.filter((entry) => entry.index !== dominant.index && entry.heavyAtoms <= 1);
  if (removed.length === 0) return { value: smiles, warnings: [] };
  const removedIndexes = new Set(removed.map((entry) => entry.index));
  const kept = scored.filter((entry) => !removedIndexes.has(entry.index)).map((entry) => entry.fragment);
  return {
    value: kept.join("."),
    warnings: [
      `Ignored ${removed.map((entry) => `"${entry.fragment}"`).join(", ")} as ${
        removed.length === 1 ? "a tiny disconnected recognition artifact" : "tiny disconnected recognition artifacts"
      }.`,
    ],
  };
}

/**
 * Offline recognition emits a graph rather than SMILES, so apply the same
 * dominant-component rule directly to its atoms and bonds.
 */
export function pruneTinyGraphFragments(
  structure: RecognizedStructure,
): RecognitionCleanupResult<RecognizedStructure> {
  if (structure.atoms.length < 2) return { value: structure, warnings: [] };

  const atomById = new Map(structure.atoms.map((atom) => [atom.id, atom]));
  const neighbors = new Map(structure.atoms.map((atom) => [atom.id, [] as string[]]));
  for (const bond of structure.bonds) {
    if (!atomById.has(bond.a) || !atomById.has(bond.b)) continue;
    neighbors.get(bond.a)!.push(bond.b);
    neighbors.get(bond.b)!.push(bond.a);
  }

  const visited = new Set<string>();
  const components: Array<{ ids: Set<string>; heavyAtoms: number; atoms: number }> = [];
  for (const atom of structure.atoms) {
    if (visited.has(atom.id)) continue;
    const ids = new Set<string>();
    const stack = [atom.id];
    visited.add(atom.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      ids.add(id);
      for (const neighbor of neighbors.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    components.push({
      ids,
      heavyAtoms: [...ids].filter((id) => atomById.get(id)?.element !== "H").length,
      atoms: ids.size,
    });
  }
  if (components.length < 2) return { value: structure, warnings: [] };

  const dominant = [...components].sort(
    (a, b) => b.heavyAtoms - a.heavyAtoms || b.atoms - a.atoms,
  )[0];
  if (!dominant || dominant.heavyAtoms < 4) return { value: structure, warnings: [] };

  const removed = components.filter((component) => component !== dominant && component.heavyAtoms <= 1);
  if (removed.length === 0) return { value: structure, warnings: [] };
  const removedIds = new Set(removed.flatMap((component) => [...component.ids]));
  const removedLabels = removed.map((component) =>
    [...component.ids].map((id) => atomById.get(id)?.element ?? "?").join(""),
  );
  const warning = `Ignored disconnected ${removedLabels.join(", ")} ${
    removed.length === 1 ? "fragment" : "fragments"
  } as likely recognition artifacts.`;

  return {
    value: {
      ...structure,
      atoms: structure.atoms.filter((atom) => !removedIds.has(atom.id)),
      bonds: structure.bonds.filter((bond) => !removedIds.has(bond.a) && !removedIds.has(bond.b)),
      warnings: [...structure.warnings, warning],
    },
    warnings: [warning],
  };
}

function splitSmilesFragments(smiles: string) {
  const fragments: string[] = [];
  let start = 0;
  let bracketDepth = 0;
  for (let index = 0; index < smiles.length; index++) {
    const char = smiles[index];
    if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "." && bracketDepth === 0) {
      const fragment = smiles.slice(start, index).trim();
      if (fragment) fragments.push(fragment);
      start = index + 1;
    }
  }
  const tail = smiles.slice(start).trim();
  if (tail) fragments.push(tail);
  return fragments;
}

function countAtoms(fragment: string) {
  return fragment.match(/Cl|Br|[A-Z][a-z]?|[cnosp]/g)?.length ?? 0;
}

function countHeavyAtoms(fragment: string) {
  return fragment.match(/Cl|Br|[BCNOPSFI]|[cnosp]/g)?.length ?? 0;
}
