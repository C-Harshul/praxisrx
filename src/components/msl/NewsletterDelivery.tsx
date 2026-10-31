import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { newsletterStatusQuery } from "@/lib/msl/queries";
import { setEmailSubscription, retryNewsletter, retryEmail } from "@/lib/msl/api";

export function NewsletterDelivery() {
  const query = useQuery(newsletterStatusQuery);
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: setEmailSubscription,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletterStatus"] }),
  });
  const retry = useMutation({
    mutationFn: retryNewsletter,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletterStatus"] }),
  });
  const emailRetry = useMutation({
    mutationFn: retryEmail,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletterStatus"] }),
  });
  if (query.isLoading)
    return (
      <p role="status" className="mt-4 text-sm">
        Loading briefing status…
      </p>
    );
  if (query.isError)
    return (
      <p role="alert" className="mt-4 text-sm">
        Briefing and email preferences are unavailable. Refresh to read the canonical state.
      </p>
    );
  const data = query.data;
  if (!data) return null;
  return (
    <section className="mt-6 rounded-xl border p-5" aria-labelledby="email-heading">
      <h2 id="email-heading" className="text-lg font-semibold">
        Briefing and email preferences
      </h2>
      <p className="mt-2 text-sm">
        {data.frequency} · UTC · Email {data.subscription.status}. Your reading activity does not
        affect delivery.
      </p>
      {!data.send_configured && (
        <p className="mt-2 text-sm">
          No-send preview mode. Email needs a verified, explicitly authorized recipient and
          configured Gmail transport.
        </p>
      )}
      {!data.recipient_verified && (
        <p className="mt-2 text-sm">No verified delivery address is configured for this account.</p>
      )}
      {data.recipient_label && (
        <p className="mt-2 text-sm">Verified recipient: {data.recipient_label}</p>
      )}
      <button
        className="mt-3 rounded border px-3 py-2 text-sm"
        disabled={
          update.isPending ||
          (data.subscription.status !== "subscribed" &&
            (!data.recipient_verified || data.subscription.status === "suppressed"))
        }
        onClick={() => update.mutate(data.subscription.status !== "subscribed")}
      >
        {data.subscription.status === "subscribed"
          ? "Unsubscribe from email"
          : "Subscribe to email"}
      </button>
      {(update.isError || retry.isError || emailRetry.isError) && (
        <p role="alert" className="mt-2 text-sm">
          Preferences could not be saved. Check configuration and refresh.
        </p>
      )}
      {data.waiting && <p className="mt-3 text-sm">{data.waiting}</p>}
      {data.jobs[0] && (
        <p className="mt-3 text-sm">
          Newsletter preparation: {data.jobs[0].status}
          {data.jobs[0].error ? ` (${data.jobs[0].error})` : ""}.
        </p>
      )}
      {data.delivery.map((d, i) => (
        <p key={`${d.newsletter_id}-${i}`} className="mt-2 text-sm">
          Email: {d.status} · {d.attempts} provider {d.attempts === 1 ? "attempt" : "attempts"}.{" "}
          {d.status === "provider-accepted" ? "Gmail acceptance is not confirmed delivery." : ""}
          {d.retry_allowed && data.send_configured && data.subscription.status === "subscribed" && (
            <button
              disabled={emailRetry.isPending}
              className="ml-2 rounded border px-2 py-1"
              onClick={() => emailRetry.mutate(d.id)}
            >
              Retry this email
            </button>
          )}
        </p>
      ))}
      {data.previews.map((p) => (
        <details key={p.id} className="mt-4 border-t pt-3">
          <summary>Preview — no email sent</summary>
          <pre className="mt-3 whitespace-pre-wrap text-sm font-sans">{p.text}</pre>
          {data.send_configured && (
            <button
              disabled={retry.isPending}
              className="mt-3 rounded border px-3 py-2"
              onClick={() => retry.mutate(p.id)}
            >
              Publish this validated briefing
            </button>
          )}
        </details>
      ))}
    </section>
  );
}
