import * as THREE from "three";
import { getElementInfo } from "./elements";
import type { BondOrder, GraphAtom, GraphBond, MolecularGraph } from "./polymerData";

const ATOM_SCALE = 0.38;
const BOND_RADIUS = 0.055;
// Double/triple rods are drawn slightly thinner and spaced center-to-center
// wider than two radii, leaving a clear ~0.03 gap so the parallel rods read
// as distinct rather than merging into one fat bond.
const MULTI_BOND_RADIUS = 0.046;
const MULTI_BOND_SPACING = 0.125;
// Offset of the aromatic accent rod (kept independent of the spacing above).
const AROMATIC_INNER_OFFSET = 0.086;
const HIGHLIGHT_COLOR = 0xffd166;
const HIGHLIGHT_EMISSIVE = 0x2b2108;

function graphPosition(atom: GraphAtom): THREE.Vector3 {
  return new THREE.Vector3(atom.position[0], atom.position[1], atom.position[2]);
}

function bondColor(order: BondOrder) {
  if (order === "aromatic") return 0xe6a23c;
  if (order === 2) return 0xd9edf2;
  if (order === 3) return 0x7fc7ff;
  return 0xd8d3c8;
}

function labelTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(13, 16, 15, 0.76)";
  context.strokeStyle = "rgba(255, 255, 255, 0.34)";
  context.lineWidth = 2;
  roundRect(context, 10, 10, 108, 42, 10);
  context.fill();
  context.stroke();
  context.fillStyle = "#f7f3e8";
  context.font = "600 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

export class GraphMoleculeRenderer {
  readonly group = new THREE.Group();

  private graph: MolecularGraph | null = null;
  private labels = new THREE.Group();
  private highlightedTemplateGroupId: string | null = null;
  private labelsVisible = true;
  private cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  // Geometry, material, and label-sprite resources are shared across atoms/bonds
  // and across rebuilds (the repeats slider rebuilds on every input event).
  private sphereGeometryBySymbol = new Map<string, THREE.SphereGeometry>();
  private atomMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private bondMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private spriteMaterials = new Map<string, THREE.SpriteMaterial>();

  constructor() {
    this.group.add(this.labels);
  }

  dispose() {
    this.clear();
    this.cylinderGeometry.dispose();
    for (const geometry of this.sphereGeometryBySymbol.values()) geometry.dispose();
    for (const material of this.atomMaterials.values()) material.dispose();
    for (const material of this.bondMaterials.values()) material.dispose();
    for (const material of this.spriteMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.sphereGeometryBySymbol.clear();
    this.atomMaterials.clear();
    this.bondMaterials.clear();
    this.spriteMaterials.clear();
  }

  setLabelsVisible(visible: boolean) {
    this.labelsVisible = visible;
    this.labels.visible = visible;
  }

  setHighlightedGroup(templateGroupId: string | null) {
    this.highlightedTemplateGroupId = templateGroupId;
    if (this.graph) this.rebuild();
  }

  setGraph(graph: MolecularGraph) {
    this.graph = graph;
    this.rebuild();
  }

  private rebuild() {
    if (!this.graph) return;
    this.clear();

    const highlightedAtoms = new Set<string>();
    const highlightedBonds = new Set<string>();
    if (this.highlightedTemplateGroupId) {
      for (const graphGroup of this.graph.groups) {
        if (graphGroup.templateGroupId !== this.highlightedTemplateGroupId) continue;
        for (const atomId of graphGroup.atomIds) highlightedAtoms.add(atomId);
        for (const bondId of graphGroup.bondIds) highlightedBonds.add(bondId);
      }
    }

    const atomById = new Map(this.graph.atoms.map((graphAtom) => [graphAtom.id, graphAtom]));
    for (const graphBond of this.graph.bonds) {
      const start = atomById.get(graphBond.a);
      const end = atomById.get(graphBond.b);
      if (!start || !end) continue;
      this.addBond(graphBond, graphPosition(start), graphPosition(end), highlightedBonds.has(graphBond.id));
    }

    for (const graphAtom of this.graph.atoms) {
      this.addAtom(graphAtom, highlightedAtoms.has(graphAtom.id));
    }

    this.center();
    this.labels.visible = this.labelsVisible;
  }

  private clear() {
    const keep = new Set<THREE.Object3D>([this.labels]);
    for (const child of [...this.group.children]) {
      if (!keep.has(child)) this.group.remove(child);
    }
    for (const child of [...this.labels.children]) this.labels.remove(child);
  }

  private atomMaterial(symbol: string, highlighted: boolean) {
    const key = `${symbol}|${highlighted}`;
    let material = this.atomMaterials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: highlighted ? HIGHLIGHT_COLOR : getElementInfo(symbol).color,
        roughness: 0.44,
        metalness: 0.04,
        emissive: highlighted ? HIGHLIGHT_EMISSIVE : 0x000000,
      });
      this.atomMaterials.set(key, material);
    }
    return material;
  }

  private bondMaterial(order: BondOrder, highlighted: boolean, inner = false) {
    const key = `${order}|${highlighted}|${inner}`;
    let material = this.bondMaterials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: highlighted ? HIGHLIGHT_COLOR : bondColor(order),
        roughness: 0.52,
        metalness: 0.03,
        emissive: highlighted ? HIGHLIGHT_EMISSIVE : 0x000000,
      });
      if (inner) {
        material.opacity = 0.78;
        material.transparent = true;
      }
      this.bondMaterials.set(key, material);
    }
    return material;
  }

  private spriteMaterial(text: string) {
    let material = this.spriteMaterials.get(text);
    if (!material) {
      material = new THREE.SpriteMaterial({
        map: labelTexture(text),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this.spriteMaterials.set(text, material);
    }
    return material;
  }

  private addAtom(graphAtom: GraphAtom, highlighted: boolean) {
    const info = getElementInfo(graphAtom.element);
    let geometry = this.sphereGeometryBySymbol.get(graphAtom.element);
    if (!geometry) {
      geometry = new THREE.SphereGeometry(info.radius * ATOM_SCALE, 24, 18);
      this.sphereGeometryBySymbol.set(graphAtom.element, geometry);
    }

    const mesh = new THREE.Mesh(geometry, this.atomMaterial(graphAtom.element, highlighted));
    mesh.position.fromArray(graphAtom.position);
    mesh.userData.atom = graphAtom;
    this.group.add(mesh);

    const sprite = new THREE.Sprite(this.spriteMaterial(graphAtom.element));
    sprite.position.set(graphAtom.position[0], graphAtom.position[1] + info.radius * ATOM_SCALE + 0.24, graphAtom.position[2]);
    sprite.scale.set(0.42, 0.21, 1);
    this.labels.add(sprite);
  }

  private addBond(graphBond: GraphBond, start: THREE.Vector3, end: THREE.Vector3, highlighted: boolean) {
    const material = this.bondMaterial(graphBond.order, highlighted);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length < 0.001) return;
    direction.normalize();

    const normal = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
    if (normal.lengthSq() < 0.0001) {
      normal.crossVectors(direction, new THREE.Vector3(0, 0, 1));
    }
    normal.normalize();

    const offsets = getBondOffsets(graphBond.order);
    const radius = bondRodRadius(graphBond.order);
    for (const offset of offsets) {
      const offsetVec = normal.clone().multiplyScalar(offset);
      this.addBondCylinder(start.clone().add(offsetVec), end.clone().add(offsetVec), radius, material, graphBond);
    }

    if (graphBond.order === "aromatic") {
      const innerMaterial = this.bondMaterial("aromatic", highlighted, true);
      const offsetVec = normal.clone().multiplyScalar(AROMATIC_INNER_OFFSET);
      this.addBondCylinder(start.clone().add(offsetVec), end.clone().add(offsetVec), BOND_RADIUS * 0.42, innerMaterial, graphBond);
    }
  }

  private addBondCylinder(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    graphBond: GraphBond,
  ) {
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    const mesh = new THREE.Mesh(this.cylinderGeometry, material);
    mesh.position.copy(midpoint);
    mesh.quaternion.copy(quaternion);
    mesh.scale.set(radius, length, radius);
    mesh.userData.bond = graphBond;
    this.group.add(mesh);
  }

  private center() {
    if (!this.graph?.atoms.length) return;
    const center = new THREE.Vector3();
    for (const graphAtom of this.graph.atoms) center.add(graphPosition(graphAtom));
    center.divideScalar(this.graph.atoms.length);
    this.group.position.set(-center.x, -center.y, -center.z);
  }
}

function getBondOffsets(order: BondOrder): number[] {
  if (order === 2) return [-MULTI_BOND_SPACING * 0.5, MULTI_BOND_SPACING * 0.5];
  if (order === 3) return [-MULTI_BOND_SPACING, 0, MULTI_BOND_SPACING];
  return [0];
}

function bondRodRadius(order: BondOrder): number {
  if (order === "aromatic") return BOND_RADIUS * 0.88;
  if (order === 2 || order === 3) return MULTI_BOND_RADIUS;
  return BOND_RADIUS;
}
