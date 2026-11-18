import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Mix Fix | Partner portal",
  description: "Bar planning for event planners working with The Mix Fix.",
  robots: { index: false, follow: false },
};

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#E8DDD5]">{children}</div>;
}
