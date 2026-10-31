import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generatedProfileQuery } from "@/lib/msl/queries";
import { confirmGeneratedProfile, retryGeneratedProfile } from "@/lib/msl/api";
import { generatedProfileSchema } from "@/lib/msl/profiling/contract";
import { Button } from "@/components/ui/button";

export function GeneratedProfile() {
  const query = useQuery(generatedProfileQuery);
  const qc = useQueryClient();
  const confirmation = useMutation({
    mutationFn: confirmGeneratedProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generatedProfile"] }),
  });
  const retry = useMutation({
    mutationFn: retryGeneratedProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generatedProfile"] }),
  });
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const job = query.data;
  const parsed = generatedProfileSchema.safeParse(job?.output);
  const focusAreas = parsed.success
    ? parsed.data.suggested_focus.filter(
        (focus) =>
          !job?.confirmed_at ||
          ((job.reviewed_focus ?? []) as { cancer_type: string; topic: string }[]).some(
            (f) => f.cancer_type === focus.cancer_type && f.topic === focus.topic,
          ),
      )
    : [];
  return (
    <section className="mt-6 rounded-xl border p-6" aria-labelledby="generated-profile-title">
      <h2 id="generated-profile-title" className="text-xl font-semibold">
        Your briefing profile
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Databricks AI structures your answers into a profile. Review the suggested focus areas below; you
        can correct your answers using Edit above. Patient percentages come from your linked data.
      </p>
      <div className="mt-4" role="status">
        {query.isPending && <p>Loading your briefing profile…</p>}
        {query.isError && <p>Your briefing profile is unavailable. Please try again later.</p>}
        {!query.isPending && !query.isError && !job && (
          <p>Your briefing profile has not been queued yet.</p>
        )}
        {(job?.status === "queued" || job?.status === "processing") && (
          <p>Your briefing profile is being prepared. You can continue using the app.</p>
        )}
        {job?.status === "superseded" && (
          <p>Your answers changed. A new profile will replace this version.</p>
        )}
        {job?.status === "failed" && (
          <>
            <p>
              We couldn’t prepare your briefing profile. Your saved answers are available above.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              Try again
            </Button>
          </>
        )}
        {job?.status === "succeeded" && !parsed.success && (
          <p>This profile could not be displayed. Please contact support.</p>
        )}
        {job?.status === "succeeded" && parsed.success && (
          <>
            <p className="text-sm">
              {job.confirmed_at ? "Reviewed by you" : "Awaiting your review"} · Version{" "}
              {job.version}
            </p>
            <h3 className="mt-4 font-medium">Suggested evidence focus</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              AI suggestions combining your selected cancer types and topics. Uncheck any you don’t
              want. These do not imply treatment preferences or a priority order.
            </p>
            {focusAreas.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {focusAreas.map((focus) => {
                  const key = `${job.id}:${focus.cancer_type}:${focus.topic}`;
                  return (
                    <li key={key}>
                      {job.confirmed_at ? (
                        `${focus.cancer_type} · ${focus.topic}`
                      ) : (
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!excluded[key]}
                            onChange={(e) =>
                              setExcluded((old) => ({ ...old, [key]: !e.target.checked }))
                            }
                          />
                          {focus.cancer_type} · {focus.topic}
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm">
                No focus areas selected. You can edit your cancer types and topics to generate new
                suggestions.
              </p>
            )}
            {!job.confirmed_at && (
              <Button
                className="mt-4"
                disabled={confirmation.isPending}
                onClick={() =>
                  confirmation.mutate({
                    id: job.id,
                    focus: parsed.data.suggested_focus.filter(
                      (f) => !excluded[`${job.id}:${f.cancer_type}:${f.topic}`],
                    ),
                  })
                }
              >
                Confirm this profile
              </Button>
            )}
            <Button variant="link" asChild>
              <Link to="/onboarding" search={{ step: 2, from: "profile" }}>
                Edit my answers
              </Link>
            </Button>
          </>
        )}
      </div>
      {(confirmation.isError || retry.isError) && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          The profile may have changed, or the retry is too soon. Refresh and try again.
        </p>
      )}
    </section>
  );
}
