import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppShell,
});

const NAV = [
  { to: "/overblik", label: "Overblik" },
  { to: "/kolonner", label: "Mine kolonner" },
  { to: "/arkiv", label: "Arkiv" },
  { to: "/virksomheder", label: "Virksomheder" },
  { to: "/emner", label: "Emner" },
  { to: "/kilder", label: "Kilder" },
] as const;

function AppShell() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-sidebar-border bg-sidebar px-4 py-2 text-sidebar-foreground">
        <Link to="/overblik" className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-primary">Lex</span>
          <span className="font-serif text-lg">Nyhedsmonitor</span>
        </Link>
        <nav className="flex flex-1 gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-sm px-3 py-1.5 text-sm opacity-75 hover:bg-sidebar-accent hover:opacity-100"
              activeProps={{ className: "bg-sidebar-accent !opacity-100" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="hidden text-xs opacity-60 md:inline">{user.email}</span>
        <button
          className="text-xs opacity-75 hover:opacity-100"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/auth" });
          }}
        >
          Log ud
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
