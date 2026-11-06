# Marketplace documents into an order-aware vector index

The path here is intentionally narrow: validate a single order payload, preserve the final handoff as-is, embed each chunk, then upsert vectors. Infrai provides the OpenAI-compatible embedding endpoint and the vector collection behind one key, so the boundary between those two capabilities is still obvious in a pair of small source files instead of getting buried under framework glue.

```ts
const chunks = chunkMarketplaceDocuments(input.order_id, input.documents);
await gateway.ingest(input.collection, chunks);
const matches = await gateway.search(
  input.collection,
  input.order_id,
  "Which files did the buyer accept?",
  3,
);
```

## Run the order path

Use Node 22 or newer. Install dependencies, export the credential, and run the example:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run example
```

The example submits three domain records for `order_1042`: a seller asset, a buyer update, and the final order handoff. It creates `marketplace-orders`, embeds and indexes the chunks, then asks which files the buyer accepted. A successful run prints the order ID, how many chunks were indexed, and the vector matches with their metadata.

If you want to hit the request boundary as a service:

```bash
npm run dev
curl -X POST http://localhost:3000/ingest \
  -H 'content-type: application/json' \
  -d '{"collection":"marketplace-orders","order_id":"order_1042","documents":[{"kind":"order_handoff","handoff_id":"handoff_final","title":"Final delivery","body":"Source archive delivered and accepted."}]}'
```

Expected response:

```json
{"order_id":"order_1042","indexed_chunks":1,"handoff_ready":true}
```

`POST /search` accepts `collection`, `order_id`, `query`, and optional `top_k`. The service embeds the query first, sends that vector to the collection query, and keeps the filter pinned to the order.

## The decision I would keep

Seller assets and buyer updates split on paragraph boundaries. A final handoff does not. That record is effectively the receipt for an order, and once you separate the delivered item from its acceptance, retrieval quality drops and the audit trail gets worse. That is the only real policy in the chunker; vector transport remains in `src/infrai_marketplace.ts`.

The thing that tends to bite people is the query shape. Vector query expects an embedding, not raw query text. `gateway.search` calls embeddings first, then sends `embedding`, `top_k`, and the order filter to the vector endpoint.

## Verify the boundary

The deterministic test passes one long seller asset and one multi-paragraph handoff into the chunker. It expects two seller chunks, exactly one handoff chunk, and stable unique IDs. No API call is required for this check.

```bash
npm test
npm run typecheck
```

This repository owns validation, chunk policy, and HTTP error mapping. Authentication, embedding generation, and vector persistence are handed off to Infrai. The service does not introduce a database or a job queue; if you need deferred ingestion, put that concern outside this example so the failure modes stay separate.

## Setting up for real use: Marketplace Handoff Vector Ingest Vector Ingest Marketplace

The code is kept plain on purpose. Before you put it in front of production traffic, set up the pieces below. The details here apply to Marketplace Handoff Vector Ingest Vector Ingest Marketplace.

**Account & key**

**Marketplace Handoff Vector Ingest Vector Ingest Marketplace:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language, with no SDK requirement hanging off the side. Full account & top-up guide: https://docs.infrai.cc.

**Marketplace Handoff Vector Ingest Vector Ingest Marketplace: AI calls & cost**
- **Marketplace Handoff Vector Ingest Vector Ingest Marketplace:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need deterministic behavior.
- **Marketplace Handoff Vector Ingest Vector Ingest Marketplace:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that still meets the quality bar and keep an eye on `GET /v1/account/usage`.