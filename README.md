# Polymer AR Lab

> **Active development notice:** This app is still under active development. If
> you want to try it, use it at your own risk.

Polymer AR Lab is a browser-based molecular viewer for classroom molecule and
polymer visualization. It runs as a static Vite app with Three.js rendering,
browser-side RDKit.js validation, VSEPR geometry cleanup, and mobile AR
fallbacks.

The app is being shaped for high-school to undergraduate chemistry use:

- choose preset molecules and polymer repeat units;
- import SMILES, Molfile, or graph JSON structures;
- visualize explicit single, double, triple, and aromatic bonds;
- expand simple polymer repeat units into short visible chains;
- preview in desktop 3D, Android WebXR AR, or an iPhone camera overlay;
- prepare for handwritten Lewis-structure recognition.

## Local Development

Install dependencies:

```bash
npm ci
```

Run the HTTPS dev server:

```bash
npm run dev
```

Run the HTTP dev server for local network testing:

```bash
npm run dev:http
```

Build the static app:

```bash
npm run build
```

## Zero-Config Chemistry

RDKit.js assets are served from `public/vendor/rdkit`, so SMILES and Molfile
validation work without a backend:

- `RDKit_minimal.js`
- `RDKit_minimal.wasm`

The browser app falls back to a lightweight parser when RDKit.js cannot load.
VSEPR cleanup runs in the browser for classroom-scale acyclic molecules and
direct-backbone polymer repeat units.

## GitHub Pages

The production build is configured with a relative Vite base path so it can run
from either a root domain or a GitHub Pages repo path.

This repo includes:

- `.github/workflows/deploy-pages.yml` for GitHub Pages deployment;
- `public/.nojekyll` so GitHub Pages serves static assets directly;
- static RDKit assets copied into `dist/vendor/rdkit` during build.

To host from GitHub Pages, push to `main` and configure the repository's Pages
source to use GitHub Actions.

## Scanner Contract

Handwritten Lewis-structure recognition should output a molecular graph, not a
finished 3D model. The contract is documented in
[`docs/handwritten-scanner-contract.md`](docs/handwritten-scanner-contract.md)
and typed in [`src/scannerContract.ts`](src/scannerContract.ts).

The scanner output converts into the same graph JSON shape already used by the
import pipeline, then flows through validation, VSEPR cleanup, rendering, and AR.

## Roadmap

The current roadmap is tracked in
[`docs/ar-webapp-plan.md`](docs/ar-webapp-plan.md).

Camera capture and image upload run a browser-side recognizer for clean
black-marker Lewis structures (`src/sketchRecognition.ts`): letters classify
against font templates, strokes become bonds (including double/triple pairs
and skeletal implicit carbons), and results land in editable graph JSON with
confidence and warnings before the 3D model is generated.

Near-term work:

- tune recognition against real photographed handwriting;
- add ring, aromatic-circle, and polymer-bracket detection;
- test AR placement on physical Android and iPhone devices;
- add USDZ/Quick Look export for native iOS AR preview.

## License

MIT License. See [LICENSE](LICENSE).
