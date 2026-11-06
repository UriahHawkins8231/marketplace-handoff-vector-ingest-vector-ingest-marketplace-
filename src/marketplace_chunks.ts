import { createHash } from "node:crypto";
import { z } from "zod";

const documentBase = {
  title: z.string().min(1),
  body: z.string().min(1),
};

export const ingestRequestSchema = z.object({
  collection: z.string().min(1),
  order_id: z.string().min(1),
  documents: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("seller_asset"), asset_id: z.string().min(1), ...documentBase }),
    z.object({ kind: z.literal("buyer_update"), update_id: z.string().min(1), ...documentBase }),
    z.object({ kind: z.literal("order_handoff"), handoff_id: z.string().min(1), ...documentBase }),
  ])).min(1),
});

export const searchRequestSchema = z.object({
  collection: z.string().min(1),
  order_id: z.string().min(1),
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(20).default(5),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type MarketplaceDocument = IngestRequest["documents"][number];

export type MarketplaceChunk = {
  id: string;
  text: string;
  metadata: {
    order_id: string;
    kind: MarketplaceDocument["kind"];
    source_id: string;
    title: string;
    part: number;
  };
};

function sourceId(document: MarketplaceDocument): string {
  if (document.kind === "seller_asset") return document.asset_id;
  if (document.kind === "buyer_update") return document.update_id;
  return document.handoff_id;
}

function splitBody(body: string, maxCharacters: number): string[] {
  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= maxCharacters) {
      current += `\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkMarketplaceDocuments(
  orderId: string,
  documents: MarketplaceDocument[],
  maxCharacters = 900,
): MarketplaceChunk[] {
  return documents.flatMap((document) => {
    // A handoff is an audit unit. Splitting it can separate acceptance from the promised asset.
    const parts = document.kind === "order_handoff" ? [document.body.trim()] : splitBody(document.body, maxCharacters);
    return parts.map((text, index) => {
      const source_id = sourceId(document);
      const digest = createHash("sha256")
        .update(`${orderId}:${document.kind}:${source_id}:${index}`)
        .digest("hex")
        .slice(0, 24);
      return {
        id: digest,
        text: `${document.title}\n\n${text}`,
        metadata: { order_id: orderId, kind: document.kind, source_id, title: document.title, part: index },
      };
    });
  });
}
