import {
  Activity,
  ClipboardCheck,
  Download,
  FilePlus2,
  GraduationCap,
  Home,
  ScanLine,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth";

export type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  group: "workspace" | "resources";
};

export function getNavigation(role: Role): NavigationItem[] {
  const workspace: NavigationItem[] =
    role === "coordinator"
      ? [
          { to: "/", label: "Dashboard", icon: Home, end: true, group: "workspace" },
          { to: "/exam", label: "Create examination", icon: FilePlus2, group: "workspace" },
          { to: "/students", label: "Students", icon: GraduationCap, group: "workspace" },
          { to: "/teachers", label: "Examiners", icon: Users, group: "workspace" },
        ]
      : [
          { to: "/", label: "Dashboard", icon: Home, end: true, group: "workspace" },
          { to: "/check-exam", label: "Assigned examinations", icon: ClipboardCheck, group: "workspace" },
          { to: "/scanner", label: "Sheet scanner", icon: ScanLine, group: "workspace" },
        ];

  return [
    ...workspace,
    { to: "/status", label: "System status", icon: Activity, group: "resources" },
    { to: "/download", label: "Desktop app", icon: Download, group: "resources" },
  ];
}

export function routeBreadcrumbs(pathname: string) {
  if (pathname === "/") return ["Dashboard"];
  if (pathname === "/exam") return ["Examinations", "Create examination"];
  if (pathname === "/students") return ["Students"];
  if (pathname === "/students/new") return ["Students", "Import student data"];
  if (pathname.startsWith("/students/")) return ["Students", "Dataset details"];
  if (pathname === "/teachers") return ["Examiners"];
  if (pathname === "/check-exam") return ["Examinations", "Assigned examinations"];
  if (/^\/check-exam\/[^/]+\/check\//.test(pathname)) {
    return ["Examinations", "Student evaluation"];
  }
  if (pathname.startsWith("/check-exam/")) return ["Examinations", "Examination details"];
  if (pathname === "/scanner") return ["Tools", "Sheet scanner"];
  if (pathname === "/status") return ["Resources", "System status"];
  if (pathname === "/download") return ["Resources", "Desktop app"];
  return ["Stencil"];
}
