import Anthropic from "@anthropic-ai/sdk";

// Cloudflare Worker proxy: receives a sketch photo from the Polymer AR Lab
// browser app and asks Claude (vision) to transcribe the drawn structure as
// SMILES. The API key stays server-side; the static site only knows this
// Worker's URL.

interface Env {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  MODEL?: string;
  ALLOWED_ORIGINS?: string;
}

interface RecognizeRequest {
  image?: string;
  mediaType?: string;
}

const MAX_IMAGE_BASE64_LENGTH = 6_000_000; // ~4.5MB binary
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    smiles: {
      type: "string",
      description:
        "SMILES for the structure exactly as drawn, preserving any chemical mistakes. Empty string if no structure is legible.",
    },
    is_repeat_unit: {
      type: "boolean",
      description: "True when the sketch shows polymer repeat-unit brackets or an explicit n.",
    },
    repeat_count: {
      type: "integer",
      description: "The drawn degree of polymerization n, or 0 when absent/unreadable.",
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Short warnings about ambiguous letters, uncertain bonds, or chemistry errors in the drawing.",
    },
    confidence: {
      type: "number",
      description: "Overall transcription confidence from 0 to 1.",
    },
  },
  required: ["smiles", "is_repeat_unit", "repeat_count", "notes", "confidence"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You transcribe hand-drawn chemistry structures (Lewis structures and skeletal formulas) from classroom photos into SMILES.

Rules:
- Transcribe the structure exactly as drawn, including chemically incorrect bonding (the app's valence checker teaches students from their mistakes). For example, if the student drew C=O=C, return C=O=C, not O=C=O.
- Explicit drawn hydrogens may be folded into implicit SMILES hydrogens; do not add atoms that are not drawn.
- Supported elements: H, C, N, O, S, P, F, Cl, Br, I. If another element is clearly drawn, mention it in notes and leave it out of the SMILES only if unavoidable.
- Square brackets around the structure or a subscript n indicate a polymer repeat unit.
- If nothing legible is drawn, return an empty smiles with an explanatory note.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/recognize") {
      return json({ error: "POST /recognize" }, 404, cors);
    }
    if (!cors["Access-Control-Allow-Origin"]) {
      return json({ error: "Origin not allowed." }, 403, cors);
    }

    let body: RecognizeRequest;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON: { image, mediaType }." }, 400, cors);
    }

    const image = body.image ?? "";
    const mediaType = body.mediaType ?? "image/jpeg";
    if (!image || image.length > MAX_IMAGE_BASE64_LENGTH) {
      return json({ error: "Missing or oversized image (max ~4.5MB)." }, 400, cors);
    }
    if (!MEDIA_TYPES.has(mediaType)) {
      return json({ error: `Unsupported mediaType. Use one of: ${[...MEDIA_TYPES].join(", ")}.` }, 400, cors);
    }

    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      authToken: env.ANTHROPIC_AUTH_TOKEN ?? null,
    });

    try {
      const response = await client.messages.create({
        model: env.MODEL || "claude-opus-4-8",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        output_config: {
          format: {
            type: "json_schema",
            schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
                  data: image,
                },
              },
              {
                type: "text",
                text: "Transcribe this hand-drawn structure to SMILES following the rules.",
              },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") {
        return json({ error: "The model declined to read this image." }, 422, cors);
      }
      const text = response.content.find((block) => block.type === "text")?.text ?? "";
      const parsed = JSON.parse(text);
      return json(
        {
          smiles: String(parsed.smiles ?? ""),
          isRepeatUnit: Boolean(parsed.is_repeat_unit),
          repeatCount: Number(parsed.repeat_count) || 0,
          notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
          confidence: clamp01(Number(parsed.confidence)),
          model: response.model,
        },
        200,
        cors,
      );
    } catch (error) {
      const status = error instanceof Anthropic.APIError && typeof error.status === "number" ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: `Recognition failed: ${message}` }, status >= 400 && status < 600 ? 502 : 500, cors);
    }
  },
};

function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function json(payload: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
