"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  ListFilter,
  Users,
  History,
} from "lucide-react";
import type { Role } from "@/domain/types";
const items = [
  { href: "/", title: "Dashboard", icon: LayoutDashboard },
  { href: "/leads/new", title: "Novos Leads", icon: Inbox },
  { href: "/leads", title: "Todos os Leads", icon: ListFilter },
  { href: "/employees", title: "Funcionários", icon: Users, admin: true },
  { href: "/history", title: "Histórico", icon: History },
];
export function Navigation({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegação principal">
      {items
        .filter((i) => !i.admin || role === "ADMIN")
        .map(({ href, title, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : href === "/leads"
                ? pathname.startsWith("/leads") &&
                  !pathname.startsWith("/leads/new")
                : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={"nav-item " + (active ? "active" : "")}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={18} />
              {title}
            </Link>
          );
        })}
    </nav>
  );
}
