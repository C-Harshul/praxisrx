import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/app")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { readSession, requireSession } = await import("@/lib/msl/platform/auth.server");
          const url = new URL(request.url);
          const role = url.searchParams.get("role") === "hospital" ? "hospital" : "doctor";
          const action = url.searchParams.get("action") ?? "";
          if (action === "session")
            return Response.json(readSession(request, role), {
              headers: { "Cache-Control": "no-store" },
            });
          const user = requireSession(request, "doctor");
          const { doctorRead } = await import("@/lib/msl/platform/doctor.server");
          return Response.json(
            await doctorRead(user.id, action, url.searchParams.get("id") ?? undefined),
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (err) {
          const unauthorized = err instanceof Error && err.message === "Not signed in.";
          return Response.json(
            {
              error: unauthorized
                ? "Not signed in."
                : "Databricks data unavailable. Check the connection and refresh.",
            },
            { status: unauthorized ? 401 : 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const { checkOrigin, signIn, signOutCookie, requireSession } =
            await import("@/lib/msl/platform/auth.server");
          checkOrigin(request);
          const text = await request.text();
          if (Buffer.byteLength(text) > 32768)
            return Response.json({ error: "Request too large." }, { status: 413 });
          const { action, input, role } = JSON.parse(text);
          if (action === "sign_in") {
            const result = await signIn(request, input);
            return Response.json(result.session, {
              headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" },
            });
          }
          if (action === "sign_out")
            return Response.json(null, {
              headers: {
                "Set-Cookie": signOutCookie(role === "hospital" ? "hospital" : "doctor"),
                "Cache-Control": "no-store",
              },
            });
          const user = requireSession(request, "doctor");
          const { doctorWrite } = await import("@/lib/msl/platform/doctor.server");
          return Response.json(await doctorWrite(user.id, action, input), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          const safe = [
            "Not signed in.",
            "Invalid request origin.",
            "That email and password don't match.",
            "Too many sign-in attempts. Try again later.",
            "Profile is no longer current.",
            "Canonical data changed. Refresh before retrying.",
            "Doctor is not provisioned in Databricks.",
            "App authentication is not configured.",
          ];
          return Response.json(
            {
              error: safe.includes(message)
                ? message
                : "The request could not be saved to Databricks. Check settings and refresh before retrying.",
            },
            {
              status:
                message === "Not signed in."
                  ? 401
                  : message === "Invalid request origin."
                    ? 403
                    : 400,
              headers: { "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
