import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { showStatus } from "../ui/status";
import { resetView, setBackgroundVisible, type ThreeRuntime } from "./threeScene";

// Android WebXR path: immersive AR session with hit-test tap-to-place.
// (iPhone Safari has no WebXR; it uses the USDZ Quick Look path instead.)

export interface WebXRHooks {
  onSessionStart: () => void;
  onSessionEnd: () => void;
}

export function installWebXR(runtime: ThreeRuntime, arEntryEl: HTMLElement, hooks: WebXRHooks) {
  const button = ARButton.createButton(runtime.renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "local-floor"],
    domOverlay: { root: document.body },
  } as any);
  button.id = "webxrArButton";
  arEntryEl.replaceChildren(button);

  let placedOnce = false;
  const controller = runtime.renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    if (!runtime.reticle.visible) return;
    runtime.moleculeRoot.visible = true;
    runtime.moleculeRoot.position.setFromMatrixPosition(runtime.reticle.matrix);
    runtime.moleculeRoot.quaternion.setFromRotationMatrix(runtime.reticle.matrix);
    runtime.moleculeRoot.scale.setScalar(0.18);
    if (!placedOnce) {
      placedOnce = true;
      showStatus("Tap again anywhere to move it.");
    }
  });
  runtime.scene.add(controller);

  runtime.renderer.xr.addEventListener("sessionstart", async () => {
    hooks.onSessionStart();
    runtime.controls.enabled = false;
    setBackgroundVisible(runtime, false);
    runtime.moleculeRoot.visible = false;
    showStatus("Aim at your Lewis-structure paper on the desk, then tap to place the molecule.");

    const session = runtime.renderer.xr.getSession();
    if (!session) return;

    try {
      const viewerSpace = await session.requestReferenceSpace("viewer");
      runtime.arHitTestSource = (await session.requestHitTestSource?.({ space: viewerSpace })) ?? null;
    } catch {
      showStatus("AR session started without hit-test placement.", true);
    }
  });

  runtime.renderer.xr.addEventListener("sessionend", () => {
    runtime.arHitTestSource?.cancel?.();
    runtime.arHitTestSource = null;
    runtime.arLocalSpace = null;
    runtime.reticle.visible = false;
    runtime.controls.enabled = true;
    setBackgroundVisible(runtime, true);
    runtime.moleculeRoot.visible = true;
    resetView(runtime);
    hooks.onSessionEnd();
  });
}
