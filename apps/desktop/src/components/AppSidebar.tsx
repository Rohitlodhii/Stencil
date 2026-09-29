import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StencilLogo } from "@/components/StencilLogo";
import {
  ClipboardCheckIcon,
  Activity01Icon,
  FileAddIcon,
  FileScanIcon,
  Home01Icon,
  Logout01Icon,
  UserIcon,
  UsersIcon,
} from "@hugeicons/core-free-icons";
import { fetchFinalExams, type FinalExam } from "@/lib/exam";
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

export function AppSidebar({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const role = session.user.role;
  const demoMode = session.user.status === "demo";
  const location = useLocation();
  const [assignedExams, setAssignedExams] = useState<FinalExam[]>([]);

  const NAV =
    role === "coordinator"
      ? [
          { to: "/", label: "Dashboard", icon: Home01Icon, end: true },
          { to: "/exam", label: "Create exam", icon: FileAddIcon, end: false },
          { to: "/teachers", label: "Teachers", icon: UsersIcon, end: false },
          { to: "/students", label: "Students", icon: UserIcon, end: false },
          { to: "/status", label: "System status", icon: Activity01Icon, end: false },
        ]
      : [
          { to: "/", label: "Dashboard", icon: Home01Icon, end: true },
          { to: "/check-exam", label: "Check Exam", icon: ClipboardCheckIcon, end: false },
          { to: "/status", label: "System status", icon: Activity01Icon, end: false },
          ...(demoMode ? [] : [{ to: "/scanner", label: "Scanner", icon: FileScanIcon, end: false }]),
        ];

  // Teacher: load assigned exams so the "Check Exam" sidebar section can list them.
  useEffect(() => {
    if (role !== "teacher") return;
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
  }, [role, session.user.name, location.pathname]);

  return (
    <Sidebar collapsible="icon" className="hidden lg:flex">
      <SidebarHeader>
        <div
          className={
            collapsed
              ? "flex h-10 items-center justify-center"
              : "flex h-10 items-center gap-2 px-2"
          }
        >
          <StencilLogo className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <span className="font-title text-sm font-semibold tracking-tight">
              Stencil
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Navigation</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <NavLink to={item.to} end={item.end} className="block">
                    {({ isActive }) => (
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                      >
                        <span>
                          <HugeiconsIcon
                            icon={item.icon}
                            size={18}
                            strokeWidth={1.75}
                            color="currentColor"
                          />
                          {!collapsed && <span>{item.label}</span>}
                        </span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {role === "teacher" && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel>Check Exam</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {assignedExams.length === 0 && (
                  <p className="px-2 py-1 text-xs text-sidebar-foreground/60">
                    No exams assigned yet.
                  </p>
                )}
                {assignedExams.map((exam) => (
                  <SidebarMenuItem key={exam.id}>
                    <NavLink
                      to={`/check-exam/${exam.id}`}
                      end
                      className="block"
                      title={`${exam.subject_name} — Check`}
                    >
                      {({ isActive }) => (
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={`${exam.subject_name} — Check`}
                        >
                          <span>
                            <HugeiconsIcon
                              icon={ClipboardCheckIcon}
                              size={16}
                              strokeWidth={1.75}
                              color="currentColor"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {exam.subject_name}
                            </span>
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

        {!collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel>
              {role === "coordinator" ? "Coordinator" : "Teacher"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-sidebar-foreground/80">
                <HugeiconsIcon icon={UserIcon} size={14} color="currentColor" />
                <span className="truncate">
                  {session.user.name} · {session.user.college}
                </span>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Logout" onClick={onLogout}>
              <HugeiconsIcon
                icon={Logout01Icon}
                size={18}
                strokeWidth={1.75}
                color="currentColor"
              />
              {!collapsed && <span>Logout</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {!collapsed && (
          <p className="px-2 text-[11px] text-sidebar-foreground/60">
            Tauri desktop
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
