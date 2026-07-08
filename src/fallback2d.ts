import { getElementInfo } from "./elements";
import type { BondOrder, GraphAtom, MolecularGraph } from "./polymerData";

// 2D SVG rendering of the molecular graph for browsers without WebGL.
// When WebGL is active the container is simply kept empty.

export function renderFallbackGraph(
  container: HTMLElement,
  graph: MolecularGraph | null,
  structureName: string,
  webglActive: boolean,
) {
  if (!graph) return;
  if (webglActive) {
    if (container.innerHTML !== "") container.innerHTML = "";
    return;
  }

  const atoms = graph.atoms;
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

  const bondSvg = graph.bonds
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

  container.innerHTML = `
    <svg viewBox="0 0 800 260" role="img" aria-label="${structureName} molecule fallback">
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
