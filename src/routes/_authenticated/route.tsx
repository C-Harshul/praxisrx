import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAppSession } from "@/lib/msl/platform/browser";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const user = await getAppSession();
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: () => <Outlet />,
});
