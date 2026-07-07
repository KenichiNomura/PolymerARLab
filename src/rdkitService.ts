import type { StructureImportFormat } from "./structureImport";

type RDKitLoader = (options?: { locateFile?: (path: string) => string }) => Promise<RDKitModule>;

interface RDKitModule {
  get_mol(input: string, detailsJson?: string): JSMol | null;
  prefer_coordgen(prefer: boolean): void;
  version(): string;
}

interface JSMol {
  delete(): void;
  get_molblock(): string;
  get_new_coords(useCoordGen?: boolean): string;
  get_smiles(): string;
  has_coords(): boolean;
  is_valid(): boolean;
  set_new_coords(useCoordGen?: boolean): boolean;
}

declare global {
  interface Window {
    initRDKitModule?: RDKitLoader;
  }
}

export class RDKitImportError extends Error {
  constructor(
    message: string,
    readonly kind: "load" | "validation",
  ) {
    super(message);
    this.name = "RDKitImportError";
  }
}

export interface RDKitStatus {
  version: string;
}

export interface RDKitNormalization {
  input: string;
  format: "molfile";
  messages: string[];
}

let rdkitPromise: Promise<RDKitModule> | null = null;
let scriptPromise: Promise<void> | null = null;

export async function preloadRDKit(): Promise<RDKitStatus> {
  const module = await loadRDKitModule();
  return { version: module.version() };
}

export async function normalizeStructureWithRDKit(
  rawInput: string,
  format: StructureImportFormat,
): Promise<RDKitNormalization | null> {
  const source = rawInput.trim();
  if (!source || shouldSkipRDKit(source, format)) return null;

  const module = await loadRDKitModule();
  let mol: JSMol | null = null;

  try {
    mol = module.get_mol(source);
    if (!mol) {
      throw new RDKitImportError("RDKit could not parse this structure.", "validation");
    }
    if (!mol.is_valid()) {
      throw new RDKitImportError("RDKit found an invalid molecular structure.", "validation");
    }

    const hadCoords = mol.has_coords();
    const molblock = molfileWithCoordinates(mol, hadCoords);
    const canonicalSmiles = safeCall(() => mol?.get_smiles() ?? "");
    const label = inputLabel(source, format);
    const messages = [
      `RDKit.js ${module.version()} accepted ${label}.`,
      hadCoords ? "Used supplied 2D coordinates." : "Generated 2D coordinates in the browser.",
    ];
    if (canonicalSmiles) messages.push(`Canonical SMILES: ${canonicalSmiles}.`);

    return {
      input: label === "SMILES" ? withMolblockName(molblock, source) : molblock,
      format: "molfile",
      messages,
    };
  } finally {
    mol?.delete();
  }
}

async function loadRDKitModule(): Promise<RDKitModule> {
  if (!rdkitPromise) {
    rdkitPromise = loadRDKitScript()
      .then(async () => {
        if (!window.initRDKitModule) {
          throw new RDKitImportError("RDKit loader script did not initialize.", "load");
        }
        const module = await window.initRDKitModule({
          locateFile: (path) => rdkitAssetUrl(path),
        });
        module.prefer_coordgen(true);
        return module;
      })
      .catch((error) => {
        rdkitPromise = null;
        if (error instanceof RDKitImportError) throw error;
        throw new RDKitImportError(`RDKit.js could not load: ${(error as Error).message || String(error)}`, "load");
      });
  }
  return rdkitPromise;
}

function loadRDKitScript(): Promise<void> {
  if (window.initRDKitModule) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-rdkit-loader="true"]');
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("RDKit script failed to load.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = rdkitAssetUrl("RDKit_minimal.js");
      script.async = true;
      script.dataset.rdkitLoader = "true";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error("RDKit script failed to load.")), { once: true });
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw new RDKitImportError(`RDKit.js could not load: ${(error as Error).message || String(error)}`, "load");
    });
  }
  return scriptPromise;
}

function molfileWithCoordinates(mol: JSMol, hadCoords: boolean) {
  if (hadCoords) return requireMolblock(mol.get_molblock());

  // Do not trim the result: the V2000 header starts with a blank name line,
  // and trimming it away breaks downstream Molfile header parsing.
  let generated = "";
  try {
    generated = mol.get_new_coords(true);
  } catch {
    generated = "";
  }
  if (generated.trim()) return requireMolblock(generated);

  mol.set_new_coords(true);
  return requireMolblock(mol.get_molblock());
}

// The V2000 title line (line 1) is blank in RDKit output; carrying the typed
// SMILES there gives the imported structure a readable display name.
function withMolblockName(molblock: string, name: string) {
  const lines = molblock.split("\n");
  lines[0] = name.slice(0, 80);
  return lines.join("\n");
}

function requireMolblock(value: string) {
  if (!value.trim()) {
    throw new RDKitImportError("RDKit did not return a Molfile for this structure.", "validation");
  }
  return value;
}

function shouldSkipRDKit(source: string, format: StructureImportFormat) {
  return format === "json" || (format === "auto" && /^[\[{]/.test(source));
}

function inputLabel(source: string, format: StructureImportFormat) {
  if (format === "smiles") return "SMILES";
  if (format === "molfile") return "Molfile";
  if (/V2000|V3000|M\s+END/.test(source)) return "Molfile";
  return "SMILES";
}

function rdkitAssetUrl(fileName: string) {
  const baseUrl = document.baseURI || window.location.href;
  return new URL(`vendor/rdkit/${fileName}`, baseUrl).toString();
}

function safeCall(callback: () => string) {
  try {
    return callback().trim();
  } catch {
    return "";
  }
}
