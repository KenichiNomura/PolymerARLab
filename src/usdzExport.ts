import * as THREE from "three";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";

// Export the current molecule as a USDZ file for Apple AR Quick Look —
// iPhone Safari has no WebXR, so this is the native-AR path on iOS: the
// exported model anchors to real surfaces in Apple's built-in viewer.

// USDZ units are meters; scale the molecule to sit desk-sized on the floor.
const TARGET_SIZE_METERS = 0.3;

export async function buildMoleculeUSDZ(source: THREE.Object3D): Promise<Blob> {
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
// Look, and the click must run synchronously inside a fresh user tap —
// otherwise iOS opens the blob as a blank page instead of launching AR.
// Callers therefore build the blob first and invoke this from a later tap.
//
// Repeat launches have two further Safari quirks: an anchor that is created
// and removed per click only works once, and a blob URL that Quick Look has
// already consumed may not reopen. So one persistent anchor lives in the DOM
// and every open mints a fresh object URL.
let arAnchor: HTMLAnchorElement | null = null;
let lastObjectUrl: string | null = null;

function persistentAnchor(): HTMLAnchorElement {
  if (!arAnchor || !arAnchor.isConnected) {
    arAnchor = document.createElement("a");
    arAnchor.rel = "ar";
    arAnchor.style.display = "none";
    arAnchor.appendChild(document.createElement("img"));
    document.body.appendChild(arAnchor);
  }
  return arAnchor;
}

export function openUSDZBlob(blob: Blob, fileName: string) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  const url = URL.createObjectURL(blob);
  lastObjectUrl = url;

  const anchor = persistentAnchor();
  anchor.href = url;
  if (isIOSDevice()) anchor.removeAttribute("download");
  else anchor.download = fileName;
  anchor.click();
}
