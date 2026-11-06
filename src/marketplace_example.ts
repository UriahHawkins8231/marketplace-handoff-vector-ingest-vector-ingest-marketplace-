import { createMarketplaceGateway } from "./infrai_marketplace.js";
import { chunkMarketplaceDocuments, ingestRequestSchema } from "./marketplace_chunks.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the example");

const input = ingestRequestSchema.parse({
  collection: "marketplace-orders",
  order_id: "order_1042",
  documents: [
    { kind: "seller_asset", asset_id: "asset_brand", title: "Brand files", body: "Logo files are in the delivery archive.\n\nUse the dark mark on light backgrounds." },
    { kind: "buyer_update", update_id: "update_copy", title: "Copy approval", body: "The buyer approved the shorter headline and asked to keep the original call to action." },
    { kind: "order_handoff", handoff_id: "handoff_final", title: "Final delivery", body: "Delivered: source archive and export set. Accepted by buyer on 2026-09-09." },
  ],
});

const chunks = chunkMarketplaceDocuments(input.order_id, input.documents);
const gateway = createMarketplaceGateway(apiKey);
await gateway.ingest(input.collection, chunks);
const matches = await gateway.search(input.collection, input.order_id, "Which files did the buyer accept?", 3);
console.log(JSON.stringify({ order_id: input.order_id, indexed_chunks: chunks.length, matches }, null, 2));
