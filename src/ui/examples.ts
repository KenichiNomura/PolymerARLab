import { POLYMER_TEMPLATES } from "../polymerData";
import { IMPORTED_TEMPLATE_ID } from "../structureImport";

// Populates the (hidden) internal template selector with the built-in curated
// templates, and returns the option that represents the current imported /
// derived structure (revealed by the import flow).
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
