import { requireActor } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { Navigation } from "@/components/navigation";
import { AvailabilityBadge } from "@/components/status";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireActor();
  return (
    <>
      <aside className="sidebar">
        <Brand />
        <p className="nav-label">CENTRAL DE LEADS</p>
        <Navigation role={actor.profile.role} />
        <div className="sidebar-footer">
          Motive Corretora
          <br />
          <span>Operação interna · Fase 01</span>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div>
            <small>WORKSPACE</small>
            <p className="mt-1 text-xs font-semibold">Motive Corretora</p>
          </div>
          <div className="account">
            <AvailabilityBadge value={actor.employee.availability} />
            <div className="avatar">
              {actor.employee.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-semibold">{actor.employee.name}</p>
              <small>
                {actor.profile.role === "ADMIN" ? "Administrador" : "Agente"}
              </small>
            </div>
            <form action={logout}>
              <Button variant="ghost" size="icon" aria-label="Sair">
                <LogOut size={17} />
              </Button>
            </form>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
