import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/email/gmail-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { receiveGmailPush } = await import("@/lib/msl/delivery/webhook.server");
          return Response.json(await receiveGmailPush(request), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          const invalid =
            error instanceof Error && /invalid|conflict|too_large/.test(error.message);
          return Response.json(
            {
              error: invalid
                ? "Invalid Gmail notification."
                : "Canonical notification storage unavailable.",
            },
            { status: invalid ? 401 : 503 },
          );
        }
      },
    },
  },
});
