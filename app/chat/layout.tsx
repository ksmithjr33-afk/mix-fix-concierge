import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Mix Fix | Bar Planning Concierge",
  description:
    "Let's plan your bar service! Design your cocktail menu, lock in your event details, and get everything set in about 5 minutes.",
  openGraph: {
    title: "The Mix Fix | Bar Planning Concierge",
    description:
      "Let's plan your bar service! Design your cocktail menu, lock in your event details, and get everything set in about 5 minutes.",
    images: [{ url: "https://plan.themixfix.com/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Mix Fix | Bar Planning Concierge",
    description:
      "Let's plan your bar service! Design your cocktail menu, lock in your event details, and get everything set in about 5 minutes.",
    images: ["https://plan.themixfix.com/og-image.png"],
  },
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
