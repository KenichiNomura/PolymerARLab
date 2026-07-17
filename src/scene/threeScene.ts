import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ByproductAnimator } from "../byproductAnimation";
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
  byproductAnimator: ByproductAnimator;
  reticle: THREE.Mesh;
  grid: THREE.GridHelper;
  arHitTestSource: XRHitTestSource | null;
  arLocalSpace: XRReferenceSpace | null;
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

    // Byproduct waters render alongside the molecule but outside its renderer
    // group, so USDZ export (which clones moleculeRenderer.group) excludes them.
    const byproductAnimator = new ByproductAnimator();
    moleculeRoot.add(byproductAnimator.group);

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
      byproductAnimator,
      reticle,
      grid,
      arHitTestSource: null,
      arLocalSpace: null,
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

    if (!runtime.renderer.xr.isPresenting) {
      runtime.moleculeRoot.rotation.y += 0.0015;
    }

    // Drives the condensation H2O release tweens in both preview and AR.
    runtime.byproductAnimator.update(performance.now());

    runtime.renderer.render(runtime.scene, runtime.camera);
  });
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
