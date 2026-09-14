import { precacheName, RUNTIME_CACHE, SYNC_TAG } from "@/shared/offline/config";
import {
  handleMessage,
  handleRead,
  handleWrite,
  replayAndNotify,
  type WorkerEnvironment,
} from "@/shared/offline/handlers";
import { deleteStaleCaches, populatePrecache, precachedPathsOf } from "@/shared/offline/precache";
import { describeRequest, routeRequest } from "@/shared/offline/routing";
import { createIdbQueueStore, openQueueDb, type QueueStore } from "@/shared/offline/queueStore";
import type { ServiceWorkerScope } from "@/shared/offline/swScope";
import type { WorkerMessage } from "@/shared/offline/messages";

/**
 * The service worker's entry point.
 *
 * Wiring only, by design. This file is the one module that cannot be unit
 * tested — jsdom has no `ServiceWorkerGlobalScope`, no `caches` and no
 * `FetchEvent` — so it is excluded from coverage on the same grounds as
 * `src/app/main.tsx`, and it earns that exclusion by containing no decisions.
 * Every strategy, policy and branch is in `@/shared/offline`, where the tests
 * are; what is left here is the construction of one environment object and the
 * four listeners that hand events to it. `e2e/offline.spec.ts` drives the
 * result in a real browser, which is the only thing that can prove the wiring
 * itself is right.
 *
 * Built separately from the application — see `vite.sw.config.ts` — because a
 * worker is a second program with a second entry point, and it has to land at
 * `/sw.js` under an unhashed name at the root of the origin: a worker's scope
 * is limited by where its script is served from, and one served out of
 * `/assets/sw-a1b2c3.js` could control nothing.
 */

/** Injected at build time: the precache list, and a hash of it. */
declare const __PRECACHE_URLS__: readonly string[];
declare const __SW_BUILD_ID__: string;

// The one cast, explained at length in `@/shared/offline/swScope`.
const scope = globalThis as unknown as ServiceWorkerScope;

const PRECACHE = precacheName(__SW_BUILD_ID__);
const precachedPaths = precachedPathsOf(__PRECACHE_URLS__);

let storePromise: Promise<QueueStore> | null = null;

const env: WorkerEnvironment = {
  openCache: (name) => scope.caches.open(name),
  fetch: (request) => scope.fetch(request),
  store: () => {
    storePromise ??= openQueueDb(scope.indexedDB).then(createIdbQueueStore);
    return storePromise;
  },
  now: () => Date.now(),
  notify: notifyClients,
  requestSync: async () => {
    // `sync` is absent in Safari and Firefox and can be refused in Chromium.
    // `handleWrite` treats a rejection as a non-event; this is only the ask.
    await scope.registration.sync?.register(SYNC_TAG);
  },
  precacheName: PRECACHE,
  runtimeCacheName: RUNTIME_CACHE,
};

async function notifyClients(message: WorkerMessage): Promise<void> {
  // `includeUncontrolled` so the very first page — the one that triggered the
  // install and is not yet controlled — hears about its own queued writes.
  const clients = await scope.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) client.postMessage(message);
}

scope.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await scope.caches.open(PRECACHE);
      const report = await populatePrecache(cache, __PRECACHE_URLS__, env.fetch);
      if (report.failed.length > 0) {
        // Failing the install is the point: the previous worker keeps serving,
        // the browser retries later, and no user is left with a shell whose
        // scripts were never stored.
        throw new Error(
          `Precache incomplete: ${report.failed.map((f) => `${f.url} (${f.reason})`).join(", ")}`,
        );
      }
    })(),
  );
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await deleteStaleCaches(scope.caches, new Set([PRECACHE, RUNTIME_CACHE]));
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener("fetch", (event) => {
  const route = routeRequest(describeRequest(event.request), {
    origin: location.origin,
    precachedPaths,
  });

  if (route === "passthrough") return;

  if (route === "queue-write") {
    event.respondWith(handleWrite(env, event.request));
    return;
  }

  event.respondWith(
    (async () => {
      const result = await handleRead(env, route, event.request);
      // Inside the promise `respondWith` is already waiting on, so the event
      // is still extendable — and the revalidation needs its own extension or
      // it is killed with the worker the moment the response is delivered.
      event.waitUntil(result.done);
      return result.response;
    })(),
  );
});

scope.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    (async () => {
      const report = await replayAndNotify(env);
      // Rejecting is how Background Sync is asked to try again: the browser
      // re-fires the tag on its own schedule until the handler resolves or it
      // runs out of patience. Resolving with a non-empty queue would silently
      // end the retries.
      if (report.remaining > 0 && !event.lastChance) {
        throw new Error(`Offline queue not drained: ${report.remaining} remaining`);
      }
    })(),
  );
});

scope.addEventListener("message", (event) => {
  event.waitUntil(
    (async () => {
      const reply = (message: WorkerMessage): void => {
        const port = event.ports[0];
        if (port !== undefined) port.postMessage(message);
        else event.source?.postMessage(message);
      };
      if ((await handleMessage(env, event.data, reply)) === "skip-waiting") {
        await scope.skipWaiting();
      }
    })(),
  );
});
