import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Wordmark } from "./Wordmark";

const navLink =
  "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-primary-soft data-[status=active]:text-primary-soft-foreground";

export function AppHeader() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-1">
          <Link to="/library" className={navLink} activeOptions={{ exact: false }}>
            Library
          </Link>
          <Link to="/profile" className={navLink}>
            My profile
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut} className="ml-1 text-muted-foreground">
            <LogOut />
            <span className="hidden sm:inline">Log out</span>
            <span className="sr-only sm:hidden">Log out</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}
