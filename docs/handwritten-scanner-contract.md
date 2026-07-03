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
