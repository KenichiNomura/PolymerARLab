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
  type MonomerSelection,
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
const makePolymerPanel = document.getElementById("makePolymerPanel") as HTMLDetailsElement;
const anchorASelect = document.getElementById("anchorASelect") as HTMLSelectElement;
const anchorBSelect = document.getElementById("anchorBSelect") as HTMLSelectElement;
const makeRepeatUnitBtn = document.getElementById("makeRepeatUnitBtn") as HTMLButtonElement;
const mechanismAddition = document.getElementById("mechanismAddition") as HTMLInputElement;
const mechanismCondensation = document.getElementById("mechanismCondensation") as HTMLInputElement;
const mechanismHint = document.getElementById("mechanismHint")!;
const twoMonomerBtn = document.getElementById("twoMonomerBtn") as HTMLButtonElement;
const twoMonomerStatus = document.getElementById("twoMonomerStatus") as HTMLElement;
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

// Two-monomer condensation flow: monomer A is stashed (raw template + anchors
// for the chemistry, plus its laid-out geometry for the side-by-side preview)
// while the user loads monomer B, because loading B replaces importedTemplate.
let pendingMonomerA: MonomerSelection | null = null;
let monomerADisplay: PolymerTemplate | null = null;
let pendingMonomerB: PolymerTemplate | null = null;
// The molecule currently backing the anchor dropdowns (plus an optional atom-id
// prefix restriction while the A+B pair preview is shown).
let anchorTemplate: PolymerTemplate | null = null;
let anchorPrefixFilter: string | null = null;
let anchorsUsable = false;

function currentMechanism(): PolymerMechanism {
  return mechanismCondensation.checked ? "condensation" : "addition";
}

const MECHANISM_HINTS: Record<PolymerMechanism, string> = {
  addition:
    "Pick the two backbone atoms by their labels (e.g. the C=C carbons C1 and C2); the double bond opens and the unit tiles into a chain.",
  condensation:
    "Pick the -COOH carbon as one anchor and the -OH oxygen (or -NH2 nitrogen) as the other; each new bond releases a water molecule.",
};

// One primary + one secondary button cover both flows: the primary is
// "Make repeat unit" normally and becomes "Combine A + B" while a monomer A is
// staged; the secondary stages/discards monomer A (condensation only).
function updatePolymerButtons() {
  const condensation = currentMechanism() === "condensation";
  const pairing = pendingMonomerA !== null;
  mechanismHint.textContent = MECHANISM_HINTS[currentMechanism()];
  makeRepeatUnitBtn.textContent = pairing ? "Combine A + B" : "Make repeat unit";
  makeRepeatUnitBtn.disabled = !anchorsUsable || (pairing && !pendingMonomerB);
  twoMonomerBtn.hidden = !condensation || isPolymerMode();
  twoMonomerBtn.disabled = !pairing && !anchorsUsable;
  twoMonomerBtn.textContent = pairing ? "✕ Discard monomer A" : "+ Use two monomers (A-A + B-B)";
  twoMonomerStatus.hidden = !pairing;
  if (pendingMonomerA) {
    const name = pendingMonomerA.template.name || "monomer A";
    twoMonomerStatus.textContent = pendingMonomerB
      ? `Monomer A: ${name}. Pick monomer B's two anchors, then Combine A + B.`
      : `Monomer A: ${name}. Load monomer B (PubChem or scan), then pick its anchors.`;
  }
}

function onMechanismChange() {
  // The pair flow is condensation-only; leaving the mechanism dissolves it.
  if (currentMechanism() === "addition" && pendingMonomerA) {
    discardMonomerA();
    return;
  }
  updatePolymerButtons();
  if (anchorTemplate) applyAnchorPreselect(anchorTemplate);
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
  // Reveal the Repeats control (now inside this panel) whenever a polymer is active.
  if (polymerMode) makePolymerPanel.open = true;
  updatePolymerButtons();
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
    populateAnchorControls(importedTemplate);
    maybeEnterPairPreview();
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
  populateAnchorControls(template);
  maybeEnterPairPreview();
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
  updatePolymerButtons();
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

function makeRepeatUnit() {
  if (!importedTemplate) {
    showImportStatus("Load a molecule first, then choose two backbone atoms.");
    return;
  }
  try {
    const mechanism = currentMechanism();
    const derived = deriveRepeatUnit(importedTemplate, anchorASelect.value, anchorBSelect.value, { mechanism });
    activatePolymerTemplate(derived);
    showImportStatus(`Repeat unit from ${anchorASelect.value}-${anchorBSelect.value}: ${derived.name}.`);
    showStatus(
      mechanism === "condensation"
        ? "Polymer repeat unit derived; each new link releases one H2O. Adjust Repeats to grow the chain."
        : "Polymer repeat unit derived; adjust Repeats or re-pick the connection atoms.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(message);
    showStatus(`Could not derive a repeat unit: ${message}`, true);
  }
}

// Shared tail of makeRepeatUnit / combineMonomers: install the derived repeat
// unit as the imported template and rebuild in polymer mode.
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

// Stage the current molecule as monomer A: keep its raw template + anchors for
// the chemistry and its laid-out geometry for the side-by-side preview.
function useTwoMonomers() {
  if (!importedTemplate) {
    showImportStatus("Load monomer A first (PubChem, scan, or example), then pick its two anchors.");
    return;
  }
  // Students pick monomer A's two anchors themselves; reject unusable picks
  // now, with a readable message, rather than later at Combine.
  try {
    assertCondensationAnchors(importedTemplate, anchorASelect.value, anchorBSelect.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(message);
    showStatus(`Check monomer A's anchors: ${message}`, true);
    return;
  }
  pendingMonomerA = { template: importedTemplate, anchorA: anchorASelect.value, anchorB: anchorBSelect.value };
  monomerADisplay = currentTemplate;
  pendingMonomerB = null;
  updatePolymerButtons();
  showStatus(`Monomer A set: ${importedTemplate.name || "monomer A"}. Load monomer B next.`);
}

function discardMonomerA() {
  const restore = pendingMonomerB;
  pendingMonomerA = null;
  monomerADisplay = null;
  pendingMonomerB = null;
  if (restore) {
    // The screen shows the A+B pair preview; go back to monomer B alone.
    importedTemplate = restore;
    importedTemplateOption.textContent = `${restore.shortName} - ${restore.name}`;
    rebuildGraph();
    populateAnchorControls(restore);
  } else {
    updatePolymerButtons();
  }
  showStatus("Monomer A discarded.");
}

// Called after every structure load: while a monomer A is staged (condensation),
// the freshly loaded molecule becomes monomer B and both render side by side —
// A left, B right, "A"/"B" tags — before the user commits to Combine.
function maybeEnterPairPreview() {
  if (!pendingMonomerA || !monomerADisplay || !importedTemplate) return;
  if (currentMechanism() !== "condensation") return;
  pendingMonomerB = importedTemplate;
  const preview = buildMonomerPairPreview(monomerADisplay, currentTemplate);
  importedTemplate = preview;
  importedTemplateOption.textContent = `${preview.shortName} - ${preview.name}`;
  polymerSelect.value = IMPORTED_TEMPLATE_ID;
  rebuildGraph();
  populateAnchorControls(preview, { onlyPrefix: "B_" });
  showStatus("Monomer B loaded. Pick its two anchors (right molecule), then Combine A + B.");
}

function combineMonomers() {
  if (!pendingMonomerA || !pendingMonomerB) {
    showImportStatus("Load monomer B first, then Combine.");
    return;
  }
  try {
    // Anchor values come from the pair preview, where B's atom ids are prefixed.
    const combined = combineCondensationMonomers(pendingMonomerA, {
      template: pendingMonomerB,
      anchorA: anchorASelect.value.replace(/^B_/, ""),
      anchorB: anchorBSelect.value.replace(/^B_/, ""),
    });
    activatePolymerTemplate(combined);
    pendingMonomerA = null;
    monomerADisplay = null;
    pendingMonomerB = null;
    updatePolymerButtons();
    showImportStatus(`Combined repeat unit: ${combined.name}.`);
    showStatus("Monomers combined; every ester/amide bond releases one H2O. Adjust Repeats to grow the chain.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showImportStatus(message);
    showStatus(`Could not combine the monomers: ${message}`, true);
  }
}

// Fetch a molecule from PubChem by CID or name and render it with PubChem's own
// 3D coordinates (see buildMoleculeTemplate3D / explicitGeometry).
async function loadFromPubChem() {
  const query = pubchemInput.value.trim();
  if (!query) {
    showImportStatus("Enter a PubChem name or CID.");
    return;
  }
  pubchemLoadBtn.disabled = true;
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
  void loadFromPubChem();
});
pubchemInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loadFromPubChem();
  }
});
makeRepeatUnitBtn.addEventListener("click", () => (pendingMonomerA ? combineMonomers() : makeRepeatUnit()));
twoMonomerBtn.addEventListener("click", () => (pendingMonomerA ? discardMonomerA() : useTwoMonomers()));
mechanismAddition.addEventListener("change", onMechanismChange);
mechanismCondensation.addEventListener("change", onMechanismChange);
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
