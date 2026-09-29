import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, LogOut, Menu, UserRound } from "lucide-react";
import { StencilLogo } from "@/components/StencilLogo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Session } from "@/lib/auth";
import { getNavigation, routeBreadcrumbs } from "@/lib/navigation";

export function WorkspaceHeader({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const location = useLocation();
  const breadcrumbs = routeBreadcrumbs(location.pathname);
  const navigation = getNavigation(session.user.role);

  return (
    <header className="flex h-14 shrink-0 items-center border-b bg-background px-4 sm:px-6">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="mr-2 lg:hidden" aria-label="Open navigation">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(88vw,320px)] p-0">
          <SheetHeader className="border-b p-5">
            <SheetTitle className="flex items-center gap-2 font-title text-lg">
              <StencilLogo className="size-5" /> Stencil
            </SheetTitle>
            <SheetDescription>University examination workspace</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <SheetClose key={item.to} asChild>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`
                    }
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </NavLink>
                </SheetClose>
              );
            })}
          </nav>
          <div className="mt-auto border-t p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{session.user.college}</p>
              </div>
            </div>
            <Button type="button" variant="outline" className="w-full justify-start" onClick={onLogout}>
              <LogOut /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {breadcrumbs.map((item, index) => (
            <li key={`${item}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className={index === breadcrumbs.length - 1 ? "truncate font-semibold" : "hidden text-muted-foreground sm:inline"}>
                {item}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-xs text-muted-foreground">
          {session.user.role === "coordinator" ? "Coordinator" : "Examiner"}
        </span>
        <span className="size-1 rounded-full bg-border" />
        <span className="max-w-44 truncate text-sm font-medium">{session.user.name}</span>
      </div>
    </header>
  );
}
