import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { aiRecognitionEndpoint, recognizeSketchWithAI } from "./aiRecognition";
import { preloadConformerResources, templateTo3D } from "./conformer3d";
import { getElementInfo } from "./elements";
import { GraphMoleculeRenderer } from "./graphMoleculeRenderer";
import {
  POLYMER_TEMPLATES,
  generatePolymerGraph,
  getTemplate,
  summarizeBondOrders,
  type BondOrder,
  type GraphAtom,
  type MolecularGraph,
  type PolymerTemplate,
  type TemplateAtom,
} from "./polymerData";
import { RDKitImportError, normalizeStructureWithRDKit, preloadRDKit } from "./rdkitService";
import type { RecognitionSource } from "./scannerContract";
import { recognizeSketch, recognizedStructureToImportJson } from "./scannerPipeline";
import { IMPORTED_TEMPLATE_ID, importStructure, updateTemplateAttachments, type StructureImportFormat } from "./structureImport";
import { cleanupTemplateGeometry } from "./vseprGeometry";

interface ThreeRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  moleculeRoot: THREE.Group;
  moleculeRenderer: GraphMoleculeRenderer;
  reticle: THREE.Mesh;
  grid: THREE.GridHelper;
  arHitTestSource: any;
  arLocalSpace: any;
}

type CameraNavigator = Navigator & {
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    failure: (error: DOMException) => void,
  ) => void;
  mozGetUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    failure: (error: DOMException) => void,
  ) => void;
};

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
const importStatus = document.getElementById("importStatus")!;
const repeatRange = document.getElementById("repeatRange") as HTMLInputElement;
const repeatValue = document.getElementById("repeatValue")!;
const labelsToggle = document.getElementById("labelsToggle") as HTMLInputElement;
const cameraModeBtn = document.getElementById("cameraModeBtn") as HTMLButtonElement;
const captureBtn = document.getElementById("captureBtn") as HTMLButtonElement;
const uploadSketchBtn = document.getElementById("uploadSketchBtn") as HTMLButtonElement;
const sketchFileInput = document.getElementById("sketchFileInput") as HTMLInputElement;
const resetViewBtn = document.getElementById("resetViewBtn") as HTMLButtonElement;
const scanCanvas = document.getElementById("scanCanvas") as HTMLCanvasElement;
const scanPreview = document.getElementById("scanPreview")!;
const scanStatus = document.getElementById("scanStatus")!;
const structureSummary = document.getElementById("structureSummary")!;
const validationStatus = document.getElementById("validationStatus")!;
const platformStatus = document.getElementById("platformStatus")!;
const mobileStatus = document.getElementById("mobileStatus")!;

let currentTemplate: PolymerTemplate = POLYMER_TEMPLATES[0];
let importedTemplate: PolymerTemplate | null = null;
let currentGraph: MolecularGraph | null = null;
let cameraStream: MediaStream | null = null;
let three: ThreeRuntime | null = null;

type StructureMode = "molecule" | "polymer";

interface BaseStructureExample {
  id: string;
  label: string;
  repeats: number;
  mode: StructureMode;
}

interface ImportStructureExample extends BaseStructureExample {
  kind: "import";
  format: StructureImportFormat;
  input: string;
}

interface TemplateStructureExample extends BaseStructureExample {
  kind: "template";
  templateId: string;
}

type StructureExample = ImportStructureExample | TemplateStructureExample;

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

const STRUCTURE_EXAMPLES: StructureExample[] = [...IMPORT_STRUCTURE_EXAMPLES, ...TEMPLATE_STRUCTURE_EXAMPLES];
let pendingExampleRepeatCount: number | null = null;

for (const template of POLYMER_TEMPLATES) {
  const option = document.createElement("option");
  option.value = template.id;
  option.textContent = `${template.shortName} - ${template.name}`;
  polymerSelect.appendChild(option);
}

const importedTemplateOption = document.createElement("option");
importedTemplateOption.value = IMPORTED_TEMPLATE_ID;
importedTemplateOption.textContent = "Imported structure";
importedTemplateOption.hidden = true;
polymerSelect.appendChild(importedTemplateOption);

const placeholderExample = document.createElement("option");
placeholderExample.value = "";
placeholderExample.textContent = "Choose example";
exampleStructureSelect.appendChild(placeholderExample);
for (const example of STRUCTURE_EXAMPLES) {
  const option = document.createElement("option");
  option.value = example.id;
  option.textContent = example.label;
  exampleStructureSelect.appendChild(option);
}

polymerSelect.value = currentTemplate.id;
repeatRange.value = String(currentTemplate.defaultRepeats);
repeatRange.max = String(currentTemplate.maxRepeats);

window.addEventListener("error", (event) => {
  setStatus(`Runtime error: ${event.message}`, true);
});

window.addEventListener("unhandledrejection", (event) => {
  setStatus(`Unhandled rejection: ${event.reason}`, true);
});

polymerModeToggle.addEventListener("change", () => {
  updateStructureModeUi();
  rebuildGraph();
  setStatus(isPolymerMode() ? "Polymer repeat-unit mode active." : "Molecule mode active.");
});

polymerSelect.addEventListener("change", () => {
  const template = getActiveTemplate(polymerSelect.value);
  repeatRange.value = String(template.defaultRepeats);
  rebuildGraph();
  setStatus(`Verification target: ${template.shortName}.`);
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

cameraModeBtn.addEventListener("click", () => {
  void startCameraMode();
});

captureBtn.addEventListener("click", captureSketchFrame);
uploadSketchBtn.addEventListener("click", () => sketchFileInput.click());
sketchFileInput.addEventListener("change", () => {
  void loadSketchImageFile();
});
resetViewBtn.addEventListener("click", resetView);

window.addEventListener("resize", () => {
  if (!three) return;
  three.camera.aspect = window.innerWidth / window.innerHeight;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(window.innerWidth, window.innerHeight);
  resetView();
});

function setStatus(message: string, important = false) {
  platformStatus.textContent = message;
  mobileStatus.textContent = message;
  scanStatus.textContent = message;
  if (important) mobileStatus.classList.add("is-warning");
  else mobileStatus.classList.remove("is-warning");
}

function setImportStatus(message: string) {
  importStatus.textContent = message;
}

function graphExample(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isPolymerMode() {
  return polymerModeToggle.checked;
}

function updateStructureModeUi() {
  const polymerMode = isPolymerMode();
  document.body.classList.toggle("polymer-mode", polymerMode);
  repeatRange.disabled = !polymerMode;
  updateAttachmentControls();
}

async function useSelectedExample() {
  const example = STRUCTURE_EXAMPLES.find((candidate) => candidate.id === exampleStructureSelect.value);
  if (!example) return;
  polymerModeToggle.checked = example.mode === "polymer";
  updateStructureModeUi();
  if (example.kind === "template") {
    const template = getTemplate(example.templateId);
    polymerSelect.value = template.id;
    repeatRange.value = String(clampRepeats(example.repeats, template.maxRepeats));
    pendingExampleRepeatCount = null;
    rebuildGraph();
    setImportStatus(`Loaded example: ${template.shortName} - ${template.name}.`);
    setStatus(`Verification target: ${template.shortName}.`);
    return;
  }

  structureFormat.value = example.format;
  structureInput.value = example.input;
  pendingExampleRepeatCount = example.repeats;
  setImportStatus(`Loading example: ${example.label}.`);
  await loadImportedStructure();
}

function getActiveTemplate(id: string): PolymerTemplate {
  if (id === IMPORTED_TEMPLATE_ID && importedTemplate) return importedTemplate;
  return getTemplate(id);
}

async function loadImportedStructure(): Promise<boolean> {
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
    importedTemplate = applyExampleRepeatCount(result.template);
    importedTemplateOption.hidden = false;
    importedTemplateOption.textContent = `${importedTemplate.shortName} - ${importedTemplate.name}`;
    polymerSelect.value = IMPORTED_TEMPLATE_ID;
    repeatRange.value = String(importedTemplate.defaultRepeats);
    rebuildGraph();
    const [importedMessage, ...importWarnings] = result.messages;
    const countsMessage = `${importedMessage} ${importedTemplate.atoms.length} atoms, ${importedTemplate.bonds.length} bonds.`;
    setImportStatus([...normalized.messages, countsMessage, ...importWarnings].join(" "));
    setStatus(`Verification target: imported ${result.detectedFormat.toUpperCase()} structure.`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setImportStatus(message);
    setStatus(`Import failed: ${message}`, true);
    return false;
  } finally {
    pendingExampleRepeatCount = null;
    loadStructureBtn.disabled = false;
  }
}

function clampRepeats(value: number, max: number) {
  return Math.min(max, Math.max(1, Math.round(value)));
}

function applyExampleRepeatCount(template: PolymerTemplate): PolymerTemplate {
  if (pendingExampleRepeatCount == null) return template;
  return {
    ...template,
    defaultRepeats: clampRepeats(pendingExampleRepeatCount, template.maxRepeats),
  };
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

function applyImportedAttachments() {
  if (!isPolymerMode() || !importedTemplate || polymerSelect.value !== IMPORTED_TEMPLATE_ID) return;
  try {
    importedTemplate = updateTemplateAttachments(importedTemplate, leftAttachmentSelect.value, rightAttachmentSelect.value);
    importedTemplateOption.textContent = `${importedTemplate.shortName} - ${importedTemplate.name}`;
    rebuildGraph();
    setImportStatus(`Connections: ${importedTemplate.connection.leftAtomId} -> ${importedTemplate.connection.rightAtomId}.`);
    setStatus("Updated repeat-unit attachment atoms.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setImportStatus(message);
    setStatus(message, true);
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

function rebuildGraph() {
  if (polymerSelect.value === IMPORTED_TEMPLATE_ID && !importedTemplate) {
    polymerSelect.value = POLYMER_TEMPLATES[0].id;
  }
  const activeTemplate = getActiveTemplate(polymerSelect.value);
  const mode = isPolymerMode() ? "polymer" : "molecule";
  // Real 3D conformer first (openchemlib); heuristic VSEPR layout as fallback.
  currentTemplate = templateTo3D(activeTemplate, { mode }) ?? cleanupTemplateGeometry(activeTemplate, { mode });
  repeatRange.max = String(currentTemplate.maxRepeats);
  if (Number(repeatRange.value) > currentTemplate.maxRepeats) {
    repeatRange.value = String(currentTemplate.maxRepeats);
  }

  const repeatCount = isPolymerMode() ? Number(repeatRange.value) : 1;
  repeatValue.textContent = String(repeatCount);
  currentGraph = generatePolymerGraph(currentTemplate, repeatCount);
  updateSummary();
  updateThreeGraph();
  renderFallbackGraph();
  updateAttachmentControls();
}

function updateThreeGraph() {
  if (!three || !currentGraph) return;
  three.moleculeRenderer.setGraph(currentGraph);
  three.moleculeRenderer.setLabelsVisible(labelsToggle.checked);
  three.moleculeRoot.visible = true;
  three.moleculeRoot.scale.setScalar(three.renderer.xr.isPresenting ? 0.18 : previewScale());
  if (!three.renderer.xr.isPresenting) {
    three.moleculeRoot.position.set(0, previewHeight(), 0);
    three.moleculeRoot.rotation.set(0, -0.3, 0);
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

function initThreeRuntime(): ThreeRuntime | null {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    appEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101211);

    const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.set(0, 2.6, 8.2);
    scene.add(camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.3, 0);
    controls.enableDamping = true;
    controls.minDistance = 2.2;
    controls.maxDistance = 22;

    const moleculeRoot = new THREE.Group();
    scene.add(moleculeRoot);

    const moleculeRenderer = new GraphMoleculeRenderer();
    moleculeRoot.add(moleculeRenderer.group);

    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.23, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x8fe3d0, transparent: true, opacity: 0.86 }),
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    const grid = new THREE.GridHelper(16, 16, 0x3e4640, 0x202421);
    grid.position.y = -1.25;
    scene.add(grid);

    scene.add(new THREE.HemisphereLight(0xf8f2e6, 0x25362f, 1.6));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(3, 4, 6);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x87d8c6, 35, 18);
    fillLight.position.set(-4, 2.4, -3);
    scene.add(fillLight);

    return {
      scene,
      camera,
      renderer,
      controls,
      moleculeRoot,
      moleculeRenderer,
      reticle,
      grid,
      arHitTestSource: null,
      arLocalSpace: null,
    };
  } catch (error) {
    console.error(error);
    document.body.classList.add("webgl-fallback");
    setStatus(`WebGL unavailable in this Safari tab: ${(error as Error).message}`, true);
    return null;
  }
}

function installArButton(runtime: ThreeRuntime) {
  const button = ARButton.createButton(runtime.renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "local-floor"],
    domOverlay: { root: document.body },
  } as any);
  button.id = "webxrArButton";
  arEntryEl.replaceChildren(button);

  const controller = runtime.renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    if (!runtime.reticle.visible) return;
    runtime.moleculeRoot.visible = true;
    runtime.moleculeRoot.position.setFromMatrixPosition(runtime.reticle.matrix);
    runtime.moleculeRoot.quaternion.setFromRotationMatrix(runtime.reticle.matrix);
    runtime.moleculeRoot.scale.setScalar(0.18);
  });
  runtime.scene.add(controller);

  runtime.renderer.xr.addEventListener("sessionstart", async () => {
    stopCameraMode();
    runtime.controls.enabled = false;
    runtime.grid.visible = false;
    runtime.scene.background = null;
    runtime.moleculeRoot.visible = false;
    setStatus("Move the phone to find a surface, then tap to place the structure.");

    const session = runtime.renderer.xr.getSession() as any;
    if (!session) return;

    try {
      const viewerSpace = await session.requestReferenceSpace("viewer");
      runtime.arHitTestSource = await session.requestHitTestSource?.({ space: viewerSpace });
    } catch {
      setStatus("AR session started without hit-test placement.", true);
    }
  });

  runtime.renderer.xr.addEventListener("sessionend", () => {
    runtime.arHitTestSource?.cancel?.();
    runtime.arHitTestSource = null;
    runtime.arLocalSpace = null;
    runtime.reticle.visible = false;
    runtime.controls.enabled = true;
    runtime.grid.visible = true;
    runtime.scene.background = new THREE.Color(0x101211);
    runtime.moleculeRoot.visible = true;
    resetView();
    updatePlatformStatus();
  });
}

function startRenderLoop(runtime: ThreeRuntime) {
  runtime.renderer.setAnimationLoop((_, xrFrame) => {
    runtime.controls.update();

    if (runtime.renderer.xr.isPresenting && xrFrame && runtime.arHitTestSource) {
      runtime.arLocalSpace ??= runtime.renderer.xr.getReferenceSpace();
      if (runtime.arLocalSpace) {
        const hits = xrFrame.getHitTestResults(runtime.arHitTestSource);
        if (hits.length > 0) {
          const pose = hits[0].getPose(runtime.arLocalSpace);
          if (pose) {
            runtime.reticle.visible = true;
            runtime.reticle.matrix.fromArray(pose.transform.matrix);
          }
        } else {
          runtime.reticle.visible = false;
        }
      }
    }

    if (!runtime.renderer.xr.isPresenting) {
      runtime.moleculeRoot.rotation.y += 0.0015;
    }

    runtime.renderer.render(runtime.scene, runtime.camera);
  });
}

function resetView() {
  if (!three || three.renderer.xr.isPresenting) return;
  const mobile = isPhoneViewport();
  three.controls.target.set(0, mobile ? 0.85 : 0.25, 0);
  three.camera.position.set(0, mobile ? 4.2 : 2.6, mobile ? 10.5 : 8.2);
  three.moleculeRoot.position.set(0, previewHeight(), 0);
  three.moleculeRoot.rotation.set(0, -0.3, 0);
  three.moleculeRoot.scale.setScalar(previewScale());
  three.controls.update();
}

function isPhoneViewport() {
  return window.innerWidth <= 520;
}

function previewHeight() {
  return isPhoneViewport() ? 2.8 : 0.2;
}

function previewScale() {
  return isPhoneViewport() ? 0.44 : 0.58;
}

async function startCameraMode() {
  if (cameraStream) {
    stopCameraMode();
    return;
  }

  cameraModeBtn.disabled = true;
  setStatus("Requesting camera permission...");

  try {
    cameraStream = await requestCameraStream();
    videoEl.srcObject = cameraStream;
    videoEl.muted = true;
    videoEl.setAttribute("playsinline", "true");
    await videoEl.play();

    document.body.classList.add("camera-active");
    fallbackEl.classList.add("camera-overlay");
    if (three) {
      three.scene.background = null;
      three.grid.visible = false;
    }
    cameraModeBtn.textContent = "Stop camera";
    captureBtn.disabled = false;
    setStatus("Camera overlay active. Capture your sketch, then verify the structure model.");
  } catch (error) {
    const message = cameraErrorMessage(error);
    setStatus(message, true);
    stopCameraMode();
  } finally {
    cameraModeBtn.disabled = false;
  }
}

async function requestCameraStream(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error("Camera needs a trusted HTTPS page. Use Brave, localhost, or a trusted tunnel for Safari.");
  }

  const constraints: MediaStreamConstraints = {
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };

  if (navigator.mediaDevices?.getUserMedia) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const name = (error as DOMException).name;
      if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") throw error;
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }

  const legacyNavigator = navigator as CameraNavigator;
  const legacyGetUserMedia = legacyNavigator.webkitGetUserMedia ?? legacyNavigator.mozGetUserMedia;
  if (!legacyGetUserMedia) {
    throw new Error("This browser did not expose getUserMedia camera access.");
  }

  return await new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(legacyNavigator, constraints, resolve, reject);
  });
}

function cameraErrorMessage(error: unknown) {
  const err = error as DOMException | Error;
  if ("name" in err && err.name === "NotAllowedError") {
    return "Camera permission was blocked. In Safari, allow Camera for this site and reload.";
  }
  if ("name" in err && err.name === "NotFoundError") {
    return "No camera was found for this browser tab.";
  }
  return `Camera unavailable: ${err.message || String(error)}`;
}

function stopCameraMode() {
  for (const track of cameraStream?.getTracks() ?? []) track.stop();
  cameraStream = null;
  videoEl.pause();
  videoEl.srcObject = null;
  document.body.classList.remove("camera-active");
  fallbackEl.classList.remove("camera-overlay");
  if (three) {
    three.scene.background = new THREE.Color(0x101211);
    three.grid.visible = true;
  }
  cameraModeBtn.textContent = "Camera AR";
  captureBtn.disabled = true;
}

function captureSketchFrame() {
  if (!cameraStream || videoEl.videoWidth === 0) {
    setStatus("Camera is not ready yet.", true);
    return;
  }
  const context = scanCanvas.getContext("2d")!;
  scanCanvas.width = videoEl.videoWidth;
  scanCanvas.height = videoEl.videoHeight;
  context.drawImage(videoEl, 0, 0, scanCanvas.width, scanCanvas.height);
  updateScanPreview();
  void runSketchRecognition("camera-capture");
}

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
    setStatus(`Could not read that image file: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  }

  updateScanPreview();
  await runSketchRecognition("image-upload");
}

function updateScanPreview() {
  scanPreview.style.backgroundImage = `url(${scanCanvas.toDataURL("image/jpeg", 0.82)})`;
  scanPreview.classList.add("has-capture");
}

async function runSketchRecognition(source: RecognitionSource) {
  const endpoint = aiRecognitionEndpoint();
  if (endpoint) {
    setStatus("AI recognition (Claude) in progress...");
    try {
      const ai = await recognizeSketchWithAI(scanCanvas, endpoint);
      polymerModeToggle.checked = ai.isRepeatUnit;
      updateStructureModeUi();
      structureFormat.value = "smiles";
      structureInput.value = ai.smiles;
      if (ai.isRepeatUnit && ai.repeatCount > 0) pendingExampleRepeatCount = ai.repeatCount;
      const imported = await loadImportedStructure();
      if (!imported) throw new Error(`the recognized SMILES "${ai.smiles}" did not import`);
      const notes = ai.notes.length > 0 ? ` ${ai.notes.join(" ")}` : "";
      setStatus(`AI recognition: ${ai.smiles} (confidence ${(ai.confidence * 100).toFixed(0)}%).${notes}`, ai.notes.length > 0);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`AI recognition unavailable (${message}) - trying on-device recognizer...`, true);
    }
  }

  setStatus("Recognizing sketch...");
  try {
    const recognized = await recognizeSketch(scanCanvas, source);
    polymerModeToggle.checked = recognized.polymer?.isRepeatUnit ?? false;
    updateStructureModeUi();
    structureFormat.value = "json";
    structureInput.value = recognizedStructureToImportJson(recognized);
    await loadImportedStructure();
    const confidence = `Recognition confidence ${(recognized.confidence * 100).toFixed(0)}%.`;
    setStatus([confidence, ...recognized.warnings].join(" "), recognized.warnings.length > 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Sketch recognition failed: ${message}`, true);
  }
}

function updatePlatformStatus() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const hasWebXr = "xr" in navigator;
  const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia || (navigator as CameraNavigator).webkitGetUserMedia);
  const webgl = three ? "WebGL ready" : "2D fallback";
  const secure = window.isSecureContext ? "trusted HTTPS" : "not trusted HTTPS";

  if (isIos) {
    setStatus(`iPhone Safari path: ${webgl}, camera ${hasCamera ? "available" : "unavailable"}, ${secure}.`);
  } else if (hasWebXr) {
    setStatus(`Android/compatible path: ${webgl}, WebXR available, ${secure}.`);
  } else {
    setStatus(`Preview path: ${webgl}, WebXR unavailable, ${secure}.`);
  }
}

function renderFallbackGraph() {
  if (!currentGraph) return;
  if (three && !document.body.classList.contains("webgl-fallback")) {
    fallbackEl.innerHTML = "";
    return;
  }

  const atoms = currentGraph.atoms;
  if (atoms.length === 0) return;
  const xs = atoms.map((atom) => atom.position[0]);
  const ys = atoms.map((atom) => atom.position[1] + atom.position[2] * 0.55);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));

  const project = (atom: GraphAtom) => {
    const x = 52 + ((atom.position[0] - minX) / width) * 696;
    const y = 210 - ((atom.position[1] + atom.position[2] * 0.55 - minY) / height) * 150;
    return { x, y };
  };

  const bondSvg = currentGraph.bonds
    .map((bond) => {
      const a = atomById.get(bond.a);
      const b = atomById.get(bond.b);
      if (!a || !b) return "";
      const start = project(a);
      const end = project(b);
      const color = bond.order === "aromatic" ? "#e6a23c" : "#d8d3c8";
      return drawFallbackBond(start, end, bond.order, color);
    })
    .join("");

  const atomSvg = atoms
    .map((atom) => {
      const point = project(atom);
      const color = `#${getElementInfo(atom.element).color.toString(16).padStart(6, "0")}`;
      const stroke = "rgba(255,255,255,0.54)";
      return `<g><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="13" fill="${color}" stroke="${stroke}" stroke-width="2"/><text x="${point.x.toFixed(1)}" y="${(point.y + 4).toFixed(1)}">${atom.element}</text></g>`;
    })
    .join("");

  fallbackEl.innerHTML = `
    <svg viewBox="0 0 800 260" role="img" aria-label="${currentTemplate.name} molecule fallback">
      <g>${bondSvg}</g>
      <g>${atomSvg}</g>
    </svg>
  `;
}

function drawFallbackBond(
  start: { x: number; y: number },
  end: { x: number; y: number },
  order: BondOrder,
  color: string,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * 5;
  const ny = (dx / length) * 5;
  const offsets = order === 2 ? [-1, 1] : order === 3 ? [-1.7, 0, 1.7] : [0];
  const width = order === "aromatic" ? 3 : 4;
  const lines = offsets
    .map((offset) => {
      const ox = nx * offset;
      const oy = ny * offset;
      return `<line x1="${(start.x + ox).toFixed(1)}" y1="${(start.y + oy).toFixed(1)}" x2="${(end.x + ox).toFixed(1)}" y2="${(end.y + oy).toFixed(1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    })
    .join("");

  if (order !== "aromatic") return lines;
  return `${lines}<line x1="${(start.x + nx * 1.1).toFixed(1)}" y1="${(start.y + ny * 1.1).toFixed(1)}" x2="${(end.x + nx * 1.1).toFixed(1)}" y2="${(end.y + ny * 1.1).toFixed(1)}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>`;
}

updateStructureModeUi();
rebuildGraph();
three = initThreeRuntime();

if (three) {
  document.body.classList.add("webgl-ready");
  updateThreeGraph();
  renderFallbackGraph();
  try {
    installArButton(three);
  } catch (error) {
    console.error(error);
    arEntryEl.innerHTML = '<button id="webxrArButton" type="button" disabled>WEBXR OFF</button>';
    setStatus(`WebXR button unavailable: ${(error as Error).message}`, true);
  }
  resetView();
  startRenderLoop(three);
} else {
  arEntryEl.innerHTML = '<button id="webxrArButton" type="button" disabled>2D FALLBACK</button>';
  renderFallbackGraph();
}

updatePlatformStatus();

// 3D conformer resources load in the background; structures render with the
// VSEPR layout immediately and upgrade to real conformers once ready.
void preloadConformerResources()
  .then(() => {
    rebuildGraph();
  })
  .catch((error) => {
    console.warn("Conformer resources unavailable; keeping VSEPR layout.", error);
  });

setImportStatus("Loading RDKit.js chemistry...");
void preloadRDKit()
  .then(({ version }) => {
    setImportStatus(`RDKit.js ${version} ready for SMILES and Molfile imports.`);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setImportStatus(`RDKit.js unavailable; lightweight parser fallback active. ${message}`);
  });
