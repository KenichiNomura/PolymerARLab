import { aiAccessToken, aiRecognitionEndpoint } from "./aiRecognition";
import { createCameraOverlay } from "./cameraOverlay";
import { conformerResourcesReady, preloadConformerResources, templateTo3D } from "./conformer3d";
import { renderFallbackGraph } from "./fallback2d";
import { isIOSDevice } from "./platform";
import {
  POLYMER_TEMPLATES,
  generatePolymerGraph,
  getTemplate,
  summarizeBondOrders,
  type MolecularGraph,
  type PolymerTemplate,
  type TemplateAtom,
} from "./polymerData";
import { RDKitImportError, normalizeStructureWithRDKit, preloadRDKit } from "./rdkitService";
import { runSketchRecognition, type ImportOutcome } from "./recognitionFlow";
import { createQuickLook } from "./scene/quickLook";
import {
  applyPreviewTransform,
  handleResize,
  initThreeRuntime,
  resetView,
  startRenderLoop,
  type ThreeRuntime,
} from "./scene/threeScene";
import { installWebXR } from "./scene/webxr";
import { IMPORTED_TEMPLATE_ID, importStructure, updateTemplateAttachments, type StructureImportFormat } from "./structureImport";
import { STRUCTURE_EXAMPLES, populateExampleSelect, populateTemplateSelect } from "./ui/examples";
import { showImportStatus, showPlatformStatus, showScanStatus, showStatus } from "./ui/status";
import { cleanupTemplateGeometry } from "./vseprGeometry";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const appEl = document.getElementById("app")!;
const fallbackEl = document.getElementById("fallbackMolecule")!;
const videoEl = document.getElementById("cameraFeed") as HTMLVideoElement;
const arEntryEl = document.getElementById("arEntry")!;
const polymerModeToggle = document.getElementById("polymerModeToggle") as HTMLInputElement;
const polymerSelect = document.getElementById("polymerSelect") as HTMLSelectElement;
const exampleStructureSelect = document.getElementById("exampleStructureSelect") as HTMLSelectElement;
const structureFormat = document.getElementById("structureFormat") as HTMLSelectElement;
const structureInput = document.getElementById("structureInput") as HTMLTextAreaElement;
const loadStructureBtn = document.getElementById("loadStructureBtn") as HTMLButtonElement;
const leftAttachmentSelect = document.getElementById("leftAttachmentSelect") as HTMLSelectElement;
const rightAttachmentSelect = document.getElementById("rightAttachmentSelect") as HTMLSelectElement;
const repeatRange = document.getElementById("repeatRange") as HTMLInputElement;
const repeatValue = document.getElementById("repeatValue")!;
const labelsToggle = document.getElementById("labelsToggle") as HTMLInputElement;
const hydrogensToggle = document.getElementById("hydrogensToggle") as HTMLInputElement;
const cameraModeBtn = document.getElementById("cameraModeBtn") as HTMLButtonElement;
const captureBtn = document.getElementById("captureBtn") as HTMLButtonElement;
const uploadSketchBtn = document.getElementById("uploadSketchBtn") as HTMLButtonElement;
const sketchFileInput = document.getElementById("sketchFileInput") as HTMLInputElement;
const resetViewBtn = document.getElementById("resetViewBtn") as HTMLButtonElement;
const arQuickLookBtn = document.getElementById("arQuickLookBtn") as HTMLButtonElement;
const scanCanvas = document.getElementById("scanCanvas") as HTMLCanvasElement;
const scanPreview = document.getElementById("scanPreview")!;
const structureSummary = document.getElementById("structureSummary")!;
const validationStatus = document.getElementById("validationStatus")!;

// ---------------------------------------------------------------------------
// Structure state
// ---------------------------------------------------------------------------

let currentTemplate: PolymerTemplate = POLYMER_TEMPLATES[0];
let importedTemplate: PolymerTemplate | null = null;
let currentGraph: MolecularGraph | null = null;
let three: ThreeRuntime | null = null;

function isPolymerMode() {
  return polymerModeToggle.checked;
}

function setPolymerMode(on: boolean) {
  polymerModeToggle.checked = on;
  updateStructureModeUi();
}

function updateStructureModeUi() {
  const polymerMode = isPolymerMode();
  document.body.classList.toggle("polymer-mode", polymerMode);
  repeatRange.disabled = !polymerMode;
  updateAttachmentControls();
}

function getActiveTemplate(id: string): PolymerTemplate {
  if (id === IMPORTED_TEMPLATE_ID && importedTemplate) return importedTemplate;
  return getTemplate(id);
}

function clampRepeats(value: number, max: number) {
  return Math.min(max, Math.max(1, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Geometry: conformer with VSEPR fallback, cached per template/mode/H toggle
// so repeat-slider drags do not recompute an identical conformer.
// ---------------------------------------------------------------------------

let geometryCache: {
  template: PolymerTemplate;
  mode: "molecule" | "polymer";
  hydrogens: boolean;
  result: PolymerTemplate;
} | null = null;

function templateGeometry(template: PolymerTemplate, mode: "molecule" | "polymer"): PolymerTemplate {
  const hydrogens = hydrogensToggle.checked;
  const cache = geometryCache;
  if (cache && cache.template === template && cache.mode === mode && cache.hydrogens === hydrogens) {
    return cache.result;
  }
  const result =
    templateTo3D(template, { mode, includeHydrogens: hydrogens }) ?? cleanupTemplateGeometry(template, { mode });
  // Only cache once conformer resources are loaded, so the early VSEPR
  // result is not served forever after the real conformer becomes possible.
  if (conformerResourcesReady()) {
    geometryCache = { template, mode, hydrogens, result };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Graph rebuild + rendering
// ---------------------------------------------------------------------------

function rebuildGraph() {
  if (polymerSelect.value === IMPORTED_TEMPLATE_ID && !importedTemplate) {
    polymerSelect.value = POLYMER_TEMPLATES[0].id;
  }
  const mode = isPolymerMode() ? "polymer" : "molecule";
  currentTemplate = templateGeometry(getActiveTemplate(polymerSelect.value), mode);
  repeatRange.max = String(currentTemplate.maxRepeats);
  if (Number(repeatRange.value) > currentTemplate.maxRepeats) {
    repeatRange.value = String(currentTemplate.maxRepeats);
  }

  const repeatCount = isPolymerMode() ? Number(repeatRange.value) : 1;
  repeatValue.textContent = String(repeatCount);
  currentGraph = generatePolymerGraph(currentTemplate, repeatCount);

  quickLook.scheduleRefresh();
  updateSummary();
  updateThreeGraph();
  renderFallbackGraph(fallbackEl, currentGraph, currentTemplate.name, Boolean(three));
  updateAttachmentControls();
}

function updateThreeGraph() {
  if (!three || !currentGraph) return;
  three.moleculeRenderer.setGraph(currentGraph);
  three.moleculeRenderer.setLabelsVisible(labelsToggle.checked);
  three.moleculeRoot.visible = true;
  if (three.renderer.xr.isPresenting) {
    three.moleculeRoot.scale.setScalar(0.18);
  } else {
    applyPreviewTransform(three);
  }
}

function updateSummary() {
  if (!currentGraph) return;
  const bondSummary = summarizeBondOrders(currentGraph);
  const modeLabel = isPolymerMode() ? "Polymer" : "Molecule";
  const structureLabel = isPolymerMode() ? currentTemplate.repeatLabel : currentTemplate.name;
  const repeatText = isPolymerMode() ? ` | n=${currentGraph.repeatCount}` : "";
  structureSummary.textContent =
    `${modeLabel}: ${structureLabel}${repeatText} | ${currentGraph.atoms.length} atoms | ${currentGraph.bonds.length} bonds\n` +
    `single ${bondSummary.single} | double ${bondSummary.double} | triple ${bondSummary.triple} | aromatic ${bondSummary.aromatic}`;

  validationStatus.textContent = currentGraph.warnings.length
    ? currentGraph.warnings.slice(0, 2).join("\n")
    : "Valence check passed for this display graph.";
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

const importedTemplateOption = populateTemplateSelect(polymerSelect);

async function loadImportedStructure(options: { repeatOverride?: number } = {}): Promise<ImportOutcome> {
  loadStructureBtn.disabled = true;
  try {
    const requestedFormat = structureFormat.value as StructureImportFormat;
    const normalized = await normalizeWithChemistryFallback(structureInput.value, requestedFormat);
    const result = importStructure(
      normalized.input,
      normalized.format,
      isPolymerMode()
        ? {
            leftAtomId: leftAttachmentSelect.value,
            rightAtomId: rightAttachmentSelect.value,
          }
        : {},
    );
    importedTemplate =
      options.repeatOverride == null
        ? result.template
        : { ...result.template, defaultRepeats: clampRepeats(options.repeatOverride, result.template.maxRepeats) };
    importedTemplateOption.hidden = false;
    importedTemplateOption.textContent = `${importedTemplate.shortName} - ${importedTemplate.name}`;
    polymerSelect.value = IMPORTED_TEMPLATE_ID;
    repeatRange.value = String(importedTemplate.defaultRepeats);
    rebuildGraph();
    const [importedMessage, ...importWarnings] = result.messages;
    const countsMessage = `${importedMessage} ${importedTemplate.atoms.length} atoms, ${importedTemplate.bonds.length} bonds.`;
    showImportStatus([...normalized.messages, countsMessage, ...importWarnings].join(" "));
    showStatus(`Verification target: imported ${result.detectedFormat.toUpperCase()} structure.`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(message);
    showStatus(`Import failed: ${message}`, true);
    return { ok: false, message };
  } finally {
    loadStructureBtn.disabled = false;
  }
}

async function normalizeWithChemistryFallback(
  input: string,
  format: StructureImportFormat,
): Promise<{ input: string; format: StructureImportFormat; messages: string[] }> {
  try {
    const normalized = await normalizeStructureWithRDKit(input, format);
    if (!normalized) {
      return { input, format, messages: ["Graph JSON imported directly."] };
    }
    return normalized;
  } catch (error) {
    if (error instanceof RDKitImportError && error.kind === "load") {
      return {
        input,
        format,
        messages: [`RDKit.js unavailable; used lightweight parser. ${error.message}`],
      };
    }
    if (error instanceof RDKitImportError && error.kind === "validation") {
      // Chemically invalid structures still import so students can see the
      // drawing rendered and read the valence warnings (the teaching moment).
      return {
        input,
        format,
        messages: [`RDKit.js rejected this structure (${error.message}); imported permissively - check the valence warnings.`],
      };
    }
    throw error;
  }
}

async function useSelectedExample() {
  const example = STRUCTURE_EXAMPLES.find((candidate) => candidate.id === exampleStructureSelect.value);
  if (!example) return;
  setPolymerMode(example.mode === "polymer");
  if (example.kind === "template") {
    const template = getTemplate(example.templateId);
    polymerSelect.value = template.id;
    repeatRange.value = String(clampRepeats(example.repeats, template.maxRepeats));
    rebuildGraph();
    showImportStatus(`Loaded example: ${template.shortName} - ${template.name}.`);
    showStatus(`Verification target: ${template.shortName}.`);
    return;
  }

  structureFormat.value = example.format;
  structureInput.value = example.input;
  showImportStatus(`Loading example: ${example.label}.`);
  await loadImportedStructure({ repeatOverride: example.repeats });
}

// ---------------------------------------------------------------------------
// Attachment controls (polymer repeat-unit connection points)
// ---------------------------------------------------------------------------

function applyImportedAttachments() {
  if (!isPolymerMode() || !importedTemplate || polymerSelect.value !== IMPORTED_TEMPLATE_ID) return;
  try {
    importedTemplate = updateTemplateAttachments(importedTemplate, leftAttachmentSelect.value, rightAttachmentSelect.value);
    importedTemplateOption.textContent = `${importedTemplate.shortName} - ${importedTemplate.name}`;
    rebuildGraph();
    showImportStatus(`Connections: ${importedTemplate.connection.leftAtomId} -> ${importedTemplate.connection.rightAtomId}.`);
    showStatus("Updated repeat-unit attachment atoms.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(message);
    showStatus(message, true);
  }
}

function updateAttachmentControls() {
  const template = isPolymerMode() && polymerSelect.value === IMPORTED_TEMPLATE_ID ? importedTemplate : null;
  leftAttachmentSelect.replaceChildren();
  rightAttachmentSelect.replaceChildren();

  if (!template) {
    leftAttachmentSelect.disabled = true;
    rightAttachmentSelect.disabled = true;
    return;
  }

  for (const atom of template.atoms) {
    leftAttachmentSelect.appendChild(attachmentOption(atom));
    rightAttachmentSelect.appendChild(attachmentOption(atom));
  }
  leftAttachmentSelect.value = template.connection.leftAtomId;
  rightAttachmentSelect.value = template.connection.rightAtomId;
  leftAttachmentSelect.disabled = false;
  rightAttachmentSelect.disabled = false;
}

function attachmentOption(atom: TemplateAtom) {
  const option = document.createElement("option");
  option.value = atom.id;
  option.textContent = `${atom.id} (${atom.element})`;
  return option;
}

// ---------------------------------------------------------------------------
// Scan capture (camera frame or uploaded image -> recognition)
// ---------------------------------------------------------------------------

function updateScanPreview() {
  scanPreview.style.backgroundImage = `url(${scanCanvas.toDataURL("image/jpeg", 0.82)})`;
  scanPreview.classList.add("has-capture");
}

const recognitionOptions = {
  canvas: scanCanvas,
  setPolymerMode,
  setImportInput: (format: StructureImportFormat, value: string) => {
    structureFormat.value = format;
    structureInput.value = value;
  },
  importStructure: loadImportedStructure,
};

async function loadSketchImageFile() {
  const file = sketchFileInput.files?.[0];
  sketchFileInput.value = "";
  if (!file) return;

  try {
    const image = await createImageBitmap(file);
    scanCanvas.width = image.width;
    scanCanvas.height = image.height;
    scanCanvas.getContext("2d")!.drawImage(image, 0, 0);
    image.close();
  } catch (error) {
    showScanStatus(`Could not read that image file: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  }

  updateScanPreview();
  await runSketchRecognition("image-upload", recognitionOptions);
}

// ---------------------------------------------------------------------------
// Platform status line
// ---------------------------------------------------------------------------

function updatePlatformStatus() {
  const hasWebXr = "xr" in navigator;
  const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia);
  const webgl = three ? "WebGL ready" : "2D fallback";
  const secure = window.isSecureContext ? "trusted HTTPS" : "not trusted HTTPS";
  const build = `Build ${__BUILD_TIME__}.`;

  if (isIOSDevice()) {
    showPlatformStatus(`iPhone Safari path: ${webgl}, camera ${hasCamera ? "available" : "unavailable"}, ${secure}. ${build}`);
  } else if (hasWebXr) {
    showPlatformStatus(`Android/compatible path: ${webgl}, WebXR available, ${secure}. ${build}`);
  } else {
    showPlatformStatus(`Preview path: ${webgl}, WebXR unavailable, ${secure}. ${build}`);
  }
}

// ---------------------------------------------------------------------------
// Feature wiring
// ---------------------------------------------------------------------------

const quickLook = createQuickLook({
  button: arQuickLookBtn,
  getGroup: () => three?.moleculeRenderer.group ?? null,
  getGraph: () => currentGraph,
  getFileName: (graph) => {
    const baseName = (isPolymerMode() ? `${currentTemplate.shortName}-n${graph.repeatCount}` : currentTemplate.name)
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${baseName || "molecule"}.usdz`;
  },
});

const cameraOverlay = createCameraOverlay({
  videoEl,
  toggleButton: cameraModeBtn,
  captureButton: captureBtn,
  overlayEl: fallbackEl,
  getRuntime: () => three,
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

window.addEventListener("error", (event) => {
  showStatus(`Runtime error: ${event.message}`, true);
});
window.addEventListener("unhandledrejection", (event) => {
  showStatus(`Unhandled rejection: ${event.reason}`, true);
});
window.addEventListener("resize", () => {
  if (three) handleResize(three);
});

polymerModeToggle.addEventListener("change", () => {
  updateStructureModeUi();
  rebuildGraph();
  showStatus(isPolymerMode() ? "Polymer repeat-unit mode active." : "Molecule mode active.");
});

polymerSelect.addEventListener("change", () => {
  const template = getActiveTemplate(polymerSelect.value);
  repeatRange.value = String(template.defaultRepeats);
  rebuildGraph();
  showStatus(`Verification target: ${template.shortName}.`);
});

exampleStructureSelect.addEventListener("change", () => {
  void useSelectedExample();
});
loadStructureBtn.addEventListener("click", () => {
  void loadImportedStructure();
});
leftAttachmentSelect.addEventListener("change", applyImportedAttachments);
rightAttachmentSelect.addEventListener("change", applyImportedAttachments);
repeatRange.addEventListener("input", rebuildGraph);

labelsToggle.addEventListener("change", () => {
  three?.moleculeRenderer.setLabelsVisible(labelsToggle.checked);
});

hydrogensToggle.addEventListener("change", () => {
  rebuildGraph();
  showStatus(hydrogensToggle.checked ? "Showing hydrogens on open valences." : "Hiding generated hydrogens.");
});

cameraModeBtn.addEventListener("click", () => {
  void cameraOverlay.toggle();
});
captureBtn.addEventListener("click", () => {
  if (!cameraOverlay.drawFrameTo(scanCanvas)) return;
  updateScanPreview();
  void runSketchRecognition("camera-capture", recognitionOptions);
});
uploadSketchBtn.addEventListener("click", () => sketchFileInput.click());
sketchFileInput.addEventListener("change", () => {
  void loadSketchImageFile();
});
resetViewBtn.addEventListener("click", () => {
  if (three) resetView(three);
});
arQuickLookBtn.addEventListener("click", () => {
  void quickLook.handleTap();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Persist any ?ai=<url>/off/default endpoint and ?aitoken= choices on load.
aiRecognitionEndpoint();
aiAccessToken();

populateExampleSelect(exampleStructureSelect);
polymerSelect.value = currentTemplate.id;
repeatRange.value = String(currentTemplate.defaultRepeats);
repeatRange.max = String(currentTemplate.maxRepeats);

three = initThreeRuntime(appEl, (message) => {
  showStatus(`WebGL unavailable in this Safari tab: ${message}`, true);
});

updateStructureModeUi();
rebuildGraph();

if (three) {
  document.body.classList.add("webgl-ready");
  try {
    installWebXR(three, arEntryEl, {
      onSessionStart: () => cameraOverlay.stop(),
      onSessionEnd: () => updatePlatformStatus(),
    });
  } catch (error) {
    console.error(error);
    arEntryEl.innerHTML = '<button id="webxrArButton" type="button" disabled>WEBXR OFF</button>';
    showStatus(`WebXR button unavailable: ${(error as Error).message}`, true);
  }
  resetView(three);
  startRenderLoop(three);
} else {
  arEntryEl.innerHTML = '<button id="webxrArButton" type="button" disabled>2D FALLBACK</button>';
}

updatePlatformStatus();
showStatus("Choose an example, import a structure, or scan a sketch.");

// 3D conformer resources load in the background; structures render with the
// VSEPR layout immediately and upgrade to real conformers once ready.
void preloadConformerResources()
  .then(() => {
    rebuildGraph();
  })
  .catch((error) => {
    console.warn("Conformer resources unavailable; keeping VSEPR layout.", error);
  });

showImportStatus("Loading RDKit.js chemistry...");
void preloadRDKit()
  .then(({ version }) => {
    showImportStatus(`RDKit.js ${version} ready for SMILES and Molfile imports.`);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(`RDKit.js unavailable; lightweight parser fallback active. ${message}`);
  });
