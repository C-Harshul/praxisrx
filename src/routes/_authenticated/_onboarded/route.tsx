import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { doctorQuery } from "@/lib/msl/queries";
import { AppHeader } from "@/components/msl/AppHeader";

// Pages that require a completed onboarding. Unfinished doctors are sent to onboarding.
export const Route = createFileRoute("/_authenticated/_onboarded")({
  beforeLoad: async ({ context }) => {
    const doctor = await context.queryClient.ensureQueryData(doctorQuery);
    if (!doctor.onboarding_complete) throw redirect({ to: "/onboarding" });
  },
  component: OnboardedLayout,
});

function OnboardedLayout() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
    </div>
  );
}
