# Developer guide

Technical setup and internals for **Polymer AR Lab**. If you just want to *use*
the app, see the [README](README.md) or the in-app
[tutorial](https://kenichinomura.github.io/PolymerARLab/tutorial.html).

Stack: static **Vite + TypeScript + Three.js**, with **RDKit.js** and
**openchemlib** vendored into the browser (no backend required). AI sketch
recognition is an optional **Cloudflare Worker**.

## Local development

```bash
npm ci
npm run dev        # HTTPS dev server (WebXR + camera require HTTPS)
npm run dev:http   # HTTP dev server for local-network testing
npm run build      # static build into dist/
npm run preview    # serve the build
```

RDKit.js (`public/vendor/rdkit`) and the openchemlib conformer resources
(`public/vendor/openchemlib`) are vendored, so chemistry works with no backend; a
lightweight parser is the fallback if RDKit can't load.

## Deploy (GitHub Pages)

The build uses a relative Vite base path so it runs from a repo subpath.
`.github/workflows/deploy-pages.yml` deploys on every push to `main` — set the
repository's **Pages source** to **GitHub Actions**. `public/tutorial.html`
deploys alongside the app at `…/tutorial.html`.

## Optional: AI sketch recognition (Cloudflare Worker)

The static site never holds an API key — a Cloudflare Worker (`worker/`) proxies
to the Claude API:

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AI_ACCESS_TOKEN   # a shared passphrase (see below)
npx wrangler deploy
```

**Access control.** Recognition only calls the Worker when a device has stored a
token; enable it per device by opening `https://<your-site>/?aitoken=<passphrase>`
once (persisted in `localStorage`; `?aitoken=off` forgets it). The Worker
**fails closed**:

- no `AI_ACCESS_TOKEN` secret set → every request returns `503`;
- wrong/missing `X-AI-Token` header → `401`, **before** any billable Claude call.

Devices without a token silently use the free on-device recognizer, so students
never spend your API credits by accident.

**Config.** The endpoint defaults to `DEFAULT_AI_ENDPOINT` in
`src/aiRecognition.ts` and can be overridden with `?ai=<url>` (`?ai=off` disables,
`?ai=default` restores). Set the Worker `MODEL` var to `claude-haiku-4-5` for
cheaper scans; list your site origin in `ALLOWED_ORIGINS`.

## How it works

- **3-D geometry** — openchemlib's torsion-library conformer generator
  (`src/conformer3d.ts`). PubChem molecules keep their own coordinates
  (`src/pubchem.ts`, `buildMoleculeTemplate3D`); C60 ships baked (`src/c60.ts`).
  VSEPR (`src/vseprGeometry.ts`) is the instant fallback while resources load.
- **Polymer builder** — `deriveRepeatUnit` (`src/structureImport.ts`) opens the
  chosen bond and strips hydrogens; `generatePolymerGraph` (`src/polymerData.ts`)
  tiles the unit, rotating each unit about the backbone axis (`bestTwist` in
  `conformer3d.ts`) to avoid side-group overlap, and H-caps the chain ends.
- **Recognition** — AI (`src/aiRecognition.ts` → Worker → Claude vision) when
  configured, else the on-device classical CV recognizer
  (`src/sketchRecognition.ts`); both emit the graph contract in
  `src/scannerContract.ts`. The camera path crops to the on-screen viewfinder
  (`src/scanFrame.ts`, `src/cameraOverlay.ts`).
- **AR** — iOS USDZ / AR Quick Look (`src/usdzExport.ts`, `src/scene/quickLook.ts`)
  and Android WebXR with tap-to-place "grow out of the surface"
  (`src/scene/webxr.ts`, `src/scene/threeScene.ts`).
- **LAMMPS export** — `src/lammpsExport.ts` derives the topology and a
  self-contained generic **UFF-style** force field (per-element Lennard-Jones,
  bond r₀/K from UFF radii/charges, harmonic angles, weak torsions, sp² impropers)
  and writes `<name>.data` + `in.relax` (warm-up → FIRE → NVT).

## Design docs

- [`docs/handwritten-scanner-contract.md`](docs/handwritten-scanner-contract.md) — the scanner's graph-output contract.
- [`docs/ar-webapp-plan.md`](docs/ar-webapp-plan.md) — the original roadmap (historical) + a "shipped since" summary.

## License

MIT License. See [LICENSE](LICENSE).
