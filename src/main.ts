import { aiAccessToken, aiRecognitionEndpoint } from "./aiRecognition";
import { C60_TEMPLATE } from "./c60";
import { createCameraOverlay } from "./cameraOverlay";
import { conformerResourcesReady, preloadConformerResources, templateTo3D } from "./conformer3d";
import { renderFallbackGraph } from "./fallback2d";
import { buildUFFData, buildUFFInput, downloadTextFile } from "./lammpsExport";
import { isIOSDevice } from "./platform";
import {
  POLYMER_TEMPLATES,
  elementLabels,
  generatePolymerGraph,
  getTemplate,
  summarizeBondOrders,
  type MolecularGraph,
  type PolymerMechanism,
  type PolymerTemplate,
} from "./polymerData";
import { fetchCompound, resolveCid } from "./pubchem";
import { RDKitImportError, normalizeStructureWithRDKit, preloadRDKit } from "./rdkitService";
import { runSketchRecognition, type ImportOutcome } from "./recognitionFlow";
import { createScanFrame } from "./scanFrame";
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
import {
  IMPORTED_TEMPLATE_ID,
  assertCondensationAnchors,
  buildMoleculeTemplate3D,
  buildMonomerPairPreview,
  combineCondensationMonomers,
  deriveRepeatUnit,
  importStructure,
  type StructureImportFormat,
} from "./structureImport";
import { populateTemplateSelect } from "./ui/examples";
import { showImportStatus, showPlatformStatus, showScanStatus, showStatus } from "./ui/status";
import { cleanupTemplateGeometry } from "./vseprGeometry";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const appEl = document.getElementById("app")!;
const fallbackEl = document.getElementById("fallbackMolecule")!;
const videoEl = document.getElementById("cameraFeed") as HTMLVideoElement;
const arEntryEl = document.getElementById("arEntry")!;
const polymerSelect = document.getElementById("polymerSelect") as HTMLSelectElement;
const anchorASelect = document.getElementById("anchorASelect") as HTMLSelectElement;
const anchorBSelect = document.getElementById("anchorBSelect") as HTMLSelectElement;
const makeRepeatUnitBtn = document.getElementById("makeRepeatUnitBtn") as HTMLButtonElement;
const mechanismHint = document.getElementById("mechanismHint")!;
const polymerPanel = document.getElementById("polymerPanel") as HTMLElement;
const polymerToggleBtn = document.getElementById("polymerToggleBtn") as HTMLButtonElement;
const builderChooser = document.getElementById("builderChooser") as HTMLElement;
const modeAdditionBtn = document.getElementById("modeAdditionBtn") as HTMLButtonElement;
const modeCondensationBtn = document.getElementById("modeCondensationBtn") as HTMLButtonElement;
const builderSection = document.getElementById("builderSection") as HTMLElement;
const builderTitle = document.getElementById("builderTitle")!;
const builderResetBtn = document.getElementById("builderResetBtn") as HTMLButtonElement;
const slotToggle = document.getElementById("slotToggle") as HTMLElement;
const slotABtn = document.getElementById("slotABtn") as HTMLButtonElement;
const slotBBtn = document.getElementById("slotBBtn") as HTMLButtonElement;
const builderPubchemInput = document.getElementById("builderPubchemInput") as HTMLInputElement;
const builderPubchemLoadBtn = document.getElementById("builderPubchemLoadBtn") as HTMLButtonElement;
const builderSketchBtn = document.getElementById("builderSketchBtn") as HTMLButtonElement;
const anchorStepLabel = document.getElementById("anchorStepLabel")!;
const builderStatus = document.getElementById("builderStatus") as HTMLElement;
const repeatRange = document.getElementById("repeatRange") as HTMLInputElement;
const repeatValue = document.getElementById("repeatValue")!;
const labelsToggle = document.getElementById("labelsToggle") as HTMLInputElement;
const hydrogensToggle = document.getElementById("hydrogensToggle") as HTMLInputElement;
const cameraModeBtn = document.getElementById("cameraModeBtn") as HTMLButtonElement;
const uploadSketchBtn = document.getElementById("uploadSketchBtn") as HTMLButtonElement;
const sketchFileInput = document.getElementById("sketchFileInput") as HTMLInputElement;
const saveLammpsBtn = document.getElementById("saveLammpsBtn") as HTMLButtonElement;
const pubchemInput = document.getElementById("pubchemInput") as HTMLInputElement;
const pubchemLoadBtn = document.getElementById("pubchemLoadBtn") as HTMLButtonElement;
const resetViewBtn = document.getElementById("resetViewBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const arQuickLookBtn = document.getElementById("arQuickLookBtn") as HTMLButtonElement;
const statusToggleBtn = document.getElementById("statusToggleBtn") as HTMLButtonElement;
const statusPanel = document.getElementById("statusPanel") as HTMLElement;
const editToggleBtn = document.getElementById("editToggleBtn") as HTMLButtonElement;
const editPanel = document.getElementById("editPanel") as HTMLElement;
const tutorialBtn = document.getElementById("tutorialBtn") as HTMLButtonElement;
const captureFlash = document.getElementById("captureFlash") as HTMLElement;
const scanBusy = document.getElementById("scanBusy") as HTMLElement;
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

// Polymer builder: the student picks a curing mechanism first, then loads
// monomers into explicit slots (A, plus an optional B for condensation) and
// picks each slot's anchor atoms. Anchor ids are stored raw (unprefixed); the
// A_/B_ prefixes exist only inside the side-by-side pair preview.
type SlotName = "A" | "B";
interface MonomerSlot {
  template: PolymerTemplate; // raw chemistry template (pre-layout)
  display: PolymerTemplate; // laid-out geometry for the pair preview
  anchorA?: string;
  anchorB?: string;
}
let builder: {
  mechanism: PolymerMechanism;
  activeSlot: SlotName;
  slots: Record<SlotName, MonomerSlot | null>;
} | null = null;
// The molecule currently backing the anchor dropdowns (plus an optional atom-id
// prefix restriction while the A+B pair preview is shown).
let anchorTemplate: PolymerTemplate | null = null;
let anchorPrefixFilter: string | null = null;
let anchorsUsable = false;

function currentMechanism(): PolymerMechanism {
  return builder?.mechanism ?? "addition";
}

const MODE_TITLES: Record<PolymerMechanism, string> = {
  addition: "Addition cure",
  condensation: "Condensation cure",
};

const MECHANISM_HINTS: Record<PolymerMechanism, string> = {
  addition:
    "Pick the two backbone atoms by their labels (e.g. the C=C carbons C1 and C2); the double bond opens and the unit tiles into a chain.",
  condensation:
    "Pick the -COOH carbon as one anchor and the -OH oxygen (or -NH2 nitrogen) as the other; each new bond releases a water molecule.",
};

function showBuilderStatus(message: string, isError = false) {
  builderStatus.textContent = message;
  builderStatus.classList.toggle("is-error", isError);
}

// Entering a mode always starts from a clean scene; a built chain asks first.
function enterBuilderMode(mechanism: PolymerMechanism) {
  if (isPolymerMode() && currentGraph) {
    const ok = window.confirm(`Start a new ${MODE_TITLES[mechanism].toLowerCase()} polymer? The current chain will be cleared.`);
    if (!ok) return;
  }
  builder = { mechanism, activeSlot: "A", slots: { A: null, B: null } };
  setPolymerMode(false);
  clearMolecule();
  renderBuilderUi();
  showBuilderStatus(
    mechanism === "condensation"
      ? "Load monomer A - a molecule with -COOH, -OH, or -NH2 ends (try lactic acid or ethylene glycol)."
      : "Load a monomer with a C=C double bond (try ethylene or styrene).",
  );
}

function exitBuilder() {
  if (isPolymerMode() && currentGraph && !window.confirm("Start over? The current chain will be cleared.")) return;
  builder = null;
  setPolymerMode(false);
  clearMolecule();
  resetAnchorControls();
  renderBuilderUi();
}

function resetAnchorControls() {
  anchorASelect.replaceChildren();
  anchorBSelect.replaceChildren();
  anchorASelect.disabled = true;
  anchorBSelect.disabled = true;
  anchorsUsable = false;
  anchorTemplate = null;
  anchorPrefixFilter = null;
}

// Reflect the builder state in the panel: chooser vs numbered steps, slot
// fill/active markers, per-mechanism hints, and the build button.
function renderBuilderUi() {
  builderChooser.hidden = builder !== null;
  builderSection.hidden = builder === null;
  if (!builder) return;
  builderTitle.textContent = MODE_TITLES[builder.mechanism];
  mechanismHint.textContent = MECHANISM_HINTS[builder.mechanism];
  slotToggle.hidden = builder.mechanism !== "condensation";
  const slotLabel = (name: SlotName) => {
    const slot = builder!.slots[name];
    const filled = slot ? slot.template.shortName || slot.template.name || "loaded" : "empty";
    return `${name}: ${filled}`;
  };
  slotABtn.textContent = slotLabel("A");
  slotBBtn.textContent = slotLabel("B");
  slotABtn.classList.toggle("is-active", builder.activeSlot === "A");
  slotBBtn.classList.toggle("is-active", builder.activeSlot === "B");
  anchorStepLabel.textContent =
    builder.mechanism === "condensation" ? `2 · Pick monomer ${builder.activeSlot}'s two anchor atoms` : "2 · Pick the two anchor atoms";
  makeRepeatUnitBtn.textContent =
    builder.mechanism === "condensation" && builder.slots.A && builder.slots.B ? "Make repeat unit (combine A + B)" : "Make repeat unit";
  makeRepeatUnitBtn.disabled = !builder.slots.A || !anchorsUsable;
}

// Polymer mode is entered programmatically (deriving a repeat unit or choosing a
// polymer example), not via a user toggle.
let polymerModeActive = false;

function isPolymerMode() {
  return polymerModeActive;
}

function setPolymerMode(on: boolean) {
  polymerModeActive = on;
  updateStructureModeUi();
}

function updateStructureModeUi() {
  const polymerMode = isPolymerMode();
  document.body.classList.toggle("polymer-mode", polymerMode);
  repeatRange.disabled = !polymerMode;
  renderBuilderUi();
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
  // Structures that ship with baked 3D coordinates (e.g. C60) skip both the
  // conformer generator and the VSEPR fallback.
  if (template.explicitGeometry) return template;
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
  currentGraph = generatePolymerGraph(currentTemplate, repeatCount, { capChainEnds: isPolymerMode() });

  quickLook.scheduleRefresh();
  updateSummary();
  updateThreeGraph();
  renderFallbackGraph(fallbackEl, currentGraph, currentTemplate.name, Boolean(three));
}

// Empties the display. Any later structure action (choose example, scan,
// import, mode/repeat change) rebuilds a molecule, so Clear hides what is
// shown rather than permanently disabling the app.
function clearMolecule() {
  currentGraph = null;
  if (three) {
    three.moleculeRoot.visible = false;
    three.byproductAnimator.sync(null, three.moleculeRenderer);
  }
  fallbackEl.innerHTML = "";
  structureSummary.textContent = "No structure loaded.";
  validationStatus.textContent = "";
  scanPreview.classList.remove("has-capture");
  scanPreview.style.backgroundImage = "";
  quickLook.scheduleRefresh();
  // Clearing while the builder is open empties the monomer slots but keeps the
  // chosen mechanism, so the student can reload without starting over.
  if (builder) {
    builder.slots = { A: null, B: null };
    builder.activeSlot = "A";
    setPolymerMode(false);
    resetAnchorControls();
    renderBuilderUi();
    showBuilderStatus("Cleared. Load a monomer to continue.");
  }
  showStatus("Cleared the current structure.");
}

function updateThreeGraph() {
  if (!three || !currentGraph) return;
  three.moleculeRenderer.setGraph(currentGraph);
  three.moleculeRenderer.setLabelsVisible(labelsToggle.checked);
  three.byproductAnimator.sync(currentGraph, three.moleculeRenderer);
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
  const byproductText = currentGraph.byproducts.length ? ` | releases ${currentGraph.byproducts.length} H2O` : "";
  structureSummary.textContent =
    `${modeLabel}: ${structureLabel}${repeatText} | ${currentGraph.atoms.length} atoms | ${currentGraph.bonds.length} bonds${byproductText}\n` +
    `single ${bondSummary.single} | double ${bondSummary.double} | triple ${bondSummary.triple} | aromatic ${bondSummary.aromatic}`;

  validationStatus.textContent = currentGraph.warnings.length
    ? currentGraph.warnings.slice(0, 2).join("\n")
    : "Valence check passed for this display graph.";
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

const importedTemplateOption = populateTemplateSelect(polymerSelect);

// Internal import used by the curated examples and the sketch recognizer (the
// user-facing paste panel was removed). Attachment atoms come from the graph
// JSON itself, so no manual attachment override is passed.
async function loadImportedStructure(
  input: string,
  format: StructureImportFormat,
  options: { repeatOverride?: number } = {},
): Promise<ImportOutcome> {
  try {
    const normalized = await normalizeWithChemistryFallback(input, format);
    const result = importStructure(normalized.input, normalized.format, {});
    importedTemplate =
      options.repeatOverride == null
        ? result.template
        : { ...result.template, defaultRepeats: clampRepeats(options.repeatOverride, result.template.maxRepeats) };
    importedTemplateOption.hidden = false;
    importedTemplateOption.textContent = `${importedTemplate.shortName} - ${importedTemplate.name}`;
    polymerSelect.value = IMPORTED_TEMPLATE_ID;
    repeatRange.value = String(importedTemplate.defaultRepeats);
    rebuildGraph();
    onStructureLoaded();
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

// Load a ready-built molecule template (baked geometry, e.g. C60 or a PubChem
// download) into the single "imported" slot and render it as a molecule.
function showImportedTemplate(template: PolymerTemplate, statusMessage: string) {
  setPolymerMode(false);
  importedTemplate = template;
  importedTemplateOption.hidden = false;
  importedTemplateOption.textContent = `${template.shortName} - ${template.name}`;
  polymerSelect.value = IMPORTED_TEMPLATE_ID;
  repeatRange.value = "1";
  rebuildGraph();
  onStructureLoaded();
  showStatus(statusMessage);
}

// Fill the "Make Polymer from Monomer" anchor selects from a molecule's heavy
// atoms, labelled with the same per-element index shown in the 3D view (C1, C2,
// O1, ...), and pre-select the first double/triple bond (the vinyl case).
function populateAnchorControls(template: PolymerTemplate, options: { onlyPrefix?: string } = {}) {
  // Labels are numbered over the FULL template so they match the 3-D sprites,
  // even when the dropdowns only offer monomer B's atoms of a pair preview.
  const labels = elementLabels(template.atoms);
  const heavy = template.atoms.filter(
    (atom) => atom.element !== "H" && (!options.onlyPrefix || atom.id.startsWith(options.onlyPrefix)),
  );
  anchorASelect.replaceChildren();
  anchorBSelect.replaceChildren();
  anchorsUsable = heavy.length >= 2;
  anchorASelect.disabled = !anchorsUsable;
  anchorBSelect.disabled = !anchorsUsable;
  anchorTemplate = anchorsUsable ? template : null;
  anchorPrefixFilter = options.onlyPrefix ?? null;
  renderBuilderUi();
  if (!anchorsUsable) return;

  for (const atom of heavy) {
    const label = labels.get(atom.id) ?? atom.element;
    anchorASelect.appendChild(anchorOption(atom.id, label));
    anchorBSelect.appendChild(anchorOption(atom.id, label));
  }

  applyAnchorPreselect(template);
}

// Suggest sensible anchors for the active mechanism: the first double/triple
// bond for addition (the vinyl case); for condensation, reactive sites in
// -COOH-carbon / -OH / -NH2 order, so a hydroxy acid gets acid + partner and a
// diacid or diol gets its two like groups. The user can still re-pick anything.
function applyAnchorPreselect(template: PolymerTemplate) {
  const heavy = template.atoms.filter(
    (atom) => atom.element !== "H" && (!anchorPrefixFilter || atom.id.startsWith(anchorPrefixFilter)),
  );
  if (heavy.length < 2) return;

  if (currentMechanism() === "condensation") {
    const heavyIds = new Set(heavy.map((atom) => atom.id));
    const elementById = new Map(heavy.map((atom) => [atom.id, atom.element]));
    const heavyBonds = template.bonds.filter((bond) => heavyIds.has(bond.a) && heavyIds.has(bond.b));
    const neighborsOf = (atomId: string) =>
      heavyBonds
        .filter((bond) => bond.a === atomId || bond.b === atomId)
        .map((bond) => ({ otherId: bond.a === atomId ? bond.b : bond.a, order: bond.order }));

    const acidCarbons: string[] = [];
    const acidHydroxyls = new Set<string>();
    for (const atom of heavy) {
      if (atom.element !== "C") continue;
      const neighbors = neighborsOf(atom.id);
      const carbonyl = neighbors.some((n) => n.order === 2 && elementById.get(n.otherId) === "O");
      const hydroxyl = neighbors.find(
        (n) => n.order === 1 && elementById.get(n.otherId) === "O" && neighborsOf(n.otherId).length === 1,
      );
      if (carbonyl && hydroxyl) {
        acidCarbons.push(atom.id);
        acidHydroxyls.add(hydroxyl.otherId);
      }
    }
    const partners = heavy
      .filter((atom) => !acidHydroxyls.has(atom.id))
      .filter((atom) => {
        // All-single bonds only: a carbonyl =O or nitrile N also has low
        // degree but cannot condense.
        const neighbors = neighborsOf(atom.id);
        if (!neighbors.every((n) => n.order === 1)) return false;
        return (atom.element === "O" && neighbors.length === 1) || (atom.element === "N" && neighbors.length <= 2);
      })
      .map((atom) => atom.id);

    // Acid + partner (hydroxy/amino acid), two acids (diacid), two partners
    // (diol/diamine) — in that order of preference.
    const pick =
      acidCarbons.length > 0 && partners.length > 0
        ? [partners[0], acidCarbons[0]]
        : acidCarbons.length >= 2
          ? [acidCarbons[0], acidCarbons[1]]
          : partners.length >= 2
            ? [partners[0], partners[1]]
            : [heavy[0].id, heavy[1].id];
    [anchorASelect.value, anchorBSelect.value] = pick;
    return;
  }

  const multiBond = template.bonds.find(
    (bond) => (bond.order === 2 || bond.order === 3) && heavy.some((a) => a.id === bond.a) && heavy.some((a) => a.id === bond.b),
  );
  anchorASelect.value = multiBond ? multiBond.a : heavy[0].id;
  anchorBSelect.value = multiBond ? multiBond.b : heavy[1].id;
}

function anchorOption(atomId: string, label: string) {
  const option = document.createElement("option");
  option.value = atomId;
  option.textContent = label;
  return option;
}

// Route a freshly loaded structure: plain molecule browsing shows it directly;
// with the builder open it also fills the active monomer slot.
function onStructureLoaded() {
  if (!builder || !importedTemplate) return;
  const raw = importedTemplate;
  builder.slots[builder.activeSlot] = { template: raw, display: currentTemplate };
  refreshBuilderView();
  const name = raw.name || raw.shortName || "molecule";
  showBuilderStatus(
    builder.mechanism === "condensation" && builder.activeSlot === "A" && !builder.slots.B
      ? `Monomer A: ${name}. Check its two anchor picks - or switch to slot B to add a second monomer.`
      : `Monomer ${builder.activeSlot}: ${name}. Check the anchor picks, then press Make repeat unit.`,
  );
}

// Show the builder's monomer(s): a single filled slot renders alone; both
// filled render stacked with A/B tags. The anchor dropdowns always follow the
// active slot (prefix-filtered inside the merged pair preview).
function refreshBuilderView() {
  if (!builder) return;
  // Editing slots always happens on the monomer preview, not the built chain
  // (a preview template must never tile through generatePolymerGraph).
  if (isPolymerMode()) setPolymerMode(false);
  const { A, B } = builder.slots;
  const active = builder.slots[builder.activeSlot];
  if (A && B) {
    const preview = buildMonomerPairPreview(A.display, B.display);
    importedTemplate = preview;
    importedTemplateOption.hidden = false;
    importedTemplateOption.textContent = `${preview.shortName} - ${preview.name}`;
    polymerSelect.value = IMPORTED_TEMPLATE_ID;
    rebuildGraph();
    populateAnchorControls(preview, { onlyPrefix: `${builder.activeSlot}_` });
  } else if (active) {
    importedTemplate = active.template;
    importedTemplateOption.hidden = false;
    importedTemplateOption.textContent = `${active.template.shortName} - ${active.template.name}`;
    polymerSelect.value = IMPORTED_TEMPLATE_ID;
    rebuildGraph();
    populateAnchorControls(active.template);
  } else {
    resetAnchorControls();
  }
  restoreSlotAnchors();
  renderBuilderUi();
}

// Anchor picks are stored raw per slot; the dropdowns carry A_/B_ prefixes only
// while the merged pair preview is shown.
function saveActiveSlotAnchors() {
  if (!builder || !anchorsUsable) return;
  const slot = builder.slots[builder.activeSlot];
  if (!slot) return;
  slot.anchorA = anchorASelect.value.replace(/^[AB]_/, "");
  slot.anchorB = anchorBSelect.value.replace(/^[AB]_/, "");
}

function restoreSlotAnchors() {
  if (!builder || !anchorsUsable) return;
  const slot = builder.slots[builder.activeSlot];
  if (!slot?.anchorA || !slot.anchorB) return;
  const prefix = anchorPrefixFilter ?? "";
  const a = `${prefix}${slot.anchorA}`;
  const b = `${prefix}${slot.anchorB}`;
  if ([...anchorASelect.options].some((option) => option.value === a)) anchorASelect.value = a;
  if ([...anchorBSelect.options].some((option) => option.value === b)) anchorBSelect.value = b;
}

function setActiveSlot(name: SlotName) {
  if (!builder || builder.activeSlot === name) return;
  saveActiveSlotAnchors();
  builder.activeSlot = name;
  refreshBuilderView();
  const slot = builder.slots[name];
  showBuilderStatus(
    slot
      ? `Monomer ${name}: ${slot.template.name}. Check its two anchor picks.`
      : `Slot ${name} is empty - load a molecule for monomer ${name}.`,
  );
}

// One button covers every flow: addition, single-monomer condensation, and the
// two-monomer A+B combine. Bad anchor picks surface the validation message.
function makeRepeatUnit() {
  if (!builder) return;
  saveActiveSlotAnchors();
  const { A, B } = builder.slots;
  if (!A?.anchorA || !A.anchorB) {
    showBuilderStatus("Load monomer A first, then pick its two anchor atoms.", true);
    return;
  }
  try {
    let derived: PolymerTemplate;
    if (builder.mechanism === "condensation" && B) {
      if (!B.anchorA || !B.anchorB) throw new Error("Pick monomer B's two anchor atoms (switch to slot B).");
      assertCondensationAnchors(A.template, A.anchorA, A.anchorB);
      assertCondensationAnchors(B.template, B.anchorA, B.anchorB);
      derived = combineCondensationMonomers(
        { template: A.template, anchorA: A.anchorA, anchorB: A.anchorB },
        { template: B.template, anchorA: B.anchorA, anchorB: B.anchorB },
      );
    } else {
      derived = deriveRepeatUnit(A.template, A.anchorA, A.anchorB, { mechanism: builder.mechanism });
    }
    activatePolymerTemplate(derived);
    showBuilderStatus(`${derived.name} - drag Repeats to grow the chain.`);
    showStatus(
      builder.mechanism === "condensation"
        ? "Polymer built; every new bond releases one H2O. Adjust Repeats to grow the chain."
        : "Polymer built; adjust Repeats to grow the chain.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showBuilderStatus(message, true);
    showStatus(`Could not build the polymer: ${message}`, true);
  }
}

// Shared tail of every build: install the derived repeat unit as the imported
// template and rebuild in polymer mode.
function activatePolymerTemplate(derived: PolymerTemplate) {
  setPolymerMode(true);
  importedTemplate = derived;
  importedTemplateOption.hidden = false;
  importedTemplateOption.textContent = `${derived.shortName} - ${derived.name}`;
  polymerSelect.value = IMPORTED_TEMPLATE_ID;
  // Raise max before value: the slider still carries molecule-mode max=1 and
  // would silently clamp defaultRepeats down to 1.
  repeatRange.max = String(derived.maxRepeats);
  repeatRange.value = String(derived.defaultRepeats);
  rebuildGraph();
}

// Fetch a molecule from PubChem by CID or name and render it with PubChem's own
// 3D coordinates (see buildMoleculeTemplate3D / explicitGeometry). Both the
// Edit panel and the polymer builder feed their input value through here.
async function loadFromPubChem(query: string) {
  query = query.trim();
  if (!query) {
    showImportStatus("Enter a PubChem name or CID.");
    return;
  }
  pubchemLoadBtn.disabled = true;
  builderPubchemLoadBtn.disabled = true;
  showImportStatus(`Looking up "${query}" on PubChem...`);
  try {
    const cid = await resolveCid(query);
    const { sdf, is3d, title } = await fetchCompound(cid);
    const template = buildMoleculeTemplate3D(sdf, title, is3d);
    showImportedTemplate(template, `Loaded PubChem CID ${cid}: ${title}.`);
    showImportStatus(
      `PubChem CID ${cid}: ${title} - ${template.atoms.length} atoms, ${template.bonds.length} bonds${
        is3d ? "." : " (2D record; generated 3D)."
      }`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(message);
    showStatus(`PubChem load failed: ${message}`, true);
  } finally {
    pubchemLoadBtn.disabled = false;
    builderPubchemLoadBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// LAMMPS export (ReaxFF): geometry with hydrogens, ready to relax
// ---------------------------------------------------------------------------

// Always returns a hydrogens-included graph. If hydrogens are hidden and the
// structure is conformer-based, rebuild an H-included graph for export without
// disturbing the on-screen view. explicitGeometry templates (PubChem/C60) carry
// their own atoms, so currentGraph already reflects them.
function graphForExport(): MolecularGraph | null {
  if (!currentGraph) return null;
  const base = getActiveTemplate(polymerSelect.value);
  if (hydrogensToggle.checked || base.explicitGeometry) return currentGraph;
  const mode = isPolymerMode() ? "polymer" : "molecule";
  const withH = templateTo3D(base, { mode, includeHydrogens: true }) ?? cleanupTemplateGeometry(base, { mode });
  const repeatCount = isPolymerMode() ? Number(repeatRange.value) : 1;
  return generatePolymerGraph(withH, repeatCount, { capChainEnds: isPolymerMode() });
}

function saveLammps() {
  const graph = graphForExport();
  if (!graph) {
    showStatus("Load or build a structure first, then Save.", true);
    return;
  }
  const baseName =
    (currentTemplate.shortName || currentTemplate.name || "structure").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "structure";
  const data = buildUFFData(graph, baseName);
  downloadTextFile(`${baseName}.data`, data.text);
  downloadTextFile("in.relax", buildUFFInput(data.elementsInTypeOrder, baseName, data.counts));
  const c = data.counts;
  const summary = `Saved ${baseName}.data (${c.atoms} atoms, ${c.bonds} bonds, ${c.angles} angles) and in.relax. Self-contained UFF-style force field (approximate); no ffield file needed.`;
  showImportStatus(summary);
  showStatus(summary);
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
  await runRecognitionWithProgress("image-upload");
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
  overlayEl: fallbackEl,
  frameEl: document.getElementById("scanFrameBox")!,
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

polymerSelect.addEventListener("change", () => {
  const template = getActiveTemplate(polymerSelect.value);
  repeatRange.value = String(template.defaultRepeats);
  rebuildGraph();
  showStatus(`Verification target: ${template.shortName}.`);
});

pubchemLoadBtn.addEventListener("click", () => {
  void loadFromPubChem(pubchemInput.value);
});
pubchemInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loadFromPubChem(pubchemInput.value);
  }
});
builderPubchemLoadBtn.addEventListener("click", () => {
  void loadFromPubChem(builderPubchemInput.value);
});
builderPubchemInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loadFromPubChem(builderPubchemInput.value);
  }
});
builderSketchBtn.addEventListener("click", () => sketchFileInput.click());
makeRepeatUnitBtn.addEventListener("click", makeRepeatUnit);
modeAdditionBtn.addEventListener("click", () => enterBuilderMode("addition"));
modeCondensationBtn.addEventListener("click", () => enterBuilderMode("condensation"));
builderResetBtn.addEventListener("click", exitBuilder);
slotABtn.addEventListener("click", () => setActiveSlot("A"));
slotBBtn.addEventListener("click", () => setActiveSlot("B"));
saveLammpsBtn.addEventListener("click", saveLammps);
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
// Brief shutter flash so a tap-to-capture feels like taking a photo.
function flashShutter() {
  captureFlash.classList.remove("flash");
  void captureFlash.offsetWidth; // restart the animation
  captureFlash.classList.add("flash");
}

// Wrap a recognition run with a spinner while it works.
function runRecognitionWithProgress(source: "camera-capture" | "image-upload") {
  scanBusy.classList.add("is-on");
  return runSketchRecognition(source, recognitionOptions).finally(() => scanBusy.classList.remove("is-on"));
}

function captureFromCamera() {
  if (!cameraOverlay.drawFrameTo(scanCanvas)) return;
  updateScanPreview();
  flashShutter();
  void runRecognitionWithProgress("camera-capture");
}
createScanFrame({
  boxEl: document.getElementById("scanFrameBox")!,
  cornerEls: [...document.querySelectorAll<HTMLElement>("#scanFrameBox .scan-corner")],
  onCapture: captureFromCamera,
});
uploadSketchBtn.addEventListener("click", () => sketchFileInput.click());
sketchFileInput.addEventListener("change", () => {
  void loadSketchImageFile();
});
resetViewBtn.addEventListener("click", () => {
  if (three) resetView(three);
});
clearBtn.addEventListener("click", clearMolecule);
function togglePanel(panel: HTMLElement, button: HTMLButtonElement) {
  const open = panel.hidden; // about to open
  panel.hidden = !open;
  button.classList.toggle("is-active", open);
  button.setAttribute("aria-pressed", String(open));
}
statusToggleBtn.addEventListener("click", () => togglePanel(statusPanel, statusToggleBtn));
editToggleBtn.addEventListener("click", () => togglePanel(editPanel, editToggleBtn));
polymerToggleBtn.addEventListener("click", () => {
  togglePanel(polymerPanel, polymerToggleBtn);
  // Anchor picking needs the C1/O2/... labels, so opening the builder turns
  // them on. They stay on after closing; the Edit toggle turns them back off.
  if (!polymerPanel.hidden && !labelsToggle.checked) {
    labelsToggle.checked = true;
    three?.moleculeRenderer.setLabelsVisible(true);
    showStatus("Atom labels turned on for anchor picking.");
  }
});
tutorialBtn.addEventListener("click", () => window.open("tutorial.html", "_blank", "noopener"));
arQuickLookBtn.addEventListener("click", () => {
  // An active camera stream holds the camera hardware that iOS AR Quick Look
  // needs, so stop the overlay first and let the next tap launch AR with the
  // camera fully released (same reason WebXR stops it on session start).
  if (cameraOverlay.isActive()) {
    cameraOverlay.stop();
    showStatus("Camera stopped - tap the AR button again to place it in AR.");
    return;
  }
  void quickLook.handleTap();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Persist any ?ai=<url>/off/default endpoint and ?aitoken= choices on load.
aiRecognitionEndpoint();
aiAccessToken();

polymerSelect.value = currentTemplate.id;
repeatRange.value = String(currentTemplate.defaultRepeats);
repeatRange.max = String(currentTemplate.maxRepeats);

three = initThreeRuntime(appEl, (message) => {
  showStatus(`WebGL unavailable in this Safari tab: ${message}`, true);
});

updateStructureModeUi();
// Show C60 by default (baked geometry — needs neither RDKit nor conformer
// resources nor a network call, so it renders immediately on boot).
showImportedTemplate(C60_TEMPLATE, `Verification target: ${C60_TEMPLATE.shortName}.`);

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
