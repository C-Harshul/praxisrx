import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/matching/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/lib/msl/platform/cron-auth.server");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const { runMatchingJob } = await import("@/lib/msl/matching/worker.server");
          return Response.json(await runMatchingJob(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return Response.json(
            { error: "Matching worker unavailable. Check server configuration." },
            { status: 503 },
          );
        }
      },
    },
  },
});
