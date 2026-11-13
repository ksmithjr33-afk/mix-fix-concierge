// Shown the moment a team page is opened, while the server loads it, so the
// screen never looks frozen. No data and no sign in check here: the page
// itself does both and replaces this as soon as it is ready.

export default function TeamLoading() {
  return (
    <>
      <header className="flex items-center px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC] print:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- the same logo tag as the team header */}
        <img src="/logo.png" alt="The Mix Fix" className="h-8 sm:h-10" />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4" aria-busy="true">
        <p role="status" className="px-1 text-[15px] text-[#6B5D52]">
          Loading…
        </p>
        <div className="space-y-3 motion-safe:animate-pulse" aria-hidden="true">
          <div className="h-7 w-1/2 rounded-lg bg-[#DDD5CC]" />
          <div className="h-10 rounded-xl bg-[#DDD5CC]" />
          <div className="h-24 rounded-2xl bg-[#EFE7DF] border border-[#DDD5CC]" />
          <div className="h-24 rounded-2xl bg-[#EFE7DF] border border-[#DDD5CC]" />
          <div className="h-24 rounded-2xl bg-[#EFE7DF] border border-[#DDD5CC]" />
        </div>
      </main>
    </>
  );
}
