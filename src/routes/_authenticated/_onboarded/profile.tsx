import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Link2, Pencil, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AggregateBars } from "@/components/msl/AggregateBars";
import { LoadingBlock } from "@/components/msl/States";
import { doctorQuery, patientMixQuery } from "@/lib/msl/queries";
import { unlinkPatientData } from "@/lib/msl/api";

export const Route = createFileRoute("/_authenticated/_onboarded/profile")({
  head: () => ({
    meta: [
      { title: "My profile — MSL" },
      { name: "description", content: "Your practice details and linked de-identified patient mix." },
      { property: "og:title", content: "My profile — MSL" },
      { property: "og:description", content: "Your practice details and linked de-identified patient mix." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(doctorQuery),
  pendingComponent: () => <LoadingBlock />,
  component: ProfilePage,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function EditLink({ step, label }: { step: number; label: string }) {
  return (
    <Link
      to="/onboarding"
      search={{ step, from: "profile" }}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      aria-label={label}
    >
      <Pencil className="h-3 w-3" /> Edit
    </Link>
  );
}

function ProfilePage() {
  const { data: doctor } = useSuspenseQuery(doctorQuery);
  const qc = useQueryClient();
  const { data: mix, isLoading: mixLoading } = useQuery({
    ...patientMixQuery(doctor.doctor_id_code),
    enabled: doctor.patient_data_linked && !!doctor.doctor_id_code,
  });
  const [unlinking, setUnlinking] = useState(false);

  async function unlink() {
    setUnlinking(true);
    try {
      await unlinkPatientData();
      await qc.invalidateQueries({ queryKey: ["doctor"] });
      qc.removeQueries({ queryKey: ["patientMix"] });
      toast.success("Patient data unlinked");
    } catch {
      toast.error("We couldn't unlink your patient data. Please try again.");
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold sm:text-4xl">My profile</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-xl border p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{doctor.full_name || "Your details"}</h2>
            <Button variant="outline" size="sm" asChild>
              <Link to="/onboarding" search={{ step: 1, from: "profile" }}>
                <Pencil /> Edit
              </Link>
            </Button>
          </div>
          <dl className="mt-4 divide-y">
            <Row label="Name" value={doctor.full_name} />
            <Row label="Years in practice" value={doctor.years_in_practice?.toString()} />
            <Row label="Practice setting" value={doctor.practice_setting} />
            <div className="flex items-center justify-between pt-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Specialty</span>
              <EditLink step={2} label="Edit specialty" />
            </div>
            <Row label="Specialty" value={doctor.specialty} />
            <Row label="Cancer types" value={doctor.cancer_types.join(", ")} />
            <Row label="Topics" value={doctor.topics.join(", ")} />
            <div className="flex items-center justify-between pt-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Newsletter</span>
              <EditLink step={3} label="Edit newsletter preferences" />
            </div>
            <Row label="Format" value={doctor.preferred_format} />
            <Row label="Frequency" value={doctor.frequency} />
          </dl>
        </section>

        {doctor.patient_data_linked ? (
          <section className="h-fit rounded-xl border p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Linked patient mix</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Doctor ID <span className="font-medium text-foreground">{doctor.doctor_id_code}</span>
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary-soft-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> De-identified aggregates only.
              </span>
            </div>
            {mixLoading ? (
              <LoadingBlock />
            ) : mix ? (
              <>
                <p className="mt-4 text-sm text-muted-foreground" title={format(new Date(mix.synced_at), "PPpp")}>
                  Last synced {format(new Date(mix.synced_at), "d MMM yyyy")} ({formatDistanceToNow(new Date(mix.synced_at), { addSuffix: true })})
                </p>
                <div className="mt-6">
                  <AggregateBars aggregates={mix.aggregates} />
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No aggregates available for this doctor ID yet.</p>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="mt-8 w-full text-destructive hover:text-destructive" disabled={unlinking}>
                  <Unlink /> Unlink patient data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unlink patient data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your doctor ID will be removed from your profile and your patient mix will no longer be shown. You
                    can link it again at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep linked</AlertDialogCancel>
                  <AlertDialogAction onClick={unlink} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Unlink
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        ) : (
          <section className="h-fit rounded-xl border border-dashed p-6 text-center">
            <h2 className="text-lg font-semibold">No patient data linked</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Link your doctor ID to see which new research applies to your patients.
            </p>
            <Button className="mt-5" asChild>
              <Link to="/onboarding" search={{ step: 4, from: "profile" }}>
                <Link2 /> Link patient data
              </Link>
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
