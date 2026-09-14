import { describe, it, expect, vi } from "vitest";
import { createOfflineClient, type StartOptions } from "@/shared/offline/offlineClient";
import {
  createFakeContainer,
  createFakeRegistration,
  createFakeWorker,
  type FakeContainer,
} from "@/test/serviceWorker";

interface Harness {
  readonly options: StartOptions;
  readonly emit: (type: "online" | "offline") => void;
  readonly reload: ReturnType<typeof vi.fn>;
}

function startOptions(container: FakeContainer | null, online = true): Harness {
  const listeners = new Map<string, (() => void)[]>();
  const reload = vi.fn();
  return {
    reload,
    options: {
      container,
      isOnline: () => online,
      listen: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      reload,
    },
    emit: (type) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

describe("createOfflineClient", () => {
  it("starts from the browser's own connectivity flag", async () => {
    const client = createOfflineClient();
    const { options } = startOptions(null, false);
    await client.start(options);
    expect(client.getState()).toEqual({ online: false, pending: 0, updateReady: false });
  });

  it("tracks going offline and coming back", async () => {
    const client = createOfflineClient();
    const { options, emit } = startOptions(createFakeContainer({}));
    await client.start(options);

    emit("offline");
    expect(client.getState().online).toBe(false);

    emit("online");
    expect(client.getState().online).toBe(true);
  });

  it("asks the worker to replay as soon as the network returns", async () => {
    // Background Sync may be absent (Safari, Firefox) or minutes away. A page
    // that has just seen the network come back is the most reliable trigger
    // there is.
    const controller = createFakeWorker("activated");
    const container = createFakeContainer({ controller });
    const client = createOfflineClient();
    const { options, emit } = startOptions(container);
    await client.start(options);
    controller.messages.length = 0;

    emit("online");

    expect(controller.messages).toEqual([{ type: "REPLAY_QUEUE" }]);
  });

  it("notifies subscribers only when the state actually changes", async () => {
    // `useSyncExternalStore` re-renders on every snapshot identity change, so
    // a store that publishes an equal-but-new object renders forever.
    const client = createOfflineClient();
    const listener = vi.fn();
    client.subscribe(listener);
    const { options, emit } = startOptions(createFakeContainer({}));
    await client.start(options);

    emit("offline");
    emit("offline");
    emit("offline");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying an unsubscribed listener", async () => {
    const client = createOfflineClient();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    const { options, emit } = startOptions(createFakeContainer({}));
    await client.start(options);

    unsubscribe();
    emit("offline");

    expect(listener).not.toHaveBeenCalled();
  });

  it("reads the pending count from the worker", async () => {
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    container.deliver({ type: "QUEUE_STATUS", pending: 4 });
    expect(client.getState().pending).toBe(4);

    container.deliver({ type: "QUEUE_REPLAYED", sent: 4, dropped: 0, pending: 0 });
    expect(client.getState().pending).toBe(0);
  });

  it("ignores a message that is not one of ours", async () => {
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    container.deliver({ type: "workbox-broadcast", payload: {} });

    expect(client.getState().pending).toBe(0);
  });

  it("asks the worker what it is holding, rather than waiting to be told", async () => {
    // A queue filled during a previous visit is otherwise invisible: the
    // worker only announces changes.
    const controller = createFakeWorker("activated");
    const container = createFakeContainer({ controller });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    expect(controller.messages).toEqual([{ type: "QUEUE_STATUS" }]);
  });

  it("surfaces a waiting update instead of applying it", async () => {
    const waiting = createFakeWorker("installed");
    const registration = createFakeRegistration({ waiting });
    const container = createFakeContainer({
      registration,
      controller: createFakeWorker("activated"),
    });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    expect(client.getState().updateReady).toBe(true);
    // Nothing has been told to take over: reloading a page under a half-filled
    // form is not an improvement.
    expect(waiting.messages).toEqual([]);

    client.applyUpdate();
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("reloads when the new worker takes control", async () => {
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    const { options, reload } = startOptions(container);
    await client.start(options);

    container.takeControl(createFakeWorker("activated"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing on `applyUpdate` before a registration exists", () => {
    expect(() => {
      createOfflineClient().applyUpdate();
    }).not.toThrow();
  });

  it("still tracks connectivity where there is no service worker", async () => {
    // A private window, an insecure origin, an old browser: the banner is
    // still worth showing, and nothing below it may throw.
    const client = createOfflineClient();
    const { options, emit } = startOptions(null);
    await client.start(options);

    emit("offline");

    expect(client.getState()).toEqual({ online: false, pending: 0, updateReady: false });
  });
});
