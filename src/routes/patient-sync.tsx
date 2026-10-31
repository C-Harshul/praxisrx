import { createFileRoute, redirect } from "@tanstack/react-router";
// Preserve old bookmarks while keeping all upload UI outside the doctor portal.
export const Route = createFileRoute("/patient-sync")({
  beforeLoad: () => {
    throw redirect({ to: "/hospital" });
  },
});
