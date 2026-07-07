import type { AtomSymbol, BondOrder } from "./polymerData";
import type { RecognitionSource, RecognizedAtom, RecognizedBond, RecognizedStructure } from "./scannerContract";

// Browser-side recognizer for clean black-marker Lewis structures on light
// paper. Classical computer vision only (no model download): binarize the
// image, split ink into letter blobs and bond strokes, classify letters
// against font-rendered templates, group parallel strokes into bond orders,
// and assemble the scanner-contract graph.
//
// Known v1 limits (documented in docs/handwritten-scanner-contract.md):
// - a standalone letter I is indistinguishable from a vertical bond stroke;
// - bonds must not touch the atom letters;
// - aromatic ring circles and polymer brackets are not detected yet.

interface Point {
  x: number;
  y: number;
}

interface InkComponent {
  pixels: Int32Array;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  majorLength: number;
  minorLength: number;
  elongation: number;
  angle: number;
  endpoints: [Point, Point];
  holes: number;
}

interface Segment {
  start: Point;
  end: Point;
  length: number;
  angle: number;
  thickness: number;
}

interface Glyph {
  component: InkComponent;
  char: string;
  score: number;
  alternates?: Array<{ char: string; score: number }>;
}

interface AtomLabel {
  id: string;
  element: AtomSymbol;
  center: Point;
  radius: number;
  confidence: number;
  implicit: boolean;
}

const GLYPH_CHARS = ["C", "H", "O", "N", "S", "P", "F", "I", "B", "l", "r"] as const;
const TEMPLATE_FONTS = ["Arial", "Verdana", "Trebuchet MS", "Times New Roman", "Courier New"];
const TEMPLATE_ROTATIONS = [-0.14, 0, 0.14];
const GRID = 24;
const MIN_COMPONENT_AREA = 12;
const LINE_ELONGATION = 3.4;
const MIN_LINE_LENGTH = 16;

export function recognizeSketchImage(image: ImageData, source: RecognitionSource): RecognizedStructure {
  const warnings: string[] = [];
  const mask = binarize(image);
  const components = findComponents(mask, image.width, image.height).filter(
    (component) => component.area >= MIN_COMPONENT_AREA,
  );

  if (components.length === 0) {
    throw new Error(
      "No ink was found in the capture. Use a dark marker on light paper, fill the frame with the sketch, and avoid shadows.",
    );
  }

  const { letterComponents, lineComponents, bentStrokes, ignored } = splitComponents(components);
  if (ignored > 0) {
    warnings.push(`${ignored} stroke${ignored === 1 ? " was" : "s were"} too complex to interpret and ${ignored === 1 ? "was" : "were"} skipped.`);
  }

  let glyphs = letterComponents.map((component) => classifyGlyph(component, mask, image.width));
  const { adopted, remainingLines } = adoptLowercaseStems(glyphs, lineComponents);

  // Letters are often drawn with strokes that do not touch (an H as a bar
  // plus a t-shape). Merge nearby parts when the combined shape reads as a
  // letter more convincingly than any part does alone.
  const merged = mergeMultiStrokeGlyphs(glyphs, remainingLines, mask, image.width);
  glyphs = [...merged.glyphs, ...adopted];

  // Connected strokes (bonds meeting at a vertex, zigzag chains) form blobs
  // that classify poorly as letters; decompose those into line segments.
  // Guard: sloppy handwriting also scores low, so a blob comparable in size
  // to confidently recognized letters stays a letter no matter its score.
  const confidentSizes = glyphs.filter((glyph) => glyph.score >= 0.6).map(glyphSize);
  const letterSize = median(confidentSizes);
  const strokeBlobs = glyphs.filter(
    (glyph) =>
      glyph.score < 0.5 &&
      glyph.component.holes === 0 &&
      glyphSize(glyph) >= MIN_LINE_LENGTH * 1.5 &&
      (confidentSizes.length === 0 || glyphSize(glyph) > letterSize * 1.7),
  );
  glyphs = glyphs.filter((glyph) => !strokeBlobs.includes(glyph));
  const decomposedSegments = [...strokeBlobs.map((glyph) => glyph.component), ...bentStrokes].flatMap(
    (component) => decomposeStroke(component, image.width, image.height),
  );

  const labels = buildAtomLabels(glyphs, warnings);
  const segments = [...merged.lines.map(componentToSegment), ...decomposedSegments];
  const bondGroups = groupParallelSegments(segments);

  const { atoms, bonds } = assembleGraph(labels, bondGroups, warnings);

  if (atoms.length === 0) {
    throw new Error(
      "No atom labels were recognized. Write element symbols in clear block capitals (C, H, O, N, S, P, F, Cl, Br, I) and leave a small gap between letters and bond lines.",
    );
  }

  const atomConfidence = average(atoms.map((atom) => atom.confidence));
  const bondConfidence = bonds.length > 0 ? average(bonds.map((bond) => bond.confidence)) : 1;
  return {
    source,
    name: "Scanned structure",
    atoms,
    bonds,
    confidence: Math.min(atomConfidence, bondConfidence),
    warnings,
  };
}

// Exposed for diagnostics and threshold tuning (see scratch test harnesses).
export function debugSketchAnalysis(image: ImageData) {
  const mask = binarize(image);
  const components = findComponents(mask, image.width, image.height).filter(
    (component) => component.area >= MIN_COMPONENT_AREA,
  );
  const { letterComponents, lineComponents, bentStrokes, ignored } = splitComponents(components);
  const glyphs = letterComponents.map((component) => classifyGlyph(component, mask, image.width));
  return {
    inkPixels: mask.reduce((sum, value) => sum + value, 0),
    components: components.map((component) => ({
      bbox: [component.minX, component.minY, component.maxX, component.maxY],
      area: component.area,
      elongation: Number(component.elongation.toFixed(2)),
      majorLength: Number(component.majorLength.toFixed(1)),
      minorLength: Number(component.minorLength.toFixed(1)),
      holes: component.holes,
    })),
    glyphs: glyphs.map((glyph) => ({
      char: glyph.char,
      score: Number(glyph.score.toFixed(3)),
      bbox: [glyph.component.minX, glyph.component.minY, glyph.component.maxX, glyph.component.maxY],
      holes: glyph.component.holes,
      alternates: glyph.alternates,
    })),
    merged: mergeMultiStrokeGlyphs(glyphs, lineComponents, mask, image.width).glyphs.map((glyph) => ({
      char: glyph.char,
      score: Number(glyph.score.toFixed(3)),
      bbox: [glyph.component.minX, glyph.component.minY, glyph.component.maxX, glyph.component.maxY],
      alternates: glyph.alternates,
    })),
    lineCount: lineComponents.length,
    bentCount: bentStrokes.length,
    ignored,
  };
}

// --- Binarization ---

// Bradley-style adaptive threshold: compare each pixel against its local
// neighborhood mean so paper texture, shadows, and lighting gradients do not
// read as ink the way a global Otsu split can. A closing pass afterwards
// heals thin ballpoint strokes that the camera breaks into dashes.
function binarize(image: ImageData): Uint8Array {
  const { data, width, height } = image;
  const size = width * height;
  const gray = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    const offset = index * 4;
    gray[index] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
  }

  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }

  const half = Math.max(8, Math.round(Math.max(width, height) / 16));
  const mask = new Uint8Array(size);
  let inkCount = 0;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + x1 + 1] -
        integral[y0 * (width + 1) + x1 + 1] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      const mean = sum / count;
      const value = gray[y * width + x];
      if (value < mean * 0.86 && mean - value > 10) {
        mask[y * width + x] = 1;
        inkCount += 1;
      }
    }
  }

  // Mostly-dark frames are not paper sketches; treat as blank.
  if (inkCount > size * 0.35) return new Uint8Array(size);
  return closeMask(mask, width, height);
}

// Morphological closing (dilate then erode, radius 1) to reconnect strokes.
function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) dilated[ny * width + nx] = 1;
        }
      }
    }
  }
  const closed = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (dilated[y * width + x] === 0) continue;
      let keep = true;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1 && keep; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || dilated[ny * width + nx] === 0) keep = false;
        }
      }
      if (keep) closed[y * width + x] = 1;
    }
  }
  return closed;
}

// --- Connected components and shape features ---

function findComponents(mask: Uint8Array, width: number, height: number): InkComponent[] {
  const visited = new Uint8Array(mask.length);
  const components: InkComponent[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue;
    const pixels: number[] = [];
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;

    while (stack.length > 0) {
      const index = stack.pop()!;
      pixels.push(index);
      const x = index % width;
      const y = (index / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (mask[neighbor] === 1 && visited[neighbor] === 0) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
        }
      }
    }

    components.push(buildComponent(new Int32Array(pixels), mask, width));
  }
  return components;
}

function buildComponent(pixels: Int32Array, mask: Uint8Array, width: number): InkComponent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;

  for (const index of pixels) {
    const x = index % width;
    const y = (index / width) | 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }

  const area = pixels.length;
  const cx = sumX / area;
  const cy = sumY / area;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const index of pixels) {
    const dx = (index % width) - cx;
    const dy = ((index / width) | 0) - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= area;
  syy /= area;
  sxy /= area;

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = Math.max(1e-6, trace / 2 - disc);
  const angle = Math.abs(sxy) < 1e-6 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(lambda1 - sxx, sxy);

  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  let minProj = Infinity;
  let maxProj = -Infinity;
  let startPoint: Point = { x: cx, y: cy };
  let endPoint: Point = { x: cx, y: cy };
  for (const index of pixels) {
    const x = index % width;
    const y = (index / width) | 0;
    const projection = (x - cx) * axisX + (y - cy) * axisY;
    if (projection < minProj) {
      minProj = projection;
      startPoint = { x, y };
    }
    if (projection > maxProj) {
      maxProj = projection;
      endPoint = { x, y };
    }
  }

  return {
    pixels,
    area,
    minX,
    minY,
    maxX,
    maxY,
    cx,
    cy,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    majorLength: maxProj - minProj,
    minorLength: Math.sqrt(lambda2) * 4,
    elongation: Math.sqrt(lambda1 / lambda2),
    angle,
    endpoints: [startPoint, endPoint],
    holes: countHoles(pixels, minX, minY, maxX, maxY, width),
  };
}

function countHoles(pixels: Int32Array, minX: number, minY: number, maxX: number, maxY: number, width: number): number {
  const boxWidth = maxX - minX + 3;
  const boxHeight = maxY - minY + 3;
  const grid = new Uint8Array(boxWidth * boxHeight);
  for (const index of pixels) {
    const x = (index % width) - minX + 1;
    const y = ((index / width) | 0) - minY + 1;
    grid[y * boxWidth + x] = 1;
  }

  // Flood-fill background from the border (4-connected); leftover background
  // regions are enclosed holes.
  const visited = new Uint8Array(grid.length);
  const stack: number[] = [];
  const pushIfBackground = (index: number) => {
    if (grid[index] === 0 && visited[index] === 0) {
      visited[index] = 1;
      stack.push(index);
    }
  };
  for (let x = 0; x < boxWidth; x++) {
    pushIfBackground(x);
    pushIfBackground((boxHeight - 1) * boxWidth + x);
  }
  for (let y = 0; y < boxHeight; y++) {
    pushIfBackground(y * boxWidth);
    pushIfBackground(y * boxWidth + boxWidth - 1);
  }
  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % boxWidth;
    const y = (index / boxWidth) | 0;
    if (x > 0) pushIfBackground(index - 1);
    if (x < boxWidth - 1) pushIfBackground(index + 1);
    if (y > 0) pushIfBackground(index - boxWidth);
    if (y < boxHeight - 1) pushIfBackground(index + boxWidth);
  }

  let holes = 0;
  for (let index = 0; index < grid.length; index++) {
    if (grid[index] === 0 && visited[index] === 0) {
      let holeArea = 0;
      visited[index] = 1;
      stack.push(index);
      while (stack.length > 0) {
        const current = stack.pop()!;
        holeArea += 1;
        const x = current % boxWidth;
        const y = (current / boxWidth) | 0;
        if (x > 0) pushIfBackground(current - 1);
        if (x < boxWidth - 1) pushIfBackground(current + 1);
        if (y > 0) pushIfBackground(current - boxWidth);
        if (y < boxHeight - 1) pushIfBackground(current + boxWidth);
      }
      if (holeArea >= 4) holes += 1;
    }
  }
  return holes;
}

// --- Letter / line separation ---

function splitComponents(components: InkComponent[]) {
  const letterComponents: InkComponent[] = [];
  const lineComponents: InkComponent[] = [];
  const bentStrokes: InkComponent[] = [];
  let ignored = 0;

  for (const component of components) {
    const lineLike = component.holes === 0 && component.elongation >= LINE_ELONGATION && component.majorLength >= MIN_LINE_LENGTH;
    if (lineLike) {
      // A zigzag drawn in one stroke is elongated overall but not straight:
      // its perpendicular spread far exceeds the stroke thickness.
      const thickness = component.area / Math.max(component.majorLength, 1);
      const straight = component.minorLength <= Math.max(8, thickness * 2.2);
      if (straight) lineComponents.push(component);
      else bentStrokes.push(component);
      continue;
    }
    const tooSmall = component.width < 6 && component.height < 6;
    if (tooSmall) {
      ignored += 1;
      continue;
    }
    letterComponents.push(component);
  }
  return { letterComponents, lineComponents, bentStrokes, ignored };
}

// A lowercase l (as in Cl) is a bare vertical stroke that the line classifier
// grabs. Reassign near-vertical short strokes sitting immediately to the
// right of a C or B glyph.
function adoptLowercaseStems(glyphs: Glyph[], lineComponents: InkComponent[]) {
  const adopted: Glyph[] = [];
  const remainingLines: InkComponent[] = [];

  for (const component of lineComponents) {
    const verticalness = Math.abs(Math.sin(component.angle));
    const host = glyphs.find((glyph) => {
      if (glyph.char !== "C" && glyph.char !== "B") return false;
      const heightRatio = component.height / glyph.component.height;
      const gap = component.minX - glyph.component.maxX;
      const verticalOverlap = overlap1d(component.minY, component.maxY, glyph.component.minY, glyph.component.maxY);
      return (
        verticalness > 0.85 &&
        heightRatio > 0.55 &&
        heightRatio < 1.6 &&
        gap > -4 &&
        gap < glyph.component.width * 1.1 &&
        verticalOverlap > component.height * 0.4
      );
    });

    if (host) {
      adopted.push({ component, char: "l", score: 0.85 });
    } else {
      remainingLines.push(component);
    }
  }
  return { adopted, remainingLines };
}

function overlap1d(minA: number, maxA: number, minB: number, maxB: number) {
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function glyphSize(glyph: Glyph) {
  return Math.max(glyph.component.width, glyph.component.height);
}

// --- Multi-stroke letter grouping ---

// Merged shapes must read as one of these; lowercase stems and I are single
// strokes, so a merge producing them is spurious.
const MERGEABLE_CHARS = new Set(["C", "H", "O", "N", "S", "P", "F", "B"]);

function mergeMultiStrokeGlyphs(
  glyphs: Glyph[],
  lineComponents: InkComponent[],
  mask: Uint8Array,
  width: number,
): { glyphs: Glyph[]; lines: InkComponent[] } {
  interface Part {
    component: InkComponent;
    glyph: Glyph | null;
  }
  const parts: Part[] = [
    ...glyphs.map((glyph) => ({ component: glyph.component, glyph: glyph as Glyph | null })),
    ...lineComponents.map((component) => ({ component, glyph: null })),
  ];

  for (let pass = 0; pass < 6; pass++) {
    let best: { a: number; b: number; glyph: Glyph } | null = null;

    for (let a = 0; a < parts.length; a++) {
      for (let b = a + 1; b < parts.length; b++) {
        const candidate = tryMergeParts(parts[a], parts[b], mask, width);
        if (candidate && (!best || candidate.score > best.glyph.score)) {
          best = { a, b, glyph: candidate };
        }
      }
    }

    if (!best) break;
    const mergedPart: Part = { component: best.glyph.component, glyph: best.glyph };
    const keep = parts.filter((_, index) => index !== best!.a && index !== best!.b);
    parts.length = 0;
    parts.push(...keep, mergedPart);
  }

  return {
    glyphs: parts.filter((part) => part.glyph).map((part) => part.glyph!),
    lines: parts.filter((part) => !part.glyph).map((part) => part.component),
  };
}

function tryMergeParts(a: { component: InkComponent; glyph: Glyph | null }, b: { component: InkComponent; glyph: Glyph | null }, mask: Uint8Array, width: number): Glyph | null {
  const compA = a.component;
  const compB = b.component;

  // Two roughly parallel strokes are a multi-bond candidate, never a letter.
  if (!a.glyph && !b.glyph) {
    if (angleDistance(compA.angle, compB.angle) < 0.35) return null;
  }

  const maxDim = Math.max(compA.width, compA.height, compB.width, compB.height);
  const gapX = Math.max(0, compB.minX - compA.maxX, compA.minX - compB.maxX);
  const gapY = Math.max(0, compB.minY - compA.maxY, compA.minY - compB.maxY);
  if (gapX > maxDim * 0.3 || gapY > maxDim * 0.3) return null;

  const unionWidth = Math.max(compA.maxX, compB.maxX) - Math.min(compA.minX, compB.minX) + 1;
  const unionHeight = Math.max(compA.maxY, compB.maxY) - Math.min(compA.minY, compB.minY) + 1;
  const aspect = unionWidth / unionHeight;
  // Side-by-side letters of neighboring atoms union into wide shapes;
  // letter-like unions stay roughly square.
  if (aspect < 0.45 || aspect > 1.55) return null;

  const mergedComponent = mergeComponents([compA, compB], width);
  const mergedGlyph = classifyGlyph(mergedComponent, mask, width);
  if (!MERGEABLE_CHARS.has(mergedGlyph.char)) return null;

  const baseline = Math.max(a.glyph?.score ?? 0, b.glyph?.score ?? 0);
  if (mergedGlyph.score < 0.62 || mergedGlyph.score < baseline + 0.03) return null;
  return mergedGlyph;
}

// --- Glyph classification ---

let templateCache: Array<{ char: string; holes: number; vector: Float32Array }> | null = null;

function glyphTemplates() {
  if (templateCache) return templateCache;
  templateCache = [];

  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;

  const variants: Array<[string, string, number, number]> = [];
  for (const font of TEMPLATE_FONTS) {
    for (const weight of ["bold", "normal"]) {
      for (const rotation of TEMPLATE_ROTATIONS) {
        // Horizontal squeeze approximates tall narrow handwriting (a lean
        // handwritten O must not lose to P on aspect alone).
        for (const squeeze of [1, 0.7]) {
          variants.push([font, weight, rotation, squeeze]);
        }
      }
    }
  }

  for (const char of GLYPH_CHARS) {
    for (const [font, weight, rotation, squeeze] of variants) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 96, 96);
      context.fillStyle = "#000";
      context.translate(48, 48);
      context.rotate(rotation);
      context.scale(squeeze, 1);
      context.font = `${weight} 56px "${font}", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(char, 0, 0);

      const image = context.getImageData(0, 0, 96, 96);
      const mask = binarize(image);
      const components = findComponents(mask, 96, 96).filter((component) => component.area >= MIN_COMPONENT_AREA);
      if (components.length === 0) continue;
      const merged = mergeComponents(components, 96);
      templateCache.push({
        char,
        holes: merged.holes,
        vector: rasterizeComponent(merged, mask, 96),
      });
    }
  }
  return templateCache;
}

// Merge disconnected strokes into a single pseudo-component (used both for
// multi-part font templates and for multi-stroke handwriting). Holes are
// recomputed on the union because separate arcs can enclose new regions.
function mergeComponents(components: InkComponent[], width: number): InkComponent {
  if (components.length === 1) return components[0];
  const total = components.reduce((sum, component) => sum + component.area, 0);
  const pixels = concatPixels(components);
  const minX = Math.min(...components.map((component) => component.minX));
  const minY = Math.min(...components.map((component) => component.minY));
  const maxX = Math.max(...components.map((component) => component.maxX));
  const maxY = Math.max(...components.map((component) => component.maxY));
  const merged: InkComponent = {
    ...components[0],
    pixels,
    area: total,
    minX,
    minY,
    maxX,
    maxY,
    cx: components.reduce((sum, component) => sum + component.cx * component.area, 0) / total,
    cy: components.reduce((sum, component) => sum + component.cy * component.area, 0) / total,
    holes: countHoles(pixels, minX, minY, maxX, maxY, width),
  };
  merged.width = merged.maxX - merged.minX + 1;
  merged.height = merged.maxY - merged.minY + 1;
  return merged;
}

function concatPixels(components: InkComponent[]): Int32Array {
  const total = components.reduce((sum, component) => sum + component.pixels.length, 0);
  const result = new Int32Array(total);
  let offset = 0;
  for (const component of components) {
    result.set(component.pixels, offset);
    offset += component.pixels.length;
  }
  return result;
}

// Rasterize to a binary presence grid, then dilate one cell. Thickness
// normalization matters: a thin ballpoint glyph and a bold template must
// produce similar grids or handwriting scores collapse.
function rasterizeComponent(component: InkComponent, mask: Uint8Array, width: number): Float32Array {
  const counts = new Float32Array(GRID * GRID);
  const scale = Math.max(component.width, component.height);
  const offsetX = component.minX + component.width / 2 - scale / 2;
  const offsetY = component.minY + component.height / 2 - scale / 2;

  for (const index of component.pixels) {
    const x = index % width;
    const y = (index / width) | 0;
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((x - offsetX) / scale) * GRID)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((y - offsetY) / scale) * GRID)));
    counts[gy * GRID + gx] += 1;
  }

  const minCount = Math.max(1, (scale / GRID) ** 2 * 0.04);
  const grid = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if (counts[gy * GRID + gx] < minCount) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) grid[ny * GRID + nx] = 1;
        }
      }
    }
  }
  return grid;
}

function classifyGlyph(component: InkComponent, mask: Uint8Array, width: number): Glyph {
  const vector = rasterizeComponent(component, mask, width);
  const bestByChar = new Map<string, number>();

  for (const template of glyphTemplates()) {
    let score = cosineSimilarity(vector, template.vector);
    if (template.holes !== component.holes) score *= 0.72;
    if (score > (bestByChar.get(template.char) ?? 0)) bestByChar.set(template.char, score);
  }

  const ranked = [...bestByChar.entries()].sort((a, b) => b[1] - a[1]);
  let [bestChar, bestScore] = ranked[0] ?? ["C", 0];

  // H and N differ mainly in their connector: a crossbar stays shallow (even
  // slanted handwriting rarely exceeds ~35 degrees) while N's diagonal is
  // steep. Template cosine barely separates sloppy handwriting, so measure
  // the connector's slope directly on near-ties, ignoring vertical stems.
  const topTwo = new Set(ranked.slice(0, 2).map(([char]) => char));
  if (topTwo.has("H") && topTwo.has("N") && Math.abs(ranked[0][1] - ranked[1][1]) < 0.08) {
    const slope = connectorSlope(vector);
    if (slope != null) {
      bestChar = Math.abs(slope) <= 1.05 ? "H" : "N";
      bestScore = bestByChar.get(bestChar) ?? bestScore;
    }
  }

  return {
    component,
    char: bestChar,
    score: bestScore,
    alternates: ranked.slice(0, 3).map(([char, score]) => ({ char, score: Number(score.toFixed(3)) })),
  };
}

// Slope (grid rows per column) of the connector across the middle band of
// the glyph. Columns whose ink spans most of the height are vertical stems
// passing through the band (an H written like "It") and are excluded; the
// remaining ink is the crossbar (shallow) or N-diagonal (steep).
function connectorSlope(vector: Float32Array): number | null {
  const colStart = Math.floor(GRID * 0.3);
  const colEnd = Math.ceil(GRID * 0.7);
  const points: Array<{ x: number; y: number }> = [];
  for (let gx = colStart; gx < colEnd; gx++) {
    let minRow = Infinity;
    let maxRow = -Infinity;
    let sum = 0;
    let count = 0;
    for (let gy = 0; gy < GRID; gy++) {
      if (vector[gy * GRID + gx] > 0) {
        minRow = Math.min(minRow, gy);
        maxRow = Math.max(maxRow, gy);
        sum += gy;
        count += 1;
      }
    }
    if (count === 0) continue;
    if (maxRow - minRow + 1 > GRID * 0.55) continue;
    points.push({ x: gx, y: sum / count });
  }
  if (points.length < 3) return null;

  const meanX = average(points.map((point) => point.x));
  const meanY = average(points.map((point) => point.y));
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dot / denominator : 0;
}

// --- Atom labels ---

function buildAtomLabels(glyphs: Glyph[], warnings: string[]): AtomLabel[] {
  const sorted = [...glyphs].sort((a, b) => a.component.minX - b.component.minX);
  const used = new Set<Glyph>();
  const labels: AtomLabel[] = [];
  let counter = 0;

  for (const glyph of sorted) {
    if (used.has(glyph)) continue;
    used.add(glyph);
    const cluster = [glyph];

    for (const candidate of sorted) {
      if (used.has(candidate)) continue;
      const last = cluster[cluster.length - 1].component;
      const gap = candidate.component.minX - last.maxX;
      const verticalOverlap = overlap1d(
        candidate.component.minY,
        candidate.component.maxY,
        last.minY,
        last.maxY,
      );
      const maxHeight = Math.max(candidate.component.height, last.height);
      if (gap > -maxHeight * 0.3 && gap < maxHeight * 0.55 && verticalOverlap > maxHeight * 0.3) {
        cluster.push(candidate);
        used.add(candidate);
      }
    }

    const text = cluster.map((entry) => entry.char).join("");
    const element = labelToElement(text);
    counter += 1;
    const minX = Math.min(...cluster.map((entry) => entry.component.minX));
    const minY = Math.min(...cluster.map((entry) => entry.component.minY));
    const maxX = Math.max(...cluster.map((entry) => entry.component.maxX));
    const maxY = Math.max(...cluster.map((entry) => entry.component.maxY));
    const confidence = average(cluster.map((entry) => entry.score));

    if (!element) {
      warnings.push(`Label "${text}" is not a supported element; treating it as carbon. Supported: H, C, N, O, S, P, F, Cl, Br, I.`);
    }
    labels.push({
      id: `a${counter}`,
      element: element ?? "C",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      radius: Math.hypot(maxX - minX, maxY - minY) / 2,
      confidence: element ? confidence : Math.min(confidence, 0.3),
      implicit: false,
    });
  }
  return labels;
}

function labelToElement(text: string): AtomSymbol | null {
  const normalized = text.length === 2 ? text[0].toUpperCase() + text[1].toLowerCase() : text.toUpperCase();
  const supported: AtomSymbol[] = ["H", "C", "N", "O", "S", "P", "F", "Cl", "Br", "I"];
  return supported.find((symbol) => symbol === normalized) ?? null;
}

// --- Stroke decomposition ---

// Split a connected multi-bond stroke (chevron, zigzag, Y junction) into
// straight segments: BFS-trace the longest pixel path, simplify it with
// Douglas-Peucker, then repeat on branch arms the main path missed.
function decomposeStroke(component: InkComponent, width: number, height: number): Segment[] {
  const inComponent = new Uint8Array(width * height);
  for (const index of component.pixels) inComponent[index] = 1;

  const thickness = Math.max(2, component.area / Math.max(component.majorLength, 1));
  const epsilon = Math.max(6, thickness * 1.5);
  const minSegmentLength = MIN_LINE_LENGTH * 0.8;
  const segments: Segment[] = [];

  const pushPolyline = (path: number[]) => {
    const points = path.map((index) => ({ x: index % width, y: (index / width) | 0 }));
    const vertices = douglasPeucker(points, epsilon);
    for (let index = 1; index < vertices.length; index++) {
      const start = vertices[index - 1];
      const end = vertices[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length < minSegmentLength) continue;
      segments.push({
        start,
        end,
        length,
        angle: Math.atan2(end.y - start.y, end.x - start.x),
        thickness,
      });
    }
  };

  const startIndex = component.endpoints[0].y * width + component.endpoints[0].x;
  const mainPath = bfsFarthestPath(inComponent, width, height, [startIndex]);
  if (mainPath.length < 2) return segments;
  pushPolyline(mainPath);

  // Branch arms: pixels far from the main path form leftover clusters.
  const distanceToPath = bfsDistances(inComponent, width, height, mainPath);
  const leftoverThreshold = Math.max(4, Math.round(thickness * 1.6));
  const leftover = new Set<number>();
  for (const index of component.pixels) {
    if ((distanceToPath.get(index) ?? Infinity) > leftoverThreshold) leftover.add(index);
  }
  while (leftover.size > 0) {
    const seed = leftover.values().next().value as number;
    const cluster = collectCluster(seed, leftover, inComponent, width, height);
    if (cluster.length < MIN_COMPONENT_AREA) continue;
    let entry = cluster[0];
    let entryDistance = Infinity;
    for (const index of cluster) {
      const distance = distanceToPath.get(index) ?? Infinity;
      if (distance < entryDistance) {
        entryDistance = distance;
        entry = index;
      }
    }
    const clusterMask = new Uint8Array(width * height);
    for (const index of cluster) clusterMask[index] = 1;
    const armPath = bfsFarthestPath(clusterMask, width, height, [entry]);
    if (armPath.length >= 2) pushPolyline(armPath);
  }

  return segments;
}

function bfsFarthestPath(mask: Uint8Array, width: number, height: number, seeds: number[]): number[] {
  const parents = new Map<number, number>();
  let queue = seeds.filter((seed) => mask[seed] === 1);
  for (const seed of queue) parents.set(seed, -1);
  let last = queue[0] ?? -1;

  while (queue.length > 0) {
    const next: number[] = [];
    for (const index of queue) {
      last = index;
      const x = index % width;
      const y = (index / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (mask[neighbor] === 1 && !parents.has(neighbor)) {
            parents.set(neighbor, index);
            next.push(neighbor);
          }
        }
      }
    }
    queue = next;
  }

  const path: number[] = [];
  let cursor = last;
  while (cursor !== -1 && path.length < mask.length) {
    path.push(cursor);
    cursor = parents.get(cursor) ?? -1;
  }
  return path;
}

function bfsDistances(mask: Uint8Array, width: number, height: number, seeds: number[]): Map<number, number> {
  const distances = new Map<number, number>();
  let queue = seeds.filter((seed) => mask[seed] === 1);
  for (const seed of queue) distances.set(seed, 0);
  let level = 0;

  while (queue.length > 0) {
    level += 1;
    const next: number[] = [];
    for (const index of queue) {
      const x = index % width;
      const y = (index / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (mask[neighbor] === 1 && !distances.has(neighbor)) {
            distances.set(neighbor, level);
            next.push(neighbor);
          }
        }
      }
    }
    queue = next;
  }
  return distances;
}

function collectCluster(seed: number, leftover: Set<number>, mask: Uint8Array, width: number, height: number): number[] {
  const cluster: number[] = [];
  const stack = [seed];
  leftover.delete(seed);
  while (stack.length > 0) {
    const index = stack.pop()!;
    cluster.push(index);
    const x = index % width;
    const y = (index / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (leftover.has(neighbor)) {
          leftover.delete(neighbor);
          stack.push(neighbor);
        }
      }
    }
  }
  return cluster;
}

function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  const start = points[0];
  const end = points[points.length - 1];
  let maxDistance = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = pointToLineDistance(points[index], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= epsilon) return [start, end];
  const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
  const right = douglasPeucker(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function pointToLineDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + clamped * dx), point.y - (start.y + clamped * dy));
}

// --- Bonds ---

function componentToSegment(component: InkComponent): Segment {
  const [start, end] = component.endpoints;
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  return {
    start,
    end,
    length,
    angle: Math.atan2(end.y - start.y, end.x - start.x),
    thickness: Math.max(1.5, component.area / length),
  };
}

function groupParallelSegments(segments: Segment[]): Segment[][] {
  const parent = segments.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let a = 0; a < segments.length; a++) {
    for (let b = a + 1; b < segments.length; b++) {
      if (areParallelPartners(segments[a], segments[b])) union(a, b);
    }
  }

  const groups = new Map<number, Segment[]>();
  segments.forEach((segment, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(segment);
  });
  return [...groups.values()];
}

function areParallelPartners(a: Segment, b: Segment): boolean {
  const angleDiff = angleDistance(a.angle, b.angle);
  if (angleDiff > 0.32) return false;

  // Strokes of one multi-bond are drawn with similar lengths; wildly
  // different lengths are separate bonds that happen to be parallel.
  const lengthRatio = Math.max(a.length, b.length) / Math.max(1, Math.min(a.length, b.length));
  if (lengthRatio > 2.2) return false;

  const axisX = Math.cos(a.angle);
  const axisY = Math.sin(a.angle);
  const midB = { x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2 };
  const midA = { x: (a.start.x + a.end.x) / 2, y: (a.start.y + a.end.y) / 2 };
  const perpendicular = Math.abs((midB.x - midA.x) * -axisY + (midB.y - midA.y) * axisX);
  // Thin-pen double bonds can be spaced wide relative to stroke thickness,
  // so also allow spacing proportional to the stroke length.
  const maxSpacing = Math.max(16, (a.thickness + b.thickness) * 3.4, Math.min(a.length, b.length) * 0.6);
  if (perpendicular < 1 || perpendicular > maxSpacing) return false;

  const projectionsA = [projectOnto(a.start, midA, axisX, axisY), projectOnto(a.end, midA, axisX, axisY)];
  const projectionsB = [projectOnto(b.start, midA, axisX, axisY), projectOnto(b.end, midA, axisX, axisY)];
  const overlap = overlap1d(
    Math.min(...projectionsA),
    Math.max(...projectionsA),
    Math.min(...projectionsB),
    Math.max(...projectionsB),
  );
  return overlap > Math.min(a.length, b.length) * 0.45;
}

function projectOnto(point: Point, origin: Point, axisX: number, axisY: number) {
  return (point.x - origin.x) * axisX + (point.y - origin.y) * axisY;
}

function angleDistance(a: number, b: number) {
  let diff = Math.abs(a - b) % Math.PI;
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  return diff;
}

// --- Graph assembly ---

function assembleGraph(labels: AtomLabel[], bondGroups: Segment[][], warnings: string[]) {
  const allLabels = [...labels];
  let implicitCount = 0;
  const bonds: RecognizedBond[] = [];

  const attach = (point: Point, direction: Point, segmentLength: number, medianLength: number): AtomLabel => {
    // Bonds are drawn pointing at their atoms: prefer the nearest label along
    // the stroke's own axis, which bridges the wide gaps students leave.
    let best: AtomLabel | null = null;
    let bestAxial = Infinity;
    for (const label of allLabels) {
      if (label.implicit) continue;
      const dx = label.center.x - point.x;
      const dy = label.center.y - point.y;
      const axial = dx * direction.x + dy * direction.y;
      const perpendicular = Math.abs(-direction.y * dx + direction.x * dy);
      const withinReach = axial > -label.radius * 0.4 && axial < 2.5 * Math.max(segmentLength, 30);
      if (withinReach && perpendicular < label.radius * 0.9 + 14 && axial < bestAxial) {
        best = label;
        bestAxial = axial;
      }
    }
    if (best) return best;

    let bestDistance = Infinity;
    for (const label of allLabels) {
      const distance = Math.hypot(point.x - label.center.x, point.y - label.center.y);
      // Radial fallback also merges endpoints into implicit junction atoms.
      const reach = label.implicit ? Math.max(14, medianLength * 0.3) : label.radius + Math.max(20, medianLength * 0.6);
      if (distance < reach && distance < bestDistance) {
        best = label;
        bestDistance = distance;
      }
    }
    if (best) return best;

    implicitCount += 1;
    const implicit: AtomLabel = {
      id: `x${implicitCount}`,
      element: "C",
      center: point,
      radius: 10,
      confidence: 0.5,
      implicit: true,
    };
    allLabels.push(implicit);
    return implicit;
  };

  const medianLength = median(bondGroups.map((group) => average(group.map((segment) => segment.length)))) || 40;

  bondGroups.forEach((group, index) => {
    const representative = averageSegment(group);
    const length = Math.max(1, representative.length);
    const axis = {
      x: (representative.end.x - representative.start.x) / length,
      y: (representative.end.y - representative.start.y) / length,
    };
    const from = attach(representative.start, { x: -axis.x, y: -axis.y }, representative.length, medianLength);
    const to = attach(representative.end, axis, representative.length, medianLength);
    if (from === to) {
      warnings.push("A bond stroke could not be connected between two atoms and was skipped.");
      return;
    }
    const order: BondOrder = group.length >= 3 ? 3 : group.length === 2 ? 2 : 1;
    if (group.length > 3) {
      warnings.push(`${group.length} parallel strokes were read as a triple bond.`);
    }
    const duplicate = bonds.find(
      (bond) => (bond.a === from.id && bond.b === to.id) || (bond.a === to.id && bond.b === from.id),
    );
    if (duplicate) return;
    bonds.push({
      id: `b${index + 1}`,
      a: from.id,
      b: to.id,
      order,
      confidence: Math.min(from.confidence, to.confidence, 0.95),
    });
  });

  if (implicitCount > 0) {
    warnings.push(
      `${implicitCount} bond endpoint${implicitCount === 1 ? "" : "s"} had no nearby letter; implicit carbon${implicitCount === 1 ? " was" : "s were"} added.`,
    );
  }

  const connected = new Set(bonds.flatMap((bond) => [bond.a, bond.b]));
  const isolated = allLabels.filter((label) => !label.implicit && !connected.has(label.id));
  if (isolated.length > 0 && bonds.length > 0) {
    warnings.push(
      `${isolated.length} atom label${isolated.length === 1 ? "" : "s"} (${isolated.map((label) => label.element).join(", ")}) had no connecting bond.`,
    );
  }

  const atoms: RecognizedAtom[] = allLabels.map((label) => ({
    id: label.id,
    element: label.element,
    position: { x: label.center.x, y: label.center.y },
    confidence: label.confidence,
    labelText: label.implicit ? undefined : label.element,
  }));

  return { atoms, bonds };
}

function averageSegment(group: Segment[]): Segment {
  if (group.length === 1) return group[0];
  const reference = group[0];
  const axisX = Math.cos(reference.angle);
  const axisY = Math.sin(reference.angle);
  const aligned = group.map((segment) => {
    const forward = (segment.end.x - segment.start.x) * axisX + (segment.end.y - segment.start.y) * axisY >= 0;
    return forward ? segment : { ...segment, start: segment.end, end: segment.start };
  });
  return {
    start: {
      x: average(aligned.map((segment) => segment.start.x)),
      y: average(aligned.map((segment) => segment.start.y)),
    },
    end: {
      x: average(aligned.map((segment) => segment.end.x)),
      y: average(aligned.map((segment) => segment.end.y)),
    },
    length: average(aligned.map((segment) => segment.length)),
    angle: reference.angle,
    thickness: average(aligned.map((segment) => segment.thickness)),
  };
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
