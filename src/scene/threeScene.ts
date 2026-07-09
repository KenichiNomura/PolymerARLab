import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GraphMoleculeRenderer } from "../graphMoleculeRenderer";

// Desktop/mobile 3D preview scene: renderer, camera, lights, grid, and the
// molecule root that WebXR (scene/webxr.ts) repositions during AR sessions.

export interface ThreeRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  moleculeRoot: THREE.Group;
  moleculeRenderer: GraphMoleculeRenderer;
  reticle: THREE.Mesh;
  grid: THREE.GridHelper;
  arHitTestSource: XRHitTestSource | null;
  arLocalSpace: XRReferenceSpace | null;
  // Active "grow out of the paper" tween after a WebXR tap-to-place; null when idle.
  arPlacement: ArPlacement | null;
}

export interface ArPlacement {
  startMs: number;
  durationMs: number;
  targetScale: number;
  seatY: number;
}

const BACKGROUND_COLOR = 0x101211;

export function initThreeRuntime(container: HTMLElement, onFailure: (message: string) => void): ThreeRuntime | null {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);

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
      arPlacement: null,
    };
  } catch (error) {
    console.error(error);
    document.body.classList.add("webgl-fallback");
    onFailure((error as Error).message);
    return null;
  }
}

export function startRenderLoop(runtime: ThreeRuntime) {
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

    if (runtime.renderer.xr.isPresenting) {
      applyPlacementAnimation(runtime, performance.now());
    } else {
      runtime.moleculeRoot.rotation.y += 0.0015;
    }

    runtime.renderer.render(runtime.scene, runtime.camera);
  });
}

// Eased 0..1 progress of the placement tween (ease-out cubic).
export function placementProgress(startMs: number, durationMs: number, now: number): number {
  const t = Math.min(1, Math.max(0, (now - startMs) / durationMs));
  return 1 - Math.pow(1 - t, 3);
}

// Grows the just-placed molecule out of the tapped surface: scale 0 -> target
// while lifting the last bit up off the page. Clears the tween when complete.
export function applyPlacementAnimation(runtime: ThreeRuntime, now: number) {
  const placement = runtime.arPlacement;
  if (!placement) return;
  const e = placementProgress(placement.startMs, placement.durationMs, now);
  runtime.moleculeRoot.scale.setScalar(Math.max(0.0001, placement.targetScale * e));
  // Start slightly sunk into the surface and rise to the seated height.
  runtime.moleculeRoot.position.y = placement.seatY - (1 - e) * 0.03;
  if (e >= 1) runtime.arPlacement = null;
}

// Places the molecule at the desktop/phone preview pose. Skipped while an
// AR session controls the molecule transform.
export function applyPreviewTransform(runtime: ThreeRuntime) {
  if (runtime.renderer.xr.isPresenting) return;
  runtime.moleculeRoot.position.set(0, previewHeight(), 0);
  runtime.moleculeRoot.rotation.set(0, -0.3, 0);
  runtime.moleculeRoot.scale.setScalar(previewScale());
}

export function resetView(runtime: ThreeRuntime) {
  if (runtime.renderer.xr.isPresenting) return;
  const mobile = isPhoneViewport();
  runtime.controls.target.set(0, mobile ? 0.85 : 0.25, 0);
  runtime.camera.position.set(0, mobile ? 4.2 : 2.6, mobile ? 10.5 : 8.2);
  applyPreviewTransform(runtime);
  runtime.controls.update();
}

export function handleResize(runtime: ThreeRuntime) {
  runtime.camera.aspect = window.innerWidth / window.innerHeight;
  runtime.camera.updateProjectionMatrix();
  runtime.renderer.setSize(window.innerWidth, window.innerHeight);
  resetView(runtime);
}

export function setBackgroundVisible(runtime: ThreeRuntime, visible: boolean) {
  runtime.scene.background = visible ? new THREE.Color(BACKGROUND_COLOR) : null;
  runtime.grid.visible = visible;
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
