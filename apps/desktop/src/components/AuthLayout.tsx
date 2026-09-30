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
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <StencilLogo className="size-5 text-primary-foreground" />
      </span>
      <div>
        <h1 className="font-title text-2xl font-semibold leading-none">Stencil</h1>
        <p className="mt-2 text-xs font-medium text-muted-foreground">University examination workspace</p>
      </div>
    </div>
  );
}

/** Shared authentication panel for onboarding, login, and registration. */
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
    <Card className="border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="font-title text-xl font-semibold">
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
