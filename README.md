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
- place structures in native iOS AR via USDZ/Quick Look export ("AR Quick Look" button);
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

Camera capture and image upload support two recognition engines:

1. **AI recognition (optional, most accurate):** the sketch photo is sent to a
   small Cloudflare Worker you deploy (`worker/`), which asks Claude (vision)
   to transcribe the drawing to SMILES — preserving the student's chemistry
   mistakes so the valence checker can flag them. See "AI Recognition Setup".
2. **On-device recognizer (always available, offline):** a classical
   computer-vision pipeline (`src/sketchRecognition.ts`) for clean marker
   sketches — letters classify against font templates, strokes become bonds,
   skeletal junctions become implicit carbons.

The AI engine is used when configured and falls back to the on-device engine
when offline or undeployed.

## 3D Structure Generation

All structures (presets, imports, scans) are embedded in real 3D with
openchemlib's torsion-library conformer generator (`src/conformer3d.ts`):
water is bent, methane is tetrahedral, rings are planar, and polymer repeat
units are aligned along the chain axis. The "Show hydrogens" toggle (View and
AR panel) completes open valences with conformer-placed hydrogen atoms —
polymer attachment positions stay hydrogen-free so chains link cleanly. The previous VSEPR heuristics
(`src/vseprGeometry.ts`) remain as an instant fallback while the conformer
resources (`public/vendor/openchemlib/resources.json`) load, and for
structures openchemlib cannot parse.

## AI Recognition Setup (optional)

The static site never holds an API key; a Cloudflare Worker proxies to the
Claude API:

```bash
cd worker
npm install
npx wrangler login                     # once, opens browser
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy                    # prints your workers.dev URL
```

Set a shared access passphrase so strangers cannot spend your API credits
(origin checks alone are forgeable outside browsers):

```bash
npx wrangler secret put AI_ACCESS_TOKEN   # pick any passphrase; rotate anytime
```

Then enable AI scanning per device by opening
`https://<your-site>/?aitoken=<passphrase>` once (persisted in localStorage;
`?aitoken=off` forgets it). Devices without the token automatically use the
free on-device recognizer, and tokenless requests are rejected before any
billable API call. The endpoint itself defaults to `DEFAULT_AI_ENDPOINT` in
`src/aiRecognition.ts` and can be overridden with `?ai=<url>` (`?ai=off`
disables, `?ai=default` restores). To rotate the passphrase, rerun the
`secret put` command and share the new `?aitoken=` link. The Worker's `ALLOWED_ORIGINS` var in
`worker/wrangler.toml` must list your site origin. Model defaults to
`claude-opus-4-8`; set the `MODEL` var to `claude-haiku-4-5` for ~5x cheaper
scans. Note the endpoint is callable by anyone who can reach it — fine for
classroom scale; add a token check in `worker/src/index.ts` if abused.

Near-term work:

- test AI recognition against varied real handwriting;
- test AR placement on physical Android and iPhone devices;
- add USDZ/Quick Look export for native iOS AR preview.

## License

MIT License. See [LICENSE](LICENSE).
