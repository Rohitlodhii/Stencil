import { StencilLogo } from "@/components/StencilLogo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Static logo + app title. Never animated. */
export function AuthHeader() {
  return (
    <div className="flex items-center gap-3">
      <StencilLogo />
      <h1 className="font-title text-3xl font-bold leading-none tracking-tight">
        Stencil
      </h1>
    </div>
  );
}

/** Shared borderless bg-sidebar card for onboarding + login + register.
 *  Only this card slides left/right between steps (see PublicShell). */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-0 bg-sidebar shadow-none">
      <CardHeader>
        <CardTitle className="font-title text-xl font-bold tracking-tight">
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
