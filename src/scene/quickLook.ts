import type * as THREE from "three";
import type { MolecularGraph } from "../polymerData";
import { isIOSDevice } from "../platform";
import { showStatus } from "../ui/status";
import { buildMoleculeUSDZ, openUSDZBlob } from "../usdzExport";

// AR Quick Look pipeline. Safari only launches Quick Look when the rel="ar"
// click stays inside a fresh user tap, so the USDZ is prepared in the
// background whenever the structure settles: the common case is a single
// tap that opens synchronously. A tap that lands before the model is ready
// builds on demand; iOS then needs one more tap (desktop just downloads).

export interface QuickLookOptions {
  button: HTMLButtonElement;
  getGroup: () => THREE.Object3D | null;
  getGraph: () => MolecularGraph | null;
  getFileName: (graph: MolecularGraph) => string;
}

// The button is an icon; its readiness shows as a tooltip + accent class
// rather than swapped text (which would erase the SVG).
const IDLE_LABEL = "AR Quick Look";
const READY_LABEL = "Open AR view";
const PREPARE_DEBOUNCE_MS = 400;

export function createQuickLook(options: QuickLookOptions) {
  let prepared: { blob: Blob; fileName: string; graph: MolecularGraph } | null = null;
  let preparePromise: Promise<void> | null = null;
  let prepareTimer: number | undefined;

  function scheduleRefresh() {
    prepared = null;
    options.button.title = IDLE_LABEL;
    options.button.classList.remove("is-ready");
    window.clearTimeout(prepareTimer);
    prepareTimer = window.setTimeout(() => void prepare(), PREPARE_DEBOUNCE_MS);
  }

  function prepare(): Promise<void> {
    if (preparePromise) return preparePromise;
    const group = options.getGroup();
    const graph = options.getGraph();
    if (!group || !graph) return Promise.resolve();

    preparePromise = buildMoleculeUSDZ(group)
      .then((blob) => {
        if (graph === options.getGraph()) {
          prepared = { blob, fileName: options.getFileName(graph), graph };
          options.button.title = READY_LABEL;
          options.button.classList.add("is-ready");
        }
      })
      .catch((error) => {
        console.warn("Background USDZ prepare failed; the button will retry on tap.", error);
      })
      .finally(() => {
        preparePromise = null;
        // The structure changed while this build ran; prepare the new one.
        const current = options.getGraph();
        if (current && current !== graph) void prepare();
      });
    return preparePromise;
  }

  async function handleTap() {
    const graph = options.getGraph();
    if (!options.getGroup() || !graph) {
      showStatus("The 3D scene is not available for AR export in this browser.", true);
      return;
    }

    if (prepared?.graph === graph) {
      openUSDZBlob(prepared.blob, prepared.fileName);
      showStatus(
        isIOSDevice()
          ? "Opening AR Quick Look - move the phone to find a surface, then tap to place."
          : "USDZ file saved. AirDrop or send it to an iPhone and open it for native AR.",
      );
      return;
    }

    options.button.disabled = true;
    showStatus("Building USDZ model...");
    try {
      await prepare();
      if (prepared?.graph !== options.getGraph()) {
        showStatus("USDZ export failed - try the AR button again.", true);
        return;
      }
      if (isIOSDevice()) {
        // Opening now would fall outside this tap's user activation and
        // show a blank page instead of Quick Look; the button is now marked
        // ready and the next tap opens instantly.
        showStatus("AR model ready - tap the AR button again to place it on a surface.");
      } else {
        openUSDZBlob(prepared.blob, prepared.fileName);
        showStatus("USDZ file saved. AirDrop or send it to an iPhone and open it for native AR.");
      }
    } finally {
      options.button.disabled = false;
    }
  }

  return { scheduleRefresh, handleTap };
}
