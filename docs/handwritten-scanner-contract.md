# Handwritten Scanner Contract

The handwritten scanner should output a molecular graph, not a finished 3D model.
The existing import, validation, VSEPR cleanup, polymer expansion, and AR renderer
then handle the display path.

## Recognition Output

The scanner returns:

- `atoms`: atom IDs, element symbols, 2D image coordinates, and confidence.
- `bonds`: connected atom IDs, bond order, and confidence.
- `polymer`: optional repeat-unit hints for left/right attachment atoms and repeat count.
- `warnings`: recognition issues that should be shown in status text.

The TypeScript source of truth is `src/scannerContract.ts`.

## Viewer Conversion

The scanner result converts to the existing graph JSON shape:

```ts
{
  name: "Scanned structure",
  atoms: [
    { id: "a1", element: "C", position: [0, 0, 0] }
  ],
  bonds: [
    { id: "b1", a: "a1", b: "a2", order: 1 }
  ],
  leftAttachmentAtomId: "a1",
  rightAttachmentAtomId: "a2",
  defaultRepeats: 4
}
```

That graph JSON can be passed through the current `importStructure(..., "json")`
path.

## First Scanner MVP

Start with a bounded classroom target:

- clean black-marker Lewis structures on white paper;
- atom labels C, H, O, N, S, P, F, Cl, Br, I;
- single, double, and triple bonds;
- common rings after straight-chain structures work;
- optional polymer bracket detection later.

For polymers, the first MVP can ask the student to choose the repeat-unit start
and end atoms after recognition if the scanner cannot infer them confidently.

## Current Implementation

`src/sketchRecognition.ts` implements the MVP recognizer with classical
browser-side computer vision (no model download):

1. Otsu binarization of the captured frame (downscaled to <=720px).
2. Connected-component analysis with PCA elongation and hole counting.
3. Letter blobs are classified against glyph templates rendered at runtime
   from system fonts (C, H, O, N, S, P, F, I, B, l, r), gated by hole count.
4. Straight strokes become bond segments; connected zigzags, chevrons, and
   junction strokes are decomposed via BFS path tracing plus Douglas-Peucker
   simplification.
5. Nearly parallel overlapping segments group into double/triple bonds.
6. Segments attach to the nearest atom label; endpoints with no label become
   implicit carbons (with a warning), so skeletal notation partially works.

Known v1 limits:

- a standalone letter I is indistinguishable from a vertical bond stroke;
- bond lines must not touch the atom letters;
- aromatic ring circles and polymer brackets are not detected yet (polymer
  hints are never emitted, so scans import in molecule mode);
- two-letter labels must be written left to right (Cl, Br).

Every recognition result carries per-atom/per-bond confidence and warnings,
and lands in the editable graph JSON textarea for student review before the
model is generated.
