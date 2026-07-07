# AR Webapp Implementation Plan

This plan captures the cross-platform AR polymer webapp roadmap discussed on July 3, 2026.

## Goal

Build one browser-based AR webapp that runs on both Android and iPhone platforms, with a shared molecular visualization core and platform-specific AR fallbacks.

The app should support:

- Android Chrome with WebXR/ARCore when available.
- iPhone Safari with a camera-overlay fallback, and later a WebAR SDK or USDZ/Quick Look path.
- Desktop browsers with a 3D preview and structure-review workflow.

Pure WebXR is not enough for iPhone Safari, so the long-term architecture should use progressive capability detection rather than assuming one AR API works everywhere.

## Current Progress

Completed:

- Built the first Vite/Three.js polymer AR prototype.
- Added explicit polymer graph data with known atom connectivity and bond orders.
- Added ball-and-stick molecular rendering for single, double, triple, and aromatic bonds.
- Added curated polymer examples with rings, ester/amide groups, nitrile triple bonds, repeat counts, and explicit bond orders.
- Added Android-oriented WebXR AR entry path where immersive AR is supported.
- Added iPhone-friendly camera overlay fallback.
- Added mobile Safari diagnostics, camera fallback behavior, and 2D fallback rendering.
- Kept lightweight structure summaries and valence validation instead of manual atom/bond editing.
- Added browser-side RDKit.js/WASM loading for SMILES and Molfile validation.
- Added static RDKit assets so the MVP can run from GitHub Pages without a backend.
- Added classroom-friendly example imports for common molecules and polymer repeat units.
- Added browser-side VSEPR geometry cleanup for acyclic molecules and direct-backbone polymer repeat units.
- Added GitHub Pages deployment workflow and relative production asset paths.
- Added a handwritten scanner graph contract for the future recognition pipeline.
- Validated desktop and phone-sized rendering with build and screenshot checks.
- Enabled GitHub Pages for the repository and verified the hosted build loads RDKit.js and imports SMILES end to end (July 7, 2026).
- Hardened import validation messages: supported-atom lists in errors, invalid bond orders rejected instead of silently coerced, attachment-point fallbacks reported, and Molfile header names parsed correctly (SMILES imports keep the typed SMILES as the display name).
- Connected camera capture and image upload to the scanner graph contract with a demo recognition fixture, including image-to-model coordinate normalization.

## Recommended Architecture

Use a cross-platform WebAR/PWA-style architecture:

- Frontend: Vite + TypeScript + Three.js.
- Molecular rendering: graph-based Three.js renderer.
- Structure review: preset/imported/scanned structures with validation summaries.
- MVP chemistry: browser-side RDKit.js/WASM for SMILES/Molfile parsing, validation, aromatic handling, and 2D coordinate generation.
- MVP geometry cleanup: browser-side VSEPR heuristics for classroom-scale molecules and simple polymer repeat units.
- Optional advanced chemistry backend: Python + RDKit only if future research-grade conformer generation or heavy batch processing is needed.
- AR delivery:
  - Android: WebXR/ARCore first, Scene Viewer or fallback preview when unavailable.
  - iPhone: camera overlay now, WebAR SDK or USDZ/Quick Look later.
  - Desktop: Three.js preview, structure import, and validation only.

## MVP Scope

The first complete MVP should focus on polymer repeat-unit visualization rather than full simulation.

It should support:

- Atom types: C, H, O, N, S, P, F, Cl, Br, I.
- Bond types: single, double, triple, aromatic.
- Rings and common functional groups.
- Repeat-unit brackets with `n`.
- Degree of polymerization control, such as `n = 3`, `5`, or `10`.
- 3D ball-and-stick polymer chain generation.
- AR placement on supported mobile devices.
- Structure validation before generating the final model.

## Product Flow

1. Choose, draw, import, or scan a polymer repeat unit.
2. Review detected atoms, bonds, repeat-unit attachment points, and `n`.
3. Validate the molecular graph.
4. Generate a short visible oligomer/polymer chain.
5. Render the model in 3D.
6. Place or preview the model in AR.

## Implementation Phases

### Phase 1: Structure Input

Add a real structure input path before handwritten recognition.

Options:

- Optionally integrate a chemical editor only if a future drawing workflow needs it.
- Import Molfile, SMILES, or a small JSON molecular graph.
- Map imported structures into the existing polymer graph model.
- Let users identify repeat-unit connection points and degree of polymerization.

Deliverable:

- User can enter or import a repeat unit and generate the same 3D/AR polymer preview currently available from curated templates.

### Phase 2: Browser Chemistry Validation

Use browser-side RDKit.js/WASM for the zero-config hosted MVP.

Current stack:

- Static `@rdkit/rdkit` assets served with the app.
- `RDKit_minimal.js` and `RDKit_minimal.wasm` loaded directly in the browser.
- RDKit.js for classroom-scale SMILES and Molfile chemistry.

Responsibilities:

- Validate imported structures.
- Normalize aromatic systems.
- Generate 2D coordinates for SMILES inputs.
- Convert imported structures to Molfiles for the existing graph importer.
- Apply VSEPR cleanup to acyclic molecule layouts and direct polymer repeat-unit backbones.
- Expand repeat units into short oligomers.
- Keep 3D display educational and visually clear rather than research-grade conformer prediction.

Potential future backend:

- Python RDKit service for heavier 3D conformer generation.
- Optional MACE-style force-field optimization only for advanced structures that exceed the browser heuristic path.
- Optional Open Babel for additional format conversion.
- Server-side generation of GLB, SDF, PDB, or USDZ-compatible assets.

### Phase 3: Production AR Paths

Harden AR across devices.

Android:

- Use WebXR immersive AR when available.
- Provide Scene Viewer or 3D preview fallback when ARCore is unavailable.

iPhone:

- Keep the camera-overlay fallback for immediate support.
- Add USDZ/Quick Look export for native iOS AR preview.
- Evaluate a WebAR SDK if markerless tracking is required directly in Safari.

Desktop:

- Keep non-AR Three.js preview, import, and validation.

### Phase 4: Handwritten Structure Recognition

Add camera scan or image upload after the structure-input pipeline works.

The scanner should output the contract defined in `src/scannerContract.ts` and
`docs/handwritten-scanner-contract.md`, then convert into the existing graph JSON
import path.

Recognition should detect:

- Atoms and element labels.
- Single, double, triple, and aromatic bonds.
- Rings.
- Repeat-unit brackets and `n`.
- Charges and common functional groups.
- Attachment points.

The recognized result should always go through validation and status review before model generation.

### Phase 5: Packaging And Deployment

Prepare for real mobile use:

- PWA manifest and installability.
- Trusted HTTPS deployment through GitHub Pages or another static host.
- Persistent saved examples.
- Shareable structure/model links.
- Clear browser support messaging.

## Internal Data Model

Represent polymers with a graph-first model:

```ts
type PolymerSpec = {
  repeatUnit: MolecularGraph;
  leftAttachmentAtomId: string;
  rightAttachmentAtomId: string;
  degreeOfPolymerization: number;
  endGroups?: {
    left?: MolecularGraph;
    right?: MolecularGraph;
  };
  tacticity?: "unknown" | "isotactic" | "syndiotactic" | "atactic";
};
```

Generate a short visible chain for AR rather than trying to render an infinite polymer.

## Rendering Requirements

The molecular renderer should support:

- Spheres for atoms.
- Cylinders for bonds.
- Offset cylinders for double and triple bonds.
- Aromatic bond styling.
- Element-based colors.
- Optional labels.

## Test Matrix

Test on:

- iPhone Safari.
- Android Chrome with ARCore.
- Android Chrome without ARCore.
- Desktop Chrome.
- Desktop Safari.

Use known polymer examples:

- Polyethylene.
- PVC.
- Polystyrene.
- PET.
- Nylon repeat unit.
- Polycarbonate.
- Conjugated or aromatic polymer examples.

## Best Demo Target

The first polished demo should be:

```text
Draw or select a polystyrene repeat unit
  -> choose n = 4
  -> generate a 3D chain
  -> place the structure model on a desk in AR
  -> review the structure summary and bond orders
```

## Immediate Next Step

The structure input pipeline is verified end to end (hosted RDKit.js, hardened
validation messages, capture/upload wired to the scanner contract via a demo
recognizer). Next:

1. Replace the demo recognizer in `src/scannerPipeline.ts` with first real recognition, starting with clean black-marker structures on white paper.
2. Test the AR paths on physical devices: Android Chrome WebXR placement and the iPhone Safari camera overlay.
3. Add USDZ/Quick Look export for native iOS AR preview (Phase 3).
4. Start Phase 5 packaging: PWA manifest, saved examples, shareable links.
