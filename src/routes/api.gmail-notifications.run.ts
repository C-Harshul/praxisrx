import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/gmail-notifications/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/lib/msl/platform/cron-auth.server");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const { runGmailNotificationJob } =
            await import("@/lib/msl/delivery/notifications.server");
          return Response.json(await runGmailNotificationJob(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return Response.json(
            {
              error:
                "Gmail notifications worker unavailable. Check canonical state and configuration.",
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
