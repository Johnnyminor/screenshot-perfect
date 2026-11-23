import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Log ind – Lex Nyhedsmonitor" },
      { name: "description", content: "Log ind på Lex Nyhedsmonitor." },
      { property: "og:title", content: "Log ind – Lex Nyhedsmonitor" },
      { property: "og:description", content: "Log ind på Lex Nyhedsmonitor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const membership = await supabase.rpc("is_team_member");
      if (membership.error || !membership.data) {
        await supabase.auth.signOut();
        throw new Error(
          "Din konto har ikke adgang til redaktionen. Kontakt administratoren for en invitation.",
        );
      }
      qc.clear();
      navigate({ to: "/overblik" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Noget gik galt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-ink-foreground">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Lex.dk · intern
          </div>
          <h1 className="mt-2 text-4xl">Nyhedsmonitor</h1>
          <p className="mt-2 text-sm opacity-70">Medtech og pharma – samlet ét sted.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-sm border border-border bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Adgangskode</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Logger ind…" : "Log ind"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Adgang kræver en invitation fra redaktionen.
          </p>
        </form>
      </div>
    </div>
  );
}
