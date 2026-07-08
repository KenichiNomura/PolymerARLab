import * as THREE from "three";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";

// Export the current molecule as a USDZ file for Apple AR Quick Look —
// iPhone Safari has no WebXR, so this is the native-AR path on iOS: the
// exported model anchors to real surfaces in Apple's built-in viewer.

// USDZ units are meters; scale the molecule to sit desk-sized on the floor.
const TARGET_SIZE_METERS = 0.3;

export async function moleculeGroupToUSDZ(source: THREE.Object3D): Promise<Blob> {
  const clone = source.clone(true);

  // Labels are sprites, which USDZ cannot represent; drop them explicitly.
  const sprites: THREE.Object3D[] = [];
  clone.traverse((object) => {
    if ((object as THREE.Sprite).isSprite) sprites.push(object);
  });
  for (const sprite of sprites) sprite.parent?.remove(sprite);

  const holder = new THREE.Group();
  holder.add(clone);

  const bounds = new THREE.Box3().setFromObject(clone);
  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  holder.scale.setScalar(TARGET_SIZE_METERS / maxDimension);
  holder.updateMatrixWorld(true);

  // Quick Look places the model origin on the detected surface.
  const scaled = new THREE.Box3().setFromObject(holder);
  holder.position.y = -scaled.min.y;

  const scene = new THREE.Scene();
  scene.add(holder);
  scene.updateMatrixWorld(true);

  const exporter = new USDZExporter();
  const data = await exporter.parseAsync(scene, { quickLookCompatible: true });
  return new Blob([data], { type: "model/vnd.usdz+zip" });
}

export function isIOSDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Safari requires an <img> child inside a rel="ar" anchor to trigger Quick
// Look; on other platforms the same anchor downloads the .usdz file.
export function openUSDZ(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.rel = "ar";
  anchor.href = url;
  if (!isIOSDevice()) anchor.download = fileName;
  anchor.appendChild(document.createElement("img"));
  document.body.appendChild(anchor);
  anchor.click();
  // Quick Look loads the URL asynchronously; keep it alive briefly.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 60_000);
}
