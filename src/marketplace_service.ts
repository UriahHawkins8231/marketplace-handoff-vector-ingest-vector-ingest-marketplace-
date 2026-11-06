import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, createMarketplaceGateway } from "./infrai_marketplace.js";
import { chunkMarketplaceDocuments, ingestRequestSchema, searchRequestSchema } from "./marketplace_chunks.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const gateway = createMarketplaceGateway(apiKey);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const buffer = Buffer.from(part);
    size += buffer.length;
    if (size > 1_000_000) throw new RequestError("Request body is too large", 413);
    parts.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new RequestError("Request body must be valid JSON", 400);
  }
}

class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/ingest") {
      const input = ingestRequestSchema.parse(await readJson(request));
      const chunks = chunkMarketplaceDocuments(input.order_id, input.documents);
      await gateway.ingest(input.collection, chunks);
      send(response, 201, {
        order_id: input.order_id,
        indexed_chunks: chunks.length,
        handoff_ready: chunks.some((chunk) => chunk.metadata.kind === "order_handoff"),
      });
      return;
    }
    if (request.method === "POST" && request.url === "/search") {
      const input = searchRequestSchema.parse(await readJson(request));
      const matches = await gateway.search(input.collection, input.order_id, input.query, input.top_k);
      send(response, 200, { order_id: input.order_id, matches });
      return;
    }
    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError) {
      send(response, 400, { error: "Invalid request", issues: error.issues });
    } else if (error instanceof RequestError) {
      send(response, error.status, { error: error.message });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.message, detail: error.detail });
    } else {
      send(response, 500, { error: "Unexpected service error" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Marketplace ingest service listening on http://localhost:${port}`));
