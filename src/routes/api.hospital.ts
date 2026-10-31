import { createFileRoute } from "@tanstack/react-router";
const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/hospital")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { readHospitalDirectory } = await import("@/lib/msl/hospital/service.server");
          return Response.json(await readHospitalDirectory(request), { headers });
        } catch {
          return Response.json(
            {
              error: "Hospital connection unavailable. Check Databricks server configuration.",
            },
            { status: 503, headers },
          );
        }
      },
      POST: async ({ request }) => {
        // Same-origin browser writes; no permissive cross-origin hospital uploads.
        const origin = request.headers.get("Origin");
        if (origin !== new URL(request.url).origin)
          return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
        if (Number(request.headers.get("Content-Length") ?? 0) > 32768)
          return Response.json({ error: "Aggregate payload too large." }, { status: 413, headers });
        try {
          const text = await request.text();
          if (new TextEncoder().encode(text).length > 32768)
            return Response.json(
              { error: "Aggregate payload too large." },
              { status: 413, headers },
            );
          const { hospitalSync } = await import("@/lib/msl/hospital/service.server");
          return Response.json(await hospitalSync(request, JSON.parse(text)), { headers });
        } catch (error) {
          const message =
            error instanceof Error && !(error instanceof SyntaxError) && error.name !== "ZodError"
              ? error.message
              : "Invalid aggregate upload.";
          return Response.json(
            { error: message },
            {
              status:
                error instanceof Error && error.name === "HospitalPublicationUnconfirmed"
                  ? 503
                  : 400,
              headers,
            },
          );
        }
      },
    },
  },
});
