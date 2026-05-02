import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();
const analyticsEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT?.trim();
const analyticsWebsiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID?.trim();

if (analyticsEndpoint && analyticsWebsiteId) {
  const existingScript = document.querySelector<HTMLScriptElement>(
    'script[data-website-id]'
  );
  if (!existingScript) {
    const script = document.createElement("script");
    script.defer = true;
    script.src = `${analyticsEndpoint.replace(/\/$/, "")}/umami`;
    script.dataset.websiteId = analyticsWebsiteId;
    document.head.appendChild(script);
  }
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  queryClient.setQueryData(["auth", "me"], null);
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Double-submit cookie pattern: read the CSRF token from the cookie
        // (set by the server on GET requests) and mirror it in the header so
        // the server can validate it on mutations.
        const match = document.cookie
          .split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith("csrf_token="));
        const csrfToken = match ? match.slice("csrf_token=".length) : undefined;
        return csrfToken ? { "X-CSRF-Token": csrfToken } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
