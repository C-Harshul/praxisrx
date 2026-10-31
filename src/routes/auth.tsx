import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TAGLINE, Wordmark } from "@/components/msl/Wordmark";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — MSL" },
      { name: "description", content: "Sign in or create your MSL account to receive evidence briefings for your patients." },
      { property: "og:title", content: "Sign in — MSL" },
      { property: "og:description", content: "Sign in or create your MSL account to receive evidence briefings for your patients." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/library" });
  },
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(255),
  password: z.string().min(8, "Password must be at least 8 characters.").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        navigate({ to: "/library", replace: true });
      } else {
        const { data, error } = await supabase.auth.signUp({
          ...parsed.data,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/onboarding", replace: true });
        else setSentTo(parsed.data.email);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg === "Invalid login credentials" ? "That email and password don't match. Try again." : msg);
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

        {sentTo ? (
          <div className="rounded-xl border p-6 text-center">
            <MailCheck className="mx-auto h-8 w-8 text-primary" />
            <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to
              finish creating your account.
            </p>
            <Button variant="link" className="mt-4" onClick={() => { setSentTo(null); setMode("login"); }}>
              Back to log in
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border p-6 sm:p-8">
            <div className="mb-6 grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist">
              {(["login", "signup"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); }}
                  className={cn(
                    "rounded-md py-2 text-sm font-medium transition-colors",
                    mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {m === "login" ? "Log in" : "Sign up"}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                />
                {mode === "signup" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
