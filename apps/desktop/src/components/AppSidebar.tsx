import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ClipboardCheck, LogOut, UserRound } from "lucide-react";
import { StencilLogo } from "@/components/StencilLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Session } from "@/lib/auth";
import { fetchFinalExams, type FinalExam } from "@/lib/exam";
import { getNavigation } from "@/lib/navigation";

export function AppSidebar({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const [assignedExams, setAssignedExams] = useState<FinalExam[]>([]);
  const navigation = getNavigation(session.user.role);

  useEffect(() => {
    if (session.user.role !== "teacher") return;
    let cancelled = false;
    fetchFinalExams(session.user.name)
      .then((exams) => {
        if (!cancelled) setAssignedExams(exams);
      })
      .catch(() => {
        if (!cancelled) setAssignedExams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.role, session.user.name, location.pathname]);

  const renderNavigation = (group: "workspace" | "resources") => (
    <SidebarMenu>
      {navigation.filter((item) => item.group === group).map((item) => {
        const Icon = item.icon;
        return (
          <SidebarMenuItem key={item.to}>
            <NavLink to={item.to} end={item.end} className="block">
              {({ isActive }) => (
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                  <span>
                    <Icon className="size-4" />
                    {!collapsed && <span>{item.label}</span>}
                  </span>
                </SidebarMenuButton>
              )}
            </NavLink>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="icon" className="hidden lg:flex">
      <SidebarHeader className="border-b px-3 py-3">
        <div className={collapsed ? "flex h-9 items-center justify-center" : "flex h-9 items-center gap-2.5 px-1"}>
          <StencilLogo className="size-5 shrink-0" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-title text-sm font-bold">Stencil</p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">Examination workspace</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-4 py-3">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>{renderNavigation("workspace")}</SidebarGroupContent>
        </SidebarGroup>

        {session.user.role === "teacher" && !collapsed && assignedExams.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Current assignments</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {assignedExams.slice(0, 4).map((exam) => (
                  <SidebarMenuItem key={exam.id}>
                    <NavLink to={`/check-exam/${exam.id}`} end className="block">
                      {({ isActive }) => (
                        <SidebarMenuButton asChild isActive={isActive} tooltip={exam.subject_name}>
                          <span>
                            <ClipboardCheck className="size-4" />
                            <span className="min-w-0 flex-1 truncate">{exam.subject_name}</span>
                          </span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Resources</SidebarGroupLabel>
          <SidebarGroupContent>{renderNavigation("resources")}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        {!collapsed && (
          <div className="mb-1 flex items-center gap-2.5 rounded-md bg-sidebar-accent/60 p-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
              <UserRound className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{session.user.name}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">{session.user.college}</p>
            </div>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={onLogout}>
              <LogOut className="size-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
