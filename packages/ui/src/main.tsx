import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./index.css";

// The app is served with an injected <base href> at its mount path; react-router
// needs that path as its basename so links resolve under the mount.
const basename = new URL(document.baseURI).pathname.replace(/\/$/, "") || "/";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchInterval: 5000, staleTime: 4000, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
