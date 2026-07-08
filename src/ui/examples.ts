import { POLYMER_TEMPLATES } from "../polymerData";
import { IMPORTED_TEMPLATE_ID } from "../structureImport";
import type { StructureImportFormat } from "../structureImport";

// Curated example structures offered in the "Choose example" dropdown:
// classroom molecules imported via SMILES, polymer repeat units via graph
// JSON, and the built-in curated templates.

export type StructureMode = "molecule" | "polymer";

interface BaseStructureExample {
  id: string;
  label: string;
  repeats: number;
  mode: StructureMode;
}

export interface ImportStructureExample extends BaseStructureExample {
  kind: "import";
  format: StructureImportFormat;
  input: string;
}

export interface TemplateStructureExample extends BaseStructureExample {
  kind: "template";
  templateId: string;
}

export type StructureExample = ImportStructureExample | TemplateStructureExample;

function graphExample(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const IMPORT_STRUCTURE_EXAMPLES: ImportStructureExample[] = [
  {
    id: "co2",
    label: "Molecule - carbon dioxide",
    kind: "import",
    format: "smiles",
    input: "O=C=O",
    repeats: 1,
    mode: "molecule",
  },
  {
    id: "ethanol",
    label: "Molecule - ethanol",
    kind: "import",
    format: "smiles",
    input: "CCO",
    repeats: 1,
    mode: "molecule",
  },
  {
    id: "benzene",
    label: "Molecule - benzene",
    kind: "import",
    format: "smiles",
    input: "c1ccccc1",
    repeats: 1,
    mode: "molecule",
  },
  {
    id: "glycine",
    label: "Molecule - glycine",
    kind: "import",
    format: "smiles",
    input: "NCC(=O)O",
    repeats: 1,
    mode: "molecule",
  },
  {
    id: "polyethylene",
    label: "Polymer - polyethylene",
    kind: "import",
    format: "json",
    input: graphExample({
      name: "Polyethylene",
      repeatLabel: "[-CH2-CH2-]n",
      defaultRepeats: 4,
      leftAttachmentAtomId: "bb0",
      rightAttachmentAtomId: "bb1",
      atoms: [
        { id: "bb0", element: "C", position: [0, 0, 0] },
        { id: "bb1", element: "C", position: [1.45, 0, 0] },
      ],
      bonds: [{ id: "bb", a: "bb0", b: "bb1", order: 1 }],
    }),
    repeats: 4,
    mode: "polymer",
  },
  {
    id: "pvc",
    label: "Polymer - PVC",
    kind: "import",
    format: "json",
    input: graphExample({
      name: "Polyvinyl chloride",
      repeatLabel: "[-CH2-CH(Cl)-]n",
      defaultRepeats: 4,
      leftAttachmentAtomId: "bb0",
      rightAttachmentAtomId: "bb1",
      atoms: [
        { id: "bb0", element: "C", position: [0, 0, 0] },
        { id: "bb1", element: "C", position: [1.45, 0, 0] },
        { id: "cl", element: "Cl", position: [1.45, 1.28, 0] },
      ],
      bonds: [
        { id: "bb", a: "bb0", b: "bb1", order: 1 },
        { id: "chloride", a: "bb1", b: "cl", order: 1 },
      ],
    }),
    repeats: 4,
    mode: "polymer",
  },
  {
    id: "polyvinyl-alcohol",
    label: "Polymer - polyvinyl alcohol",
    kind: "import",
    format: "json",
    input: graphExample({
      name: "Polyvinyl alcohol",
      repeatLabel: "[-CH2-CH(OH)-]n",
      defaultRepeats: 4,
      leftAttachmentAtomId: "bb0",
      rightAttachmentAtomId: "bb1",
      atoms: [
        { id: "bb0", element: "C", position: [0, 0, 0] },
        { id: "bb1", element: "C", position: [1.45, 0, 0] },
        { id: "o", element: "O", position: [1.45, 1.22, 0] },
        { id: "h", element: "H", position: [1.45, 2.0, 0] },
      ],
      bonds: [
        { id: "bb", a: "bb0", b: "bb1", order: 1 },
        { id: "alcohol", a: "bb1", b: "o", order: 1 },
        { id: "hydroxyl", a: "o", b: "h", order: 1 },
      ],
    }),
    repeats: 4,
    mode: "polymer",
  },
];

const TEMPLATE_STRUCTURE_EXAMPLES: TemplateStructureExample[] = POLYMER_TEMPLATES.map((template) => ({
  id: `template-${template.id}`,
  label: `Polymer - ${template.name}`,
  kind: "template",
  templateId: template.id,
  repeats: template.defaultRepeats,
  mode: "polymer",
}));

export const STRUCTURE_EXAMPLES: StructureExample[] = [...IMPORT_STRUCTURE_EXAMPLES, ...TEMPLATE_STRUCTURE_EXAMPLES];

export function populateExampleSelect(select: HTMLSelectElement) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose example";
  select.appendChild(placeholder);
  for (const example of STRUCTURE_EXAMPLES) {
    const option = document.createElement("option");
    option.value = example.id;
    option.textContent = example.label;
    select.appendChild(option);
  }
}

// Populates the template selector and returns the (hidden) option that
// represents an imported structure, which the import flow reveals.
export function populateTemplateSelect(select: HTMLSelectElement): HTMLOptionElement {
  for (const template of POLYMER_TEMPLATES) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = `${template.shortName} - ${template.name}`;
    select.appendChild(option);
  }
  const importedOption = document.createElement("option");
  importedOption.value = IMPORTED_TEMPLATE_ID;
  importedOption.textContent = "Imported structure";
  importedOption.hidden = true;
  select.appendChild(importedOption);
  return importedOption;
}
