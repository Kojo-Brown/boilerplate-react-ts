/**
 * A backend for `offline.spec.ts`, and for nothing else.
 *
 * The offline queue's whole purpose is to send a write later, so proving it
 * works needs something that can accept one. The application's own API is
 * mocked in every other E2E spec with `page.route`, and that does not reach
 * here: a replayed write is issued by the *service worker*, after the page
 * that made it may be gone, and page-level interception never sees it.
 *
 * So the write has to be answered by a real server, and it has to be answered
 * same-origin — the worker deliberately refuses to queue a cross-origin write,
 * because someone else's API has not agreed to honour the idempotency key it
 * stamps. The route is: the browser asks `http://localhost:3100/api/…`, the
 * preview server proxies `/api` to `http://localhost:4000` (the proxy in
 * `vite.config.ts`, which `vite preview` inherits), and this answers.
 *
 * Run by `playwright.config.ts` as a third web server. Node runs it directly —
 * the same type-stripping the bundle-budget CLI relies on.
 */

import { createServer } from "node:http";

const PORT = Number(process.env["OFFLINE_API_PORT"] ?? 4000);

const server = createServer((request, response) => {
  const url = request.url ?? "/";

  // What Playwright polls to decide the server is up.
  if (request.method === "GET" && url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  // Everything else is a write the queue replayed. A 204 is the plainest
  // possible "accepted": no body to parse, nothing for the assertion to depend
  // on but the status the queue reads.
  //
  // The body is drained rather than ignored, because a request whose body is
  // never read leaves the socket half-consumed and the next one queued behind
  // it — which reads, from the test, as the replay hanging.
  request.resume();
  request.on("end", () => {
    response.writeHead(204).end();
  });
});

server.listen(PORT, () => {
  process.stdout.write(`offline E2E API listening on ${PORT}\n`);
});
