# Polymer AR Lab

> **Active development notice:** still under active development — use at your own risk.

Turn a hand-drawn Lewis structure — or any molecule from PubChem — into an
interactive 3-D model, view it in augmented reality on the desk in front of you,
build polymer chains, and export ready-to-run LAMMPS input for a quick
relaxation. Everything runs in the browser (static Vite + Three.js + RDKit.js +
openchemlib); nothing to install.

- **Live app:** https://kenichinomura.github.io/PolymerARLab/
- **Illustrated tutorial (with the real icons/diagrams):** https://kenichinomura.github.io/PolymerARLab/tutorial.html

Works on **desktop** and **mobile** — on a phone you scan with the live camera;
on a computer you upload a photo.

---

## Features

1. **Hand-drawn Lewis structure scanner** — photograph/scan a drawing and get a 3-D model.
2. **Polymer chain generation** — pick two backbone anchor atoms on a monomer and tile it into a chain.
3. **PubChem download** — load any molecule by name or CID with real 3-D coordinates.
4. **LAMMPS input generation** — export a self-contained UFF-style data file + run script to relax the structure.
5. **Augmented reality** — place the molecule on a real surface (iPhone AR Quick Look / Android WebXR).

---

## Using the app

### Interface overview

The 3-D molecule fills the screen; controls sit in the corners.

**Top-left tool icons**

| Icon | Name | What it does |
| --- | --- | --- |
| 📷 | **Camera** | Turn the live camera on/off to scan a drawing (mainly phones). Lights up when active. |
| ↺ | **Reset view** | Recenter the camera on the molecule. |
| 🗑 | **Clear** | Remove the current molecule; start blank. |
| ⬡ | **AR View** | iPhone/iPad: open in AR Quick Look to place on a real surface (glows amber when ready). Desktop: downloads a `.usdz`. |

Capture happens by **tapping the on-screen frame** while the camera is on (see below) — there's no separate capture button.

**Bottom-left dock**

| Icon | Name | What it does |
| --- | --- | --- |
| ✏️ | **Edit** | Open/close the main control panel. |
| ⓘ | **Status** | Show/hide the molecule summary (atoms, bonds, bond orders) + valence check. |
| 📖 | **Tutorial** | Open the illustrated tutorial page. |

**Top-right:** the WebXR **AR** button ("START AR" on Android; "AR NOT SUPPORTED" on iPhone/desktop).

**Inside the Edit panel:** Upload sketch · PubChem name/CID + Load · **Atom labels** and **Show hydrogens** toggles · **Save LAMMPS (UFF)** · **Make Polymer from Monomer** (Anchor 1/Anchor 2 + Make repeat unit + Repeats slider).

---

### ① Scan a hand-drawn Lewis structure & view it in AR

1. **Draw a Lewis structure** on paper — clear bond lines and element letters recognize best (water, CO₂, ethanol, …).
2. **Capture it.**
   - 📱 **Phone:** tap **Camera**, position the drawing inside the on-screen frame (drag its edges to resize, drag the body to move it), then **tap the frame** to capture.
   - 🖥️ **Desktop:** tap **Edit → Upload sketch** and choose a photo.
   - A shutter flash + "Recognizing…" spinner show while it works; the 3-D molecule then appears.
3. **Explore** — drag to orbit, scroll/pinch to zoom, **Reset view** to recenter. Toggle **Atom labels** / **Show hydrogens**; open **Status** for atom/bond counts. **Clear** starts over.
4. **See it in AR — the molecule comes out of the paper.**
   - 📱 **iPhone/iPad:** tap the **AR View** icon, wait for it to glow amber, tap again to open AR Quick Look, then aim at your paper and place it.
   - 🤖 **Android:** tap **START AR** (top-right), aim at the paper, and tap to grow the molecule out of that spot.

> AR needs a rear camera and a secure (`https://`) page. Without AR you still get the full interactive 3-D view.

Recognition uses **AI (Claude vision, optional)** when configured, otherwise a **free on-device recognizer** — see [AI recognition](#ai-recognition-optional).

---

### ② Download a monomer, build a polymer, export LAMMPS

1. **Load a monomer.** In **Edit → PubChem**, type a name or CID (e.g. `ethylene`, `styrene`, `2244`) and press **Load**.
2. **Turn on Atom labels** so each atom shows its label (C1, C2, O1, …).
3. **Open "Make Polymer from Monomer."** Pick **Anchor 1** and **Anchor 2** — the two backbone atoms (for a vinyl monomer, the two C=C carbons) — and press **Make repeat unit**. The double bond opens and the unit tiles into a chain (side groups spiral around the backbone to avoid overlap; bonds keep their natural length).
4. **Set the chain length** with the **Repeats** slider.
5. **Export for LAMMPS.** Press **Save LAMMPS (UFF)**. Two files download:
   - `<name>.data` — atoms, bonds, and a **self-contained UFF-style force field** (no external force-field file needed).
   - `in.relax` — the run script.
6. **Relax it.** Run `lmp -in in.relax`. It does an overlap-relief warm-up → **FIRE** energy minimization → **NVT at 300 K for 10 ps**, and writes:
   - `<name>.min.xyz` (minimization trajectory), `<name>.nvt.xyz` (NVT trajectory), and `<name>.relaxed.data` (final structure).

> Keep **Show hydrogens** on before saving — the export includes every hydrogen and caps the chain ends, so the polymer is a complete molecule. The force field is generic (UFF-style, approximate): great for a reasonable geometry, not precise energetics.

---

### Tips

- **Scanning:** good light and clear pen strokes help; check the **Status** panel's summary/valence note and redraw if it's off.
- **AR:** needs a rear camera + `https://`. iPhone/iPad = **AR View** icon (Quick Look); Android = **START AR** (WebXR).
- **Reset vs Clear:** **Reset view** only recenters the camera; **Clear** removes the molecule.

---

## Local development

```bash
npm ci
npm run dev        # HTTPS dev server (WebXR/camera need HTTPS)
npm run dev:http   # HTTP dev server for local-network testing
npm run build      # static build into dist/
npm run preview    # serve the build
```

RDKit.js (`public/vendor/rdkit`) and openchemlib resources
(`public/vendor/openchemlib`) are vendored, so chemistry works with no backend;
a lightweight parser is the fallback if RDKit can't load.

### GitHub Pages

The build uses a relative Vite base path. `.github/workflows/deploy-pages.yml`
deploys on push to `main` (set the repo's Pages source to **GitHub Actions**);
`public/tutorial.html` deploys alongside the app.

---

## AI recognition (optional)

The static site never holds an API key — a Cloudflare Worker (`worker/`) proxies
to the Claude API:

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AI_ACCESS_TOKEN   # a shared passphrase so strangers can't spend your credits
npx wrangler deploy
```

Enable AI scanning **per device** by opening `https://<your-site>/?aitoken=<passphrase>`
once (persisted in `localStorage`; `?aitoken=off` forgets it). Devices without
the token automatically use the free on-device recognizer, and the Worker
rejects tokenless requests with `401` **before** any billable API call. It
**fails closed**: if the `AI_ACCESS_TOKEN` secret is missing, every request is
rejected with `503` rather than falling open. The
endpoint defaults to `DEFAULT_AI_ENDPOINT` in `src/aiRecognition.ts` and can be
overridden with `?ai=<url>` (`?ai=off` disables, `?ai=default` restores). Model
defaults to `claude-opus-4-8`; set the Worker `MODEL` var to `claude-haiku-4-5`
for cheaper scans, and list your origin in `ALLOWED_ORIGINS`.

---

## How it works (brief)

- **3-D geometry:** openchemlib's torsion-library conformer generator
  (`src/conformer3d.ts`); PubChem molecules keep their own coordinates; C60 ships
  baked. VSEPR (`src/vseprGeometry.ts`) is the instant fallback.
- **Polymer tiling:** repeat units align along the backbone axis and rotate about
  it to avoid side-group overlap; chain ends are H-capped.
- **LAMMPS export:** `src/lammpsExport.ts` derives the topology and a generic
  UFF-style force field (per-element LJ, bond r₀/K from UFF radii/charges, harmonic
  angles, weak torsions, sp² impropers).

## License

MIT License. See [LICENSE](LICENSE).
