import * as THREE from "three";
import { getElementInfo } from "./elements";
import type { GraphMoleculeRenderer } from "./graphMoleculeRenderer";
import type { ByproductSite, MolecularGraph } from "./polymerData";

// Animated condensation byproducts: one small H2O glyph per formed link bond,
// spawned at the bond midpoint and drifting a short way off the chain where it
// lingers. The glyphs live in their own group (a sibling of the molecule
// renderer's group under moleculeRoot), so USDZ/LAMMPS exports — which read the
// renderer group / the graph — never see them.

const DRIFT_DURATION_MS = 1400;
const DRIFT_DISTANCE = 1.6;
const WATER_ATOM_SCALE = 0.26; // smaller than the chain's 0.38 so waters read as leaving
const OH_BOND_LENGTH = 0.96;
const HOH_HALF_ANGLE = (104.5 / 2 / 180) * Math.PI;
const ROD_RADIUS = 0.035;

interface ActiveWater {
  object: THREE.Group;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  /** Tween start; null once the water is resting. */
  startMs: number | null;
}

export class ByproductAnimator {
  readonly group = new THREE.Group();

  private waters = new Map<string, ActiveWater>();
  private glyph: THREE.Group;
  private sphereO: THREE.SphereGeometry;
  private sphereH: THREE.SphereGeometry;
  private cylinder: THREE.CylinderGeometry;
  private materialO: THREE.MeshStandardMaterial;
  private materialH: THREE.MeshStandardMaterial;
  private materialRod: THREE.MeshStandardMaterial;
  private reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor() {
    this.sphereO = new THREE.SphereGeometry(getElementInfo("O").radius * WATER_ATOM_SCALE, 20, 14);
    this.sphereH = new THREE.SphereGeometry(getElementInfo("H").radius * WATER_ATOM_SCALE, 16, 12);
    this.cylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    this.materialO = new THREE.MeshStandardMaterial({ color: getElementInfo("O").color, roughness: 0.44, metalness: 0.04 });
    this.materialH = new THREE.MeshStandardMaterial({ color: getElementInfo("H").color, roughness: 0.44, metalness: 0.04 });
    this.materialRod = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.52, metalness: 0.03 });
    this.glyph = this.buildGlyph();
  }

  // Reconcile the on-screen waters with the graph's byproduct sites. Sites are
  // keyed by stable ids, so growing the repeat slider animates only the newly
  // formed links while earlier waters stay resting; shrinking removes theirs.
  sync(graph: MolecularGraph | null, renderer: GraphMoleculeRenderer) {
    // Match the renderer's centering offset so spawn points line up with bonds.
    this.group.position.copy(renderer.group.position);

    const sites = graph?.byproducts ?? [];
    const siteIds = new Set(sites.map((site) => site.id));
    for (const [id, water] of [...this.waters]) {
      if (!siteIds.has(id)) {
        this.group.remove(water.object);
        this.waters.delete(id);
      }
    }
    if (!graph || sites.length === 0) return;

    const atomById = new Map(graph.atoms.map((graphAtom) => [graphAtom.id, graphAtom]));
    const now = performance.now();

    for (const site of sites) {
      const a = atomById.get(site.atomA);
      const b = atomById.get(site.atomB);
      if (!a || !b) continue;
      const origin = new THREE.Vector3(
        (a.position[0] + b.position[0]) / 2,
        (a.position[1] + b.position[1]) / 2,
        (a.position[2] + b.position[2]) / 2,
      );
      const target = origin.clone().add(driftDirection(site, origin).multiplyScalar(DRIFT_DISTANCE));

      const existing = this.waters.get(site.id);
      if (existing) {
        // Geometry may have shifted (e.g. hydrogens toggled); re-seat in place.
        existing.origin.copy(origin);
        existing.target.copy(target);
        if (existing.startMs == null) existing.object.position.copy(target);
        continue;
      }

      const object = this.glyph.clone();
      object.rotation.set(hash01(site.id) * Math.PI, hash01(`${site.id}y`) * Math.PI * 2, 0);
      const animate = !this.reducedMotion;
      object.position.copy(animate ? origin : target);
      if (animate) object.scale.setScalar(0.2);
      this.group.add(object);
      this.waters.set(site.id, { object, origin, target, startMs: animate ? now : null });
    }
  }

  // Per-frame tween (ease-out cubic, like the WebXR placement animation).
  update(now: number) {
    for (const water of this.waters.values()) {
      if (water.startMs == null) continue;
      const t = Math.min(1, Math.max(0, (now - water.startMs) / DRIFT_DURATION_MS));
      const e = 1 - Math.pow(1 - t, 3);
      water.object.position.lerpVectors(water.origin, water.target, e);
      water.object.scale.setScalar(0.2 + 0.8 * e);
      if (t >= 1) water.startMs = null;
    }
  }

  dispose() {
    for (const water of this.waters.values()) this.group.remove(water.object);
    this.waters.clear();
    this.sphereO.dispose();
    this.sphereH.dispose();
    this.cylinder.dispose();
    this.materialO.dispose();
    this.materialH.dispose();
    this.materialRod.dispose();
  }

  // Bent H2O: O at the origin, two H at the water angle, thin rods between.
  // Geometry and materials are shared; clones reuse them.
  private buildGlyph(): THREE.Group {
    const glyph = new THREE.Group();
    glyph.add(new THREE.Mesh(this.sphereO, this.materialO));
    for (const side of [-1, 1] as const) {
      const hPosition = new THREE.Vector3(
        Math.sin(HOH_HALF_ANGLE) * side * OH_BOND_LENGTH,
        -Math.cos(HOH_HALF_ANGLE) * OH_BOND_LENGTH,
        0,
      );
      const h = new THREE.Mesh(this.sphereH, this.materialH);
      h.position.copy(hPosition);
      glyph.add(h);

      const rod = new THREE.Mesh(this.cylinder, this.materialRod);
      rod.position.copy(hPosition.clone().multiplyScalar(0.5));
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hPosition.clone().normalize());
      rod.scale.set(ROD_RADIUS, OH_BOND_LENGTH, ROD_RADIUS);
      glyph.add(rod);
    }
    return glyph;
  }
}

// Deterministic drift away from the chain: mostly perpendicular to the +x
// backbone axis, seeded by the site id so each water picks a distinct, stable
// direction (rebuilds do not reshuffle them).
function driftDirection(site: ByproductSite, origin: THREE.Vector3): THREE.Vector3 {
  const radial = new THREE.Vector3(0, origin.y, origin.z);
  const angle = hash01(site.id) * Math.PI * 2;
  const swirl = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
  const direction = radial.lengthSq() > 0.04 ? radial.normalize().multiplyScalar(0.7).add(swirl.multiplyScalar(0.3)) : swirl;
  direction.x += (hash01(`${site.id}x`) - 0.5) * 0.4; // slight scatter along the chain
  return direction.normalize();
}

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
