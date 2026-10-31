import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/newsletter/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/lib/msl/platform/cron-auth.server");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const { runNewsletterJob } = await import("@/lib/msl/newsletter/worker.server");
          return Response.json(await runNewsletterJob(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return Response.json(
            { error: "Newsletter worker unavailable. Check canonical state and configuration." },
            { status: 503 },
          );
        }
      },
    },
  },
});
