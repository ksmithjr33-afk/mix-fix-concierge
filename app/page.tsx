import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col min-h-dvh bg-[#E8DDD5]">
      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-16 text-center">
        <div className="max-w-lg mx-auto space-y-6 sm:space-y-8">
          {/* Logo area */}
          <div className="space-y-2">
            <img
              src="/logo.png"
              alt="The Mix Fix"
              className="h-16 sm:h-20 mx-auto"
            />
            <p className="text-base sm:text-lg text-[#B5845A] font-medium tracking-wide">
              AI Bar Concierge
            </p>
          </div>

          {/* Description */}
          <p className="text-base sm:text-[17px] leading-relaxed text-[#6B5D52] max-w-md mx-auto px-2">
            This quick chat replaces the planning call. By the time we are done,
            your cocktail menu, shopping list, and every detail will be locked
            in.
          </p>

          {/* CTA */}
          <Link
            href="/chat"
            className="inline-block bg-[#B5845A] text-white text-base sm:text-lg font-medium px-8 sm:px-10 py-3.5 sm:py-4 rounded-2xl hover:bg-[#9A7049] transition-colors shadow-lg shadow-[#B5845A]/20"
          >
            Start Planning
          </Link>

          {/* Stats */}
          <div className="flex items-center justify-center gap-4 sm:gap-10 pt-4">
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-[#2C2420] font-heading">
                5 min
              </div>
              <div className="text-xs text-[#A39585] mt-1">Avg Chat</div>
            </div>
            <div className="w-px h-10 bg-[#DDD5CC]" />
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-[#2C2420] font-heading">
                100%
              </div>
              <div className="text-xs text-[#A39585] mt-1">Automated</div>
            </div>
            <div className="w-px h-10 bg-[#DDD5CC]" />
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-[#2C2420] font-heading">
                Custom
              </div>
              <div className="text-xs text-[#A39585] mt-1">
                Cocktail Menus
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 sm:py-6 text-xs text-[#A39585]">
        The Mix Fix &middot; Premium Private Bartending &middot; Dallas, Texas
      </footer>
    </div>
  );
}
