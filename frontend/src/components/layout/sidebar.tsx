"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Package,
  Receipt,
  Flame,
  Users,
  MessageCircleQuestion,
  Target,
  Globe2,
  ListChecks,
  TrendingUp,
  Megaphone,
  Warehouse,
  Sparkles,
  Database,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";

/** Small spinner on the clicked sidebar item until its page has loaded — instant feedback on click. */
function NavPendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-label="Loading" className="ml-auto h-3.5 w-3.5 animate-spin" /> : null;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  show: boolean;
}

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { canManageUsers } = usePermissions();

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/company", label: "Company", icon: Building2, show: true },
    { href: "/products", label: "Products", icon: Package, show: true },
    { href: "/sales", label: "Sales", icon: Receipt, show: true },
    { href: "/leads", label: "Leads", icon: Flame, show: true },
    { href: "/opportunities", label: "Opportunity Center", icon: Target, show: true },
    { href: "/market-expansion", label: "Market Expansion", icon: Globe2, show: true },
    { href: "/follow-ups", label: "Follow-ups", icon: ListChecks, show: true },
    { href: "/revenue-analytics", label: "Revenue Analytics", icon: TrendingUp, show: true },
    { href: "/advertising", label: "Advertising", icon: Megaphone, show: true },
    { href: "/distributors", label: "Distributors", icon: Warehouse, show: true },
    { href: "/optimization", label: "AI Optimization", icon: Sparkles, show: true },
    { href: "/fms", label: "FMS Data", icon: Database, show: true },
    { href: "/assistant", label: "Ask Sales AI", icon: MessageCircleQuestion, show: true },
    { href: "/users", label: "Users", icon: Users, show: canManageUsers },
  ];

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              AI
            </span>
            <span className="text-base font-bold uppercase leading-tight tracking-wide">
              Sales Expansion
              <br />
              Engine
            </span>
          </Link>
          <button
            className="rounded-md p-1 hover:bg-accent lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {items
            .filter((item) => item.show)
            .map((item) => {
              const isActive =
                pathname === item.href || pathname?.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium uppercase tracking-wide transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <NavPendingIndicator />
                </Link>
              );
            })}
        </nav>
        <div className="border-t border-border p-4 text-xs text-muted-foreground">
          Phase 9 — AI Autonomous Optimization
        </div>
      </aside>
    </>
  );
}
