import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { store } from "@/store";
import { queryClient } from "@/api/queryClient";
import { startSilentRefresh } from "@/features/auth/silentRefresh";
import { AuthProvider } from "@/context/AuthContext";
import { App } from "@/App";
import "@/styles/globals.css";

startSilentRefresh(store);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
);
