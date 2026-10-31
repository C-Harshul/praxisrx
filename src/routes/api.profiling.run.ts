import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/profiling/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/lib/msl/platform/cron-auth.server");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const { runProfilingJob } = await import("@/lib/msl/profiling/worker.server");
          return Response.json(await runProfilingJob(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return Response.json(
            { error: "Profiling worker unavailable. Check server configuration." },
            { status: 503 },
          );
        }
      },
    },
  },
});
