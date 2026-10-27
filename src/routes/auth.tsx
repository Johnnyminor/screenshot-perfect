import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/overblik" });
      } else {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        toast.success("Tjek din e-mail for at bekræfte kontoen.");
        setMode("login");
      }
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
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Lex.dk · intern</div>
          <h1 className="mt-2 text-4xl">Nyhedsmonitor</h1>
          <p className="mt-2 text-sm opacity-70">Medtech og pharma – samlet ét sted.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-sm border border-border bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Adgangskode</Label>
            <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "login" ? "Log ind" : "Opret konto"}
          </Button>
          <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Ny redaktør? Opret konto" : "Har du en konto? Log ind"}
          </button>
        </form>
      </div>
    </div>
  );
}
