import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LoadingBlock } from "@/components/msl/States";

// Entry point: signed-out doctors go to sign-in; signed-in doctors go to the
// Library, which forwards to onboarding when it is not complete yet.
export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "MSL — Evidence briefings for oncologists" },
      {
        name: "description",
        content: "MSL turns new oncology research into briefings matched to your de-identified patient mix.",
      },
      { property: "og:title", content: "MSL — Evidence briefings for oncologists" },
      {
        property: "og:description",
        content: "MSL turns new oncology research into briefings matched to your de-identified patient mix.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/library" : "/auth" });
  },
  component: () => <LoadingBlock />,
});
