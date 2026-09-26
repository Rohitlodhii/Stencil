import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Next.js App</h1>
      <p className="mt-4 text-lg">This is the frontend application.</p>
      <Link href="/scanner" className="mt-6 text-blue-600 underline">
        Open the sheet scanner
      </Link>
    </main>
  );
}
