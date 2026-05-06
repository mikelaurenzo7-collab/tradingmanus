import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getOrCreateCsrfToken } from "@/lib/csrf";
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
    "script[data-website-id]"
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
        // Double-submit cookie pattern: mirror the CSRF cookie in a header so
        // the server can validate state-changing requests. The server mints
        // the token on the initial HTML GET; this client fallback bootstraps
        // environments where the first tRPC POST happens before that cookie is
        // available (for example, test harnesses or cached static shells).
        return { "X-CSRF-Token": getOrCreateCsrfToken() };
      },
      async fetch(input, init) {
        const response = await globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });

        // Vercel (and other platforms) return plain-text crash pages like
        // "A server error has occurred" when the serverless function itself
        // fails before our app can respond. tRPC then tries to JSON.parse the
        // body and surfaces a cryptic "Unexpected token 'A'..." error to the
        // user. Convert any non-JSON response into a proper tRPC error
        // envelope so the UI shows something meaningful.
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          return response;
        }

        const rawBody = await response.text();
        const snippet =
          rawBody.trim().slice(0, 200) ||
          response.statusText ||
          "Unknown error";
        const message =
          response.status >= 500
            ? `Server error (${response.status}): ${snippet}. Please try again in a moment.`
            : `Request failed (${response.status}): ${snippet}`;

        const errorEnvelope = [
          {
            error: {
              json: {
                message,
                code: response.status >= 500 ? -32603 : -32600,
                data: {
                  code:
                    response.status >= 500
                      ? "INTERNAL_SERVER_ERROR"
                      : "BAD_REQUEST",
                  httpStatus: response.status,
                },
              },
            },
          },
        ];

        return new Response(JSON.stringify(errorEnvelope), {
          status: response.status,
          headers: { "content-type": "application/json" },
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
