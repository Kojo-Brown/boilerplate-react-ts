import { describe, it, expect, vi } from "vitest";
import {
  activateUpdate,
  getServiceWorkerContainer,
  postToServiceWorker,
  registerServiceWorker,
  reloadOnControllerChange,
} from "@/shared/offline/registerServiceWorker";
import {
  createFakeContainer,
  createFakeRegistration,
  createFakeWorker,
} from "@/test/serviceWorker";

describe("registerServiceWorker", () => {
  it("registers at the root scope with the HTTP cache bypassed", async () => {
    const container = createFakeContainer({});
    await registerServiceWorker({ container });

    // `updateViaCache: "none"` is what lets an update be noticed at all: a
    // `sw.js` served with a long `Cache-Control` — which is what a CDN gives
    // every static file — otherwise pins the application to one build.
    expect(container.registrations).toEqual([
      { scriptUrl: "/sw.js", options: { scope: "/", updateViaCache: "none" } },
    ]);
  });

  it("registers a caller-supplied script", async () => {
    const container = createFakeContainer({});
    await registerServiceWorker({ container, scriptUrl: "/custom-sw.js" });
    expect(container.registrations[0]?.scriptUrl).toBe("/custom-sw.js");
  });

  it("announces a worker that was already waiting from a previous visit", async () => {
    const registration = createFakeRegistration({ waiting: createFakeWorker("installed") });
    const container = createFakeContainer({
      registration,
      controller: createFakeWorker("activated"),
    });
    const onUpdateReady = vi.fn();

    await registerServiceWorker({ container, onUpdateReady });

    // The common case in practice: the update installed during an earlier
    // visit and nothing has taken it. Only checking `updatefound` would miss
    // every one of those.
    expect(onUpdateReady).toHaveBeenCalledWith(registration);
  });

  it("announces an update that installs while the page is open", async () => {
    const registration = createFakeRegistration();
    const container = createFakeContainer({
      registration,
      controller: createFakeWorker("activated"),
    });
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, onUpdateReady });

    const installing = createFakeWorker("installing");
    registration.startInstalling(installing);
    expect(onUpdateReady).not.toHaveBeenCalled();

    installing.setState("installed");
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it("does not call a first install an update", async () => {
    // `installed` with no controller means this origin had no worker a moment
    // ago. Announcing it shows "a new version is available" to somebody who
    // just loaded the version in question.
    const registration = createFakeRegistration();
    const container = createFakeContainer({ registration, controller: null });
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, onUpdateReady });

    const installing = createFakeWorker("installing");
    registration.startInstalling(installing);
    installing.setState("installed");

    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it("ignores an `updatefound` with nothing installing", async () => {
    const registration = createFakeRegistration();
    const container = createFakeContainer({ registration, controller: createFakeWorker() });
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, onUpdateReady });

    registration.startInstalling(null);

    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it("reports a failed registration without throwing", async () => {
    // Offline support is progressive enhancement. A registration that fails —
    // an insecure origin, a private window, a 404 on `/sw.js` — must leave an
    // application that still works, online and slower.
    const error = new Error("SecurityError");
    const container = createFakeContainer({ failWith: error });
    const onError = vi.fn();

    await expect(registerServiceWorker({ container, onError })).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(error);
  });
});

describe("activateUpdate", () => {
  it("tells the waiting worker to take over", () => {
    const waiting = createFakeWorker("installed");
    activateUpdate(createFakeRegistration({ waiting }));
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("does nothing when no worker is waiting", () => {
    expect(() => {
      activateUpdate(createFakeRegistration());
    }).not.toThrow();
  });
});

describe("reloadOnControllerChange", () => {
  it("reloads when a new worker replaces the one in control", () => {
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);

    container.takeControl(createFakeWorker("activated"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload the page that installed the worker", () => {
    // `activate` calls `clients.claim()`, which takes control of the page that
    // caused the install — and that is a `controllerchange`. Reloading on it
    // makes every first visit reload itself once, halfway through rendering.
    // Found by `e2e/offline.spec.ts`, which could not evaluate anything in a
    // page that kept navigating out from under it.
    const container = createFakeContainer({ controller: null });
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);

    container.takeControl(createFakeWorker("activated"));

    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads at most once", () => {
    // Without the guard this is the reload loop every service worker library
    // has shipped at least once: the reload produces another
    // `controllerchange`, which produces another reload.
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);

    container.takeControl(createFakeWorker("activated"));
    container.takeControl(createFakeWorker("activated"));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("postToServiceWorker", () => {
  it("posts to the controlling worker", () => {
    const controller = createFakeWorker("activated");
    const container = createFakeContainer({ controller });

    expect(postToServiceWorker(container, { type: "REPLAY_QUEUE" })).toBe(true);
    expect(controller.messages).toEqual([{ type: "REPLAY_QUEUE" }]);
  });

  it("reports that there was nobody to post to", () => {
    // True on the first visit, before the worker has claimed the page — and
    // the caller has to be able to tell that apart from a delivered message.
    expect(postToServiceWorker(createFakeContainer({}), { type: "QUEUE_STATUS" })).toBe(false);
  });
});

describe("getServiceWorkerContainer", () => {
  it("is null where the browser has no service worker", () => {
    // jsdom is one such place, which is also why every test above injects a
    // container rather than reaching for this.
    expect(getServiceWorkerContainer()).toBeNull();
  });
});
