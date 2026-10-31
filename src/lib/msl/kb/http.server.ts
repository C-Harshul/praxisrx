import { z } from "zod";
import { checkOrigin, signIn, signOutCookie } from "../platform/auth.server";
import {
  requireReviewer,
  listReview,
  detailReview,
  saveReview,
  previewRelease,
  publishReviewRelease,
} from "./review.server";
import { KBError } from "./store.server";
const headers = { "Cache-Control": "no-store" };
export async function handleReviewRequest(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("Content-Length") ?? 0) > 16384)
      throw new KBError("Request too large.", 413);
    const text = await request.text();
    if (Buffer.byteLength(text) > 16384) throw new KBError("Request too large.", 413);
    const { action, input } = z
      .object({
        action: z.enum(["sign_in", "sign_out", "list", "detail", "review", "preview", "publish"]),
        input: z.unknown(),
      })
      .strict()
      .parse(JSON.parse(text));
    if (action === "sign_in") {
      const credentials = z
        .object({ email: z.string().email(), password: z.string().min(8).max(128) })
        .strict()
        .parse(input);
      const result = await signIn(request, { ...credentials, role: "reviewer" });
      // No cookie is issued until the server registry independently authorizes the account.
      const authenticated = new Request(request.url, {
        method: "POST",
        headers: new Headers(request.headers),
      });
      authenticated.headers.set("cookie", result.cookie.split(";")[0]!);
      requireReviewer(authenticated);
      return Response.json(result.session, {
        headers: { ...headers, "Set-Cookie": result.cookie },
      });
    }
    requireReviewer(request);
    if (action === "sign_out")
      return Response.json(null, {
        headers: { ...headers, "Set-Cookie": signOutCookie("reviewer") },
      });
    let data: unknown;
    if (action === "list") data = await listReview(request);
    else if (action === "detail") {
      const { id, version } = z
        .object({ id: z.string().min(1).max(200), version: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(input);
      data = await detailReview(request, id, version);
    } else if (action === "review") data = await saveReview(request, input);
    else if (action === "preview") data = await previewRelease(request, input);
    else data = await publishReviewRelease(request, input);
    return Response.json(data, { headers });
  } catch (error) {
    const known = error instanceof KBError,
      auth = error instanceof Error && error.message === "Not signed in.",
      origin = error instanceof Error && error.message === "Invalid request origin.",
      login =
        error instanceof Error &&
        [
          "That email and password don't match.",
          "Too many sign-in attempts. Try again later.",
        ].includes(error.message),
      invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    const status = known ? error.status : auth || login ? 401 : origin ? 403 : invalid ? 400 : 503;
    const message = known
      ? error.message
      : auth
        ? "Reviewer sign-in required."
        : origin
          ? "Invalid request origin."
          : login
            ? error.message
            : invalid
              ? "Invalid review request."
              : "Databricks request unconfirmed or unavailable. Refresh; retry mutations with the same request identity.";
    return Response.json({ error: message }, { status, headers });
  }
}
