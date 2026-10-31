import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getAppSession, loginApp } from "@/lib/msl/platform/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TAGLINE, Wordmark } from "@/components/msl/Wordmark";
export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — MSL" }] }),
  beforeLoad: async () => {
    if (await getAppSession()) throw redirect({ to: "/library" });
  },
  component: AuthPage,
});
function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loginApp(email, password);
      navigate({ to: "/library", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <Wordmark asLink={false} className="text-3xl" />
          <p className="mt-3 font-display text-lg text-muted-foreground">{TAGLINE}</p>
        </div>
        <div className="rounded-xl border p-6 sm:p-8">
          <h1 className="text-2xl font-semibold">Doctor sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your provisioned MSL account. Your practice data is stored in Databricks.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
