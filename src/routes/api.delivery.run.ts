import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/delivery/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/lib/msl/platform/cron-auth.server");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const { runDeliveryJob } = await import("@/lib/msl/delivery/worker.server");
          return Response.json(await runDeliveryJob(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return Response.json(
            { error: "Delivery worker unavailable. Check canonical state and configuration." },
            { status: 503 },
          );
        }
      },
    },
  },
});
