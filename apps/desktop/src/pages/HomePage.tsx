import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <main className="flex min-h-full w-full flex-1 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Home</h1>
      <p className="text-sm text-muted-foreground">
        Clean slate — scanner moved to its own route.
      </p>
      <div className="flex items-center gap-3">
        <Link
          to="/exam"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Create exam
        </Link>
        <Link
          to="/scanner"
          className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Go to Scanner
        </Link>
      </div>
    </main>
  );
}
