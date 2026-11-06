import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarketplaceDocuments, ingestRequestSchema } from "../src/marketplace_chunks.js";

test("keeps the order handoff intact while splitting long seller material", () => {
  const request = ingestRequestSchema.parse({
    collection: "orders",
    order_id: "order_17",
    documents: [
      { kind: "seller_asset", asset_id: "asset_1", title: "Working notes", body: "First approved direction.\n\nSecond approved direction." },
      { kind: "order_handoff", handoff_id: "handoff_1", title: "Delivery receipt", body: "Archive delivered.\n\nBuyer acceptance recorded." },
    ],
  });

  const chunks = chunkMarketplaceDocuments(request.order_id, request.documents, 30);
  const sellerChunks = chunks.filter((chunk) => chunk.metadata.kind === "seller_asset");
  const handoffChunks = chunks.filter((chunk) => chunk.metadata.kind === "order_handoff");

  assert.equal(sellerChunks.length, 2);
  assert.equal(handoffChunks.length, 1);
  assert.match(handoffChunks[0].text, /Archive delivered\.\n\nBuyer acceptance recorded\./);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
});
