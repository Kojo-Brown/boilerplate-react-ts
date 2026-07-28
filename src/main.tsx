import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { store } from "@/store";
import { queryClient } from "@/api/queryClient";
import { startSilentRefresh } from "@/features/auth/silentRefresh";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { App } from "@/App";
import "@/styles/globals.css";

async function enableMocking(): Promise<void> {
  // E2E runs set VITE_DISABLE_MSW so Playwright's page.route() owns the
  // network; the MSW service worker would otherwise answer first.
  if (!import.meta.env.DEV || import.meta.env["VITE_DISABLE_MSW"] === "true") return;
  try {
    const { worker } = await import("@/test/mocks/browser");
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
            <AuthProvider>
              <App />
            </AuthProvider>
            <ReactQueryDevtools initialIsOpen={false} />
          </QueryClientProvider>
        </Provider>
      </ThemeProvider>
    </StrictMode>,
  );
});
