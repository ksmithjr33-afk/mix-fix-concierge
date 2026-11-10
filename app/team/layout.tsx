import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Mix Fix | Team",
  description: "The Mix Fix team portal.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#E8DDD5]">{children}</div>;
}
