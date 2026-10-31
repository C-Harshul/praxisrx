import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleReviewRequest } = await import("@/lib/msl/kb/http.server");
        return handleReviewRequest(request);
      },
    },
  },
});
