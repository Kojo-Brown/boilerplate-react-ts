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
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { resolveI18n } from "@/shared/i18n/bootstrap";
import { ErrorReporterProvider } from "@/shared/observability/ErrorReporterProvider";
import { LiveRegions } from "@/shared/a11y/LiveRegions";
import { ToastProvider } from "@/shared/ui/Toast";
import { reporter } from "@/app/observability/reporter";
import { reportCspViolations } from "@/shared/security/reportCspViolations";
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

/*
  Subscribed here rather than inside a provider, and as early as this file can
  manage, because the window it can observe only ever shrinks.

  `securitypolicyviolation` is a DOM event, so nothing hears a refusal that
  happened before the listener existed — including the one that matters most,
  an entry script blocked because the nonce substitution failed. That case is
  structurally out of reach from inside the document and is covered by
  `e2e/csp.spec.ts` instead. What this does catch is every route: a lazily
  loaded page reaching for an origin `connect-src` does not name, a library
  injecting a `<style>`, a widget somebody adds next quarter. Never unsubscribed
  — the page is the subscription's lifetime. See `docs/csp.md`.
*/
reportCspViolations({ reporter });

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

/*
  Both resolved before the first render, and the i18n half is the one that has
  to be.

  `resolveI18n()` negotiates the locale and fetches its catalogue, and the
  application cannot usefully render until it has: the alternative is one commit
  in the default locale, which for a right-to-left reader is the entire layout
  drawn mirrored and then re-drawn. One `import()` on the critical path buys a
  first paint that is correct in both language and direction — and for the
  default locale there is no import at all, because its catalogue is statically
  linked (see `messages/index.ts`).

  Run concurrently with `enableMocking()` rather than after it. They share
  nothing, both are network-bound in development, and sequencing them would add
  the worker registration to the critical path of the locale fetch for no reason.
*/
void Promise.all([
  enableMocking(),
  resolveI18n({
    onError: (error) => {
      reporter.captureException(error, {
        level: "warning",
        mechanism: { type: "i18n.bootstrap", handled: true },
      });
    },
  }),
]).then(([, i18n]) => {
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
      {/*
        First in the tree, and outside every provider and the router, because
        the four live regions it renders have to outlive everything that
        announces through them:

        - `/login` and `/auth/callback` render outside `RootLayout`, so a region
          in the shell would not exist on the one route where an unheard error
          costs the user the session.
        - A live region only announces a change made while it is *already in the
          document*. Mounted here it is in the document from the first paint and
          never remounts, which is the only way that is true of the first
          announcement as well as the hundredth.

        Nothing re-renders to deliver a message: `announce()` writes to a store
        and this leaf is its only subscriber. See `src/shared/a11y/announcer.ts`.
      */}
      <LiveRegions />
      {/*
        Above `ThemeProvider` and outside everything else, because `<html dir>`
        is one of the two things it sets and a mirrored layout has to be true of
        the first paint rather than of the first effect below it. It is also
        above the router: a route announcement and a document title are both
        translated strings, so the announcer has to be able to read an intl.

        Below `<LiveRegions />`, though, and deliberately: switching language
        announces itself, and an announcement needs a region that was already in
        the document when the switch happened.
      */}
      <I18nProvider
        initialLocale={i18n.locale}
        initialMessages={i18n.messages}
        onError={(error) => {
          reporter.captureException(error, {
            level: "warning",
            mechanism: { type: "i18n.format", handled: true },
          });
        }}
      >
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
                    {/*
                    Wraps the router so any page can raise a toast, and above it
                    rather than inside the shell so a toast survives the
                    navigation that follows the action that raised it.

                    Its state changing does not re-render the routes: `children`
                    is the same element object across its own re-renders, so
                    React bails out of that subtree.
                  */}
                    <ToastProvider>
                      <App />
                    </ToastProvider>
                  </AuthProvider>
                </ApiClientProvider>
                <ReactQueryDevtools initialIsOpen={false} />
              </QueryClientProvider>
            </Provider>
          </ErrorReporterProvider>
        </ThemeProvider>
      </I18nProvider>
    </StrictMode>,
  );
});
