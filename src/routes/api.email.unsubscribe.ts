import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/email/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = new URL(request.url).searchParams.get("token") ?? "";
          const { decodeUnsubscribe } = await import("@/lib/msl/delivery/subscription.server");
          decodeUnsubscribe(token);
          const { escapeHtml } = await import("@/lib/msl/delivery/render");
          return new Response(
            `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MSL unsubscribe</title><main><h1>Unsubscribe from MSL email</h1><p>Your published library remains available.</p><form method="post" action="/api/email/unsubscribe?token=${escapeHtml(encodeURIComponent(token))}"><button type="submit">Unsubscribe from email</button></form></main></html>`,
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy":
                  "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
              },
            },
          );
        } catch {
          return new Response(
            "This unsubscribe link is unavailable. Use your authenticated library preferences.",
            { status: 400 },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const token = new URL(request.url).searchParams.get("token") ?? "";
          const { unsubscribe } = await import("@/lib/msl/delivery/subscription.server");
          await unsubscribe(token);
          return new Response(
            "You are unsubscribed from MSL email. Your library remains available.",
            {
              headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
            },
          );
        } catch {
          return new Response(
            "Unsubscribe could not be confirmed. Use your authenticated library preferences or retry.",
            { status: 503 },
          );
        }
      },
    },
  },
});
