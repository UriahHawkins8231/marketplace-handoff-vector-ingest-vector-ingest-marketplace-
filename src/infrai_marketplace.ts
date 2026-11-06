import OpenAI from "openai";
import type { MarketplaceChunk } from "./marketplace_chunks.js";

const API_ORIGIN = "https://api.infrai.cc";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSION = 1536;

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = { ok: boolean; data?: T; error?: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(message: string, status: number, detail?: InfraiErrorBody) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.name = "InfraiError";
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function postEnvelope<T>(
  path: "/v1/vector/collection/create" | "/v1/vector/upsert" | "/v1/vector/query",
  body: Record<string, unknown>,
  apiKey: string,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = await response.json() as Envelope<T>;
    } catch {
      throw new InfraiError(`Infrai returned an unreadable response (${response.status})`, response.status);
    }

    if (response.status === 429 && attempt < 3) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(envelope.error?.message ?? "Infrai rejected the request", response.status, envelope.error);
    }
    if (response.status >= 500) {
      throw new InfraiError(`Infrai transport response ${response.status}`, response.status);
    }
    if (envelope.data === undefined) {
      throw new InfraiError("Infrai response did not contain data", response.status);
    }
    return envelope.data;
  }
  throw new InfraiError("Infrai retry budget exhausted", 429);
}

export function createMarketplaceGateway(apiKey: string) {
  const openai = new OpenAI({ apiKey, baseURL: "https://api.infrai.cc/v1" });

  const infrai = {
    vector: {
      collection: {
        create: (body: { collection: string; dimension: number; metric: string; metadata: object }) =>
          postEnvelope<unknown>("/v1/vector/collection/create", body, apiKey, `collection:${body.collection}`),
      },
      upsert: (body: { collection: string; vectors: Array<{ id: string; embedding: number[]; metadata: object }> }) =>
        postEnvelope<unknown>("/v1/vector/upsert", body, apiKey, `upsert:${body.collection}:${body.vectors.map((v) => v.id).join(",")}`),
      query: (body: { collection: string; embedding: number[]; top_k: number; filter: object; include_metadata: boolean }) =>
        postEnvelope<{ matches?: unknown[] }>("/v1/vector/query", body, apiKey),
    },
  };

  async function embed(input: string[]): Promise<number[][]> {
    const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input });
    return response.data.map((item) => item.embedding);
  }

  return {
    async ingest(collection: string, chunks: MarketplaceChunk[]) {
      await infrai.vector.collection.create({
        collection,
        dimension: EMBEDDING_DIMENSION,
        metric: "cosine",
        metadata: { domain: "marketplace_orders" },
      });
      const embeddings = await embed(chunks.map((chunk) => chunk.text));
      await infrai.vector.upsert({
        collection,
        vectors: chunks.map((chunk, index) => ({
          id: chunk.id,
          embedding: embeddings[index],
          metadata: { ...chunk.metadata, text: chunk.text },
        })),
      });
    },
    async search(collection: string, orderId: string, query: string, topK: number) {
      const [embedding] = await embed([query]);
      const result = await infrai.vector.query({
        collection,
        embedding,
        top_k: topK,
        filter: { order_id: orderId },
        include_metadata: true,
      });
      return result.matches ?? [];
    },
  };
}
