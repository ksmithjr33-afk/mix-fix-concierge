import Link from "next/link";

// The 403 page (forbidden()): the Scorecard pages for anyone but admins and managers.
export default function Forbidden() {
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-3">
      <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Not available</h1>
      <p className="text-[15px] text-[#6B5D52]">This page is for admins and managers.</p>
      <Link href="/team/events" className="text-sm text-[#B5845A] underline">
        Back to events
      </Link>
    </main>
  );
}
