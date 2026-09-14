import type {
  ServiceWorkerContainerLike,
  ServiceWorkerLike,
  ServiceWorkerRegistrationLike,
} from "@/shared/offline/registerServiceWorker";

/**
 * A `navigator.serviceWorker` that can be driven from a test.
 *
 * jsdom implements no service worker at all, and the parts of the lifecycle
 * worth testing are precisely the transitions — `updatefound`, then
 * `statechange` to `installed`, then `controllerchange` — so a fake that can
 * be told to fire them is the only way to reach them outside a browser.
 */

export interface FakeWorker extends ServiceWorkerLike {
  state: string;
  readonly messages: unknown[];
  setState(next: string): void;
}

export function createFakeWorker(state = "installing"): FakeWorker {
  const listeners = new Set<() => void>();
  const messages: unknown[] = [];
  return {
    state,
    messages,
    postMessage(message) {
      messages.push(message);
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    setState(next) {
      this.state = next;
      for (const listener of listeners) listener();
    },
  };
}

export interface FakeRegistration extends ServiceWorkerRegistrationLike {
  installing: FakeWorker | null;
  waiting: FakeWorker | null;
  /**
   * Fires `updatefound` with `installing` set to the given worker — or to
   * `null`, which is what the browser reports when the installing worker has
   * already moved on by the time the listener runs.
   */
  startInstalling(worker: FakeWorker | null): void;
}

export function createFakeRegistration(
  initial: { installing?: FakeWorker | null; waiting?: FakeWorker | null } = {},
): FakeRegistration {
  const listeners = new Set<() => void>();
  return {
    installing: initial.installing ?? null,
    waiting: initial.waiting ?? null,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    startInstalling(worker) {
      this.installing = worker;
      for (const listener of listeners) listener();
    },
  };
}

export interface FakeContainer extends ServiceWorkerContainerLike {
  controller: FakeWorker | null;
  readonly registrations: { scriptUrl: string; options: unknown }[];
  /** Simulates a new worker taking control. */
  takeControl(worker: FakeWorker): void;
  /** Simulates a message from the worker. */
  deliver(data: unknown): void;
}

export function createFakeContainer(options: {
  readonly registration?: ServiceWorkerRegistrationLike;
  readonly controller?: FakeWorker | null;
  readonly failWith?: Error;
}): FakeContainer {
  const controllerChange = new Set<() => void>();
  const messageListeners = new Set<(event: { data: unknown }) => void>();
  const registrations: { scriptUrl: string; options: unknown }[] = [];

  return {
    controller: options.controller ?? null,
    registrations,
    register(scriptUrl, registerOptions) {
      registrations.push({ scriptUrl, options: registerOptions });
      if (options.failWith !== undefined) return Promise.reject(options.failWith);
      return Promise.resolve(options.registration ?? createFakeRegistration());
    },
    addEventListener(type, listener) {
      if (type === "controllerchange") controllerChange.add(listener as () => void);
      else messageListeners.add(listener);
    },
    takeControl(worker) {
      this.controller = worker;
      for (const listener of controllerChange) listener();
    },
    deliver(data) {
      for (const listener of messageListeners) listener({ data });
    },
  };
}
