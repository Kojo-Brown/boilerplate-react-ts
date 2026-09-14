import type { ClientMessage } from "@/shared/offline/messages";

/**
 * The page's half of the service worker lifecycle.
 *
 * Registration is one call; everything else here exists because an update is
 * not. A new worker installs while the old one is still controlling every open
 * tab, and it stays in `waiting` until every one of those tabs is closed —
 * which, for an application people leave open, is never. The three pieces
 * below are what turn that into an update a user can take: noticing the
 * waiting worker, telling it to take over, and reloading once it has.
 */

export interface ServiceWorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
}

export interface ServiceWorkerRegistrationLike {
  readonly installing: ServiceWorkerLike | null;
  readonly waiting: ServiceWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

export interface ServiceWorkerContainerLike {
  readonly controller: ServiceWorkerLike | null;
  register(
    scriptUrl: string,
    options?: { scope?: string; updateViaCache?: "none" | "imports" | "all" },
  ): Promise<ServiceWorkerRegistrationLike>;
  addEventListener(type: "controllerchange", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface RegisterOptions {
  readonly container: ServiceWorkerContainerLike;
  /** Defaults to the root-scoped `/sw.js` the build emits. */
  readonly scriptUrl?: string;
  /**
   * Called when a new worker has installed and is waiting for the old one to
   * release control. The application decides what to do about it — this module
   * deliberately does not reload on its own, because a page that reloads
   * underneath a half-filled form has turned a silent improvement into lost
   * work.
   */
  readonly onUpdateReady?: (registration: ServiceWorkerRegistrationLike) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * Registers the worker and reports updates.
 *
 * `updateViaCache: "none"` is the load-bearing option. By default the browser
 * may serve `sw.js` itself from the HTTP cache, so a worker with a one-year
 * `Cache-Control` — which is what a static host gives every file under a CDN —
 * can pin an application to a build for as long as that header says. With
 * `"none"`, `sw.js` is always revalidated against the network, which is the
 * only way the update check can see a new build.
 *
 * The scope is `/` because the worker answers navigations, and a worker's
 * scope limits which navigations it may answer: registered from `/assets/`, it
 * would control nothing a user ever visits.
 */
export async function registerServiceWorker(
  options: RegisterOptions,
): Promise<ServiceWorkerRegistrationLike | null> {
  const { container, onUpdateReady, onError } = options;
  const scriptUrl = options.scriptUrl ?? "/sw.js";

  try {
    const registration = await container.register(scriptUrl, {
      scope: "/",
      updateViaCache: "none",
    });

    // A worker can already be waiting when this runs: the update installed
    // during a previous visit and nothing has taken it since. Without this
    // check the callback only ever fires for an update that happens to install
    // while the page is open, which is the minority of them.
    if (registration.waiting !== null && container.controller !== null) {
      onUpdateReady?.(registration);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (installing === null) return;
      installing.addEventListener("statechange", () => {
        // `installed` with no controller is the *first* install on this
        // origin, not an update. Announcing it would show "a new version is
        // available" to someone who just loaded the version in question.
        if (installing.state === "installed" && container.controller !== null) {
          onUpdateReady?.(registration);
        }
      });
    });

    return registration;
  } catch (error) {
    // A failed registration must not break the page. It is a progressive
    // enhancement: the application works without it, slower and online-only.
    onError?.(error);
    return null;
  }
}

/** Tells a waiting worker to take over now. */
export function activateUpdate(registration: ServiceWorkerRegistrationLike): void {
  const message: ClientMessage = { type: "SKIP_WAITING" };
  registration.waiting?.postMessage(message);
}

/**
 * Reloads the page once a *new* worker takes control.
 *
 * Two guards, and each of them is a bug that ships without it.
 *
 * **Only when the page was already controlled.** `activate` calls
 * `clients.claim()`, which takes control of the page that caused the install —
 * and that is a `controllerchange` too. Reloading on it means every first
 * visit to the application reloads itself once, halfway through rendering,
 * for no reason a user could infer. The distinction is not "is there a
 * controller now" but "was there one before": an uncontrolled page is running
 * the same build the new worker just cached, so there is nothing to reload
 * *for*.
 *
 * **At most once.** A reload can produce another `controllerchange`, and the
 * result is a tab that flashes forever. It is reported against every service
 * worker library that ever shipped without this flag.
 */
export function reloadOnControllerChange(
  container: ServiceWorkerContainerLike,
  reload: () => void,
): void {
  const wasControlled = container.controller !== null;
  let reloaded = false;
  container.addEventListener("controllerchange", () => {
    if (!wasControlled || reloaded) return;
    reloaded = true;
    reload();
  });
}

/** Sends a message to the worker currently controlling this page. */
export function postToServiceWorker(
  container: ServiceWorkerContainerLike,
  message: ClientMessage,
): boolean {
  const controller = container.controller;
  if (controller === null) return false;
  controller.postMessage(message);
  return true;
}

/**
 * `navigator.serviceWorker`, or `null` where there is none.
 *
 * Absent in more places than "old browsers": every private window in Firefox,
 * any page served over plain HTTP other than `localhost`, and jsdom. Each of
 * them is a context where the application must still work.
 */
export function getServiceWorkerContainer(): ServiceWorkerContainerLike | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker;
}
