import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { store } from "@/app/store";
import { api } from "@/app/api/client";
import { queryClient } from "@/app/api/queryClient";
import { ApiClientProvider } from "@/shared/api/ApiClientProvider";
import { startSilentRefresh } from "@/features/auth/silentRefresh";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ThemeProvider } from "@/shared/theme/ThemeContext";
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

startSilentRefresh(store);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

void enableMocking().then(() => {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
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
      </ThemeProvider>
    </StrictMode>,
  );
});
