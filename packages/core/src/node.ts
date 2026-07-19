import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Breadcrumb } from "./index.js";

type Handler = (request: Request) => Promise<Response>;

/** Bridge a node req/res pair to the fetch-native handler. */
export function toNodeHandler(input: Breadcrumb | Handler) {
  const handler = typeof input === "function" ? input : input.handler;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? "localhost";
    const url = `http://${host}${req.url ?? "/"}`;
    const method = req.method ?? "GET";

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : (Readable.toWeb(req) as unknown as ReadableStream);

    const request = new Request(url, {
      method,
      headers,
      body,
      // @ts-expect-error required by undici for streaming bodies
      duplex: "half",
    });

    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      Readable.fromWeb(response.body as any).pipe(res);
    } else {
      res.end();
    }
  };
}
