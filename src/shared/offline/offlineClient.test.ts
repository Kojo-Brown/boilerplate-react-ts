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
    expect(client.getState()).toEqual({
      online: false,
      pending: 0,
      syncing: false,
      unsent: { count: 0, writes: [] },
      updateReady: false,
    });
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

  it("shows a replay in flight, and stops showing it when the worker answers", async () => {
    // `syncing` is not derivable from `pending`: "three changes waiting" is
    // true in the tunnel and true for the ten seconds after it, and only one
    // of those is a state where waiting is the right thing for a user to do.
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    const { options, emit } = startOptions(container);
    await client.start(options);
    container.deliver({ type: "QUEUE_STATUS", pending: 2 });

    emit("online");
    expect(client.getState().syncing).toBe(true);

    container.deliver({ type: "QUEUE_REPLAYED", sent: 2, dropped: 0, pending: 0, writes: [] });
    expect(client.getState()).toMatchObject({ syncing: false, pending: 0 });
  });

  it("does not claim to be syncing when there is no worker to ask", async () => {
    // No controller means `postMessage` reached nobody, and a spinner with
    // nothing on the other end of it never stops.
    const container = createFakeContainer({ controller: null });
    const client = createOfflineClient();
    const { options, emit } = startOptions(container);
    await client.start(options);

    emit("online");

    expect(client.getState().syncing).toBe(false);
  });

  it("stops showing a replay in flight when the connection drops again", async () => {
    // A replay interrupted by the network going away produces no
    // `QUEUE_REPLAYED` for the entries behind the one that failed, so nothing
    // else would ever clear this.
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    const { options, emit } = startOptions(container);
    await client.start(options);

    emit("online");
    expect(client.getState().syncing).toBe(true);

    emit("offline");
    expect(client.getState()).toMatchObject({ syncing: false, online: false });
  });

  it("replays on request, so a user can override the backoff", async () => {
    const controller = createFakeWorker("activated");
    const container = createFakeContainer({ controller });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    expect(client.replayNow()).toBe(true);

    expect(controller.messages).toEqual([{ type: "QUEUE_STATUS" }, { type: "REPLAY_QUEUE" }]);
    expect(client.getState().syncing).toBe(true);
  });

  it("reports that a requested replay went nowhere", async () => {
    // So the interface can decline to offer a button that would do nothing.
    const client = createOfflineClient();
    await client.start(startOptions(createFakeContainer({ controller: null })).options);

    expect(client.replayNow()).toBe(false);
  });

  it("keeps abandoned writes until they are acknowledged", async () => {
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    container.deliver({
      type: "QUEUE_REPLAYED",
      sent: 1,
      dropped: 1,
      pending: 0,
      writes: [
        { method: "POST", url: "/api/posts", fate: "sent", status: 201 },
        { method: "PUT", url: "/api/posts/3", fate: "rejected", status: 409 },
      ],
    });

    // Only the ones that did not make it: a delivered write is not a loss.
    expect(client.getState().unsent).toEqual({
      count: 1,
      writes: [{ method: "PUT", url: "/api/posts/3", fate: "rejected", status: 409 }],
    });

    client.dismissUnsent();
    expect(client.getState().unsent).toEqual({ count: 0, writes: [] });
  });

  it("accumulates abandoned writes across passes rather than replacing them", async () => {
    // An entry is reported once, at the moment it leaves the queue, so a
    // second pass carries nothing about the first one's losses. Rebuilding the
    // list from the latest message would erase them.
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    container.deliver({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 1,
      pending: 1,
      writes: [{ method: "POST", url: "/api/posts", fate: "exhausted" }],
    });
    container.deliver({
      type: "QUEUE_REPLAYED",
      sent: 0,
      dropped: 1,
      pending: 0,
      writes: [{ method: "DELETE", url: "/api/posts/1", fate: "expired" }],
    });

    expect(client.getState().unsent).toEqual({
      count: 2,
      writes: [
        { method: "POST", url: "/api/posts", fate: "exhausted" },
        { method: "DELETE", url: "/api/posts/1", fate: "expired" },
      ],
    });
  });

  it("counts abandoned writes a worker could not name", async () => {
    /*
      The version-skew case. A worker from the previous build reports how many
      it gave up on and not which, and the count is the part a user must not be
      denied — an application that quietly loses a write is worse than one that
      fails in front of them. So `count` moves and `writes` does not.
    */
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);

    container.deliver({ type: "QUEUE_REPLAYED", sent: 1, dropped: 2, pending: 0 });

    expect(client.getState().unsent).toEqual({ count: 2, writes: [] });
  });

  it("announces each replay to `onReplay` exactly once", async () => {
    /*
      Two passes that each send one write leave `pending` at zero both times,
      so a consumer diffing state snapshots sees the second one not at all —
      which is why an invalidation hangs off an event rather than off
      `subscribe`.
    */
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);
    const seen: unknown[] = [];
    const unsubscribe = client.onReplay((event) => seen.push(event));

    const pass = {
      type: "QUEUE_REPLAYED",
      sent: 1,
      dropped: 0,
      pending: 0,
      writes: [{ method: "POST", url: "/api/posts", fate: "sent", status: 201 }],
    };
    container.deliver(pass);
    container.deliver(pass);

    expect(seen).toEqual([
      {
        sent: 1,
        dropped: 0,
        pending: 0,
        writes: [{ method: "POST", url: "/api/posts", fate: "sent", status: 201 }],
      },
      {
        sent: 1,
        dropped: 0,
        pending: 0,
        writes: [{ method: "POST", url: "/api/posts", fate: "sent", status: 201 }],
      },
    ]);

    unsubscribe();
    container.deliver(pass);
    expect(seen).toHaveLength(2);
  });

  it("does not announce a replay for a plain status message", async () => {
    // `QUEUE_STATUS` is the answer to "what are you holding", not a report
    // that anything happened. Invalidating on it would refetch the whole
    // application on every page load that has a queue.
    const container = createFakeContainer({ controller: createFakeWorker("activated") });
    const client = createOfflineClient();
    await client.start(startOptions(container).options);
    const seen: unknown[] = [];
    client.onReplay((event) => seen.push(event));

    container.deliver({ type: "QUEUE_STATUS", pending: 3 });

    expect(seen).toEqual([]);
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

    expect(client.getState()).toEqual({
      online: false,
      pending: 0,
      syncing: false,
      unsent: { count: 0, writes: [] },
      updateReady: false,
    });
  });
});
