import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { store } from "@/app/store";
import { api } from "@/app/api/client";
import { queryClient } from "@/app/api/queryClient";
import { startOfflineReconciliation } from "@/app/api/offlineReconcile";
import { ApiClientProvider } from "@/shared/api/ApiClientProvider";
import { startSilentRefresh } from "@/features/auth/silentRefresh";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ThemeProvider } from "@/shared/theme/ThemeContext";
import { ErrorReporterProvider } from "@/shared/observability/ErrorReporterProvider";
import { reporter } from "@/app/observability/reporter";
import { offlineClient } from "@/shared/offline/offlineClient";
import { getServiceWorkerContainer } from "@/shared/offline/registerServiceWorker";
import { App } from "@/app/App";
import "@/shared/styles/globals.css";

async function enableMocking(): Promise<void> {
  // E2E runs set VITE_DISABLE_MSW so Playwright's page.route() owns the
  // network; the MSW service worker would otherwise answer first.
  if (!import.meta.env.DEV || import.meta.env["VITE_DISABLE_MSW"] === "true") return;
  try {
    const { worker } = await import("@/shared/mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass" });
  } catch (error) {
    console.error("MSW failed to start; continuing without API mocks.", error);
  }
}

/**
 * Starts offline support: registration, update detection, the state the
 * `OfflineStatus` banner reads, and the cache reconciliation that runs when
 * the write queue drains.
 *
 * Production only, and not because development does not deserve it. Two
 * reasons, either of which is sufficient:
 *
 * - `/sw.js` is emitted by a second build (`vite.sw.config.ts`) and does not
 *   exist under `vite dev`, so registering there is a guaranteed 404.
 * - MSW's worker is registered at the same scope in development. A scope holds
 *   one worker: registering ours would replace the one answering every mocked
 *   request, and the failure would look like the API mocks breaking.
 *
 * `VITE_DISABLE_SW` turns it off in a production build — for a preview
 * deployment where a stale worker would outlive the branch it came from, and
 * for the Playwright specs that own the network themselves.
 */
function enableOfflineSupport(): void {
  if (!import.meta.env.PROD || import.meta.env["VITE_DISABLE_SW"] === "true") return;

  /*
    Attached before `start()`, not after.

    `start()` is async only because `register()` is, but the `message`
    listener it installs can fire the moment it is attached — a worker from a
    previous visit is already controlling this page and may answer the
    `QUEUE_STATUS` probe with a replay it had in flight. Subscribing after the
    promise settles is a window in which the one event that matters is
    delivered to nobody, and it is the window that opens on exactly the visit
    where a queue already exists.
  */
  startOfflineReconciliation(offlineClient, {
    queryClient,
    dispatch: (action) => store.dispatch(action),
  });

  void offlineClient
    .start({
      container: getServiceWorkerContainer(),
      isOnline: () => navigator.onLine,
      listen: (type, listener) => {
        window.addEventListener(type, listener);
      },
      reload: () => {
        window.location.reload();
      },
    })
    .catch((error: unknown) => {
      reporter.captureException(error, {
        level: "warning",
        mechanism: { type: "serviceWorker.register", handled: true },
      });
    });
}

startSilentRefresh(store);
enableOfflineSupport();

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

void enableMocking().then(() => {
  createRoot(root, {
    /*
      Only the uncaught handler reports, and the omission of `onCaughtError` is
      the load-bearing part.

      React 19 calls `onCaughtError` *and* the catching boundary's
      `componentDidCatch` for one error — verified in
      `errorReporter.dedupe.test.tsx`. Wiring both is the natural mistake,
      since the root option reads like the React 19 replacement for the
      lifecycle, and it doubles every count in the dashboard. The boundary is
      the one that reports, because it is the only one that knows which route
      broke; this handler covers what no boundary caught, which is the class of
      error that leaves the user staring at a blank document.

      `onRecoverableError` is separate and is not an application error at all:
      React calls it for things it recovered from on its own, hydration
      mismatches chief among them. Reported at `warning` so it never pages
      anyone, and reported at all because a hydration mismatch is invisible
      otherwise.
    */
    onUncaughtError: (error, errorInfo) => {
      reporter.captureException(error, {
        level: "fatal",
        mechanism: { type: "react.onUncaughtError", handled: false },
        ...(errorInfo.componentStack != null ? { componentStack: errorInfo.componentStack } : {}),
      });
    },
    onRecoverableError: (error, errorInfo) => {
      reporter.captureException(error, {
        level: "warning",
        mechanism: { type: "react.onRecoverableError", handled: true },
        ...(errorInfo.componentStack != null ? { componentStack: errorInfo.componentStack } : {}),
      });
    },
  }).render(
    <StrictMode>
      <ThemeProvider>
        {/*
          Outside every other provider: a reporter is the one dependency the
          error path needs, and an error thrown while the store or the query
          client is being set up must still reach it.
        */}
        <ErrorReporterProvider reporter={reporter}>
          <Provider store={store}>
            <QueryClientProvider client={queryClient}>
              {/*
              The composition root's half of the dependency inversion: the one
              module that knows the concrete client publishes it, and every
              consumer below reads it from context. Inside the store provider
              because the client's session port is store-backed — the ordering
              is not load-bearing at render time (the port reads the store
              singleton directly, not through context) but keeping it here says
              which one depends on which.
            */}
              <ApiClientProvider client={api}>
                <AuthProvider>
                  <App />
                </AuthProvider>
              </ApiClientProvider>
              <ReactQueryDevtools initialIsOpen={false} />
            </QueryClientProvider>
          </Provider>
        </ErrorReporterProvider>
      </ThemeProvider>
    </StrictMode>,
  );
});
