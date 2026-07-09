// PubChem PUG-REST client. PubChem serves `Access-Control-Allow-Origin: *`, so
// the browser fetches structures directly — no proxy or API key. A load makes
// at most three requests (CID resolve, SDF, title), within PubChem's <=5 req/s
// guidance.

const PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

export interface PubChemCompound {
  cid: number;
  sdf: string;
  is3d: boolean;
  title: string;
}

// A bare number is treated as a CID; anything else is looked up as a name.
export async function resolveCid(query: string): Promise<number> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Enter a PubChem name or CID.");
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const response = await fetchText(`${PUBCHEM_BASE}/compound/name/${encodeURIComponent(trimmed)}/cids/TXT`);
  if (!response.ok) {
    if (response.status === 404) throw new Error(`No PubChem match for "${trimmed}".`);
    throw new Error(`PubChem name lookup failed (HTTP ${response.status}).`);
  }
  const cid = Number(response.text.split("\n")[0]?.trim());
  if (!Number.isFinite(cid) || cid <= 0) throw new Error(`No PubChem match for "${trimmed}".`);
  return cid;
}

export async function fetchCompound(cid: number): Promise<PubChemCompound> {
  let is3d = true;
  let sdfResponse = await fetchText(`${PUBCHEM_BASE}/compound/cid/${cid}/record/SDF?record_type=3d`);
  if (!sdfResponse.ok) {
    // Some records have no precomputed 3D conformer; fall back to 2D and let the
    // caller regenerate geometry.
    is3d = false;
    sdfResponse = await fetchText(`${PUBCHEM_BASE}/compound/cid/${cid}/record/SDF?record_type=2d`);
  }
  if (!sdfResponse.ok) {
    if (sdfResponse.status === 404) throw new Error(`PubChem has no structure record for CID ${cid}.`);
    throw new Error(`PubChem structure download failed (HTTP ${sdfResponse.status}).`);
  }

  const titleResponse = await fetchText(`${PUBCHEM_BASE}/compound/cid/${cid}/property/Title/TXT`).catch(() => null);
  const title = titleResponse?.ok ? titleResponse.text.split("\n")[0]?.trim() || `PubChem CID ${cid}` : `PubChem CID ${cid}`;

  return { cid, sdf: sdfResponse.text, is3d, title };
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not reach PubChem: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}
