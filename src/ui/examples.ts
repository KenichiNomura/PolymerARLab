import { POLYMER_TEMPLATES } from "../polymerData";
import { IMPORTED_TEMPLATE_ID } from "../structureImport";
import type { StructureImportFormat } from "../structureImport";

// Curated polymer examples offered in the dropdown: repeat units via graph JSON
// plus the built-in curated templates. (Arbitrary small molecules now come from
// PubChem, so they are no longer hard-coded here.)

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
    id: "polyethylene",
    label: "polyethylene",
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
    label: "PVC",
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
    label: "polyvinyl alcohol",
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
  label: template.name,
  kind: "template",
  templateId: template.id,
  repeats: template.defaultRepeats,
  mode: "polymer",
}));

export const STRUCTURE_EXAMPLES: StructureExample[] = [...IMPORT_STRUCTURE_EXAMPLES, ...TEMPLATE_STRUCTURE_EXAMPLES];

export function populateExampleSelect(select: HTMLSelectElement) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Polymer Examples";
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
