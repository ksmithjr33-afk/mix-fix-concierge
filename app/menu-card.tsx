"use client";

import { useEffect, useState } from "react";
import { knownMenus, MENU_INFO } from "@/lib/menu-markers";

function MenuCard({ menu }: { menu: keyof typeof MENU_INFO }) {
  const [open, setOpen] = useState(false);
  const { src, caption, width, height } = MENU_INFO[menu];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge ${caption}`}
        className="block w-full overflow-hidden rounded-2xl rounded-bl-md border border-[#DDD5CC] bg-[#F5F0EB] text-left"
      >
        {/* Width and height reserve the space so the chat does not jump when it loads. */}
        <img src={src} alt={caption} width={width} height={height} loading="lazy" className="block h-auto w-full" />
        <span className="block px-3.5 py-2 text-sm font-medium text-[#2C2420]">{caption}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={caption}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 overflow-auto bg-black/80 p-3"
        >
          <button
            type="button"
            aria-label="Close menu"
            className="fixed right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#F5F0EB] text-xl text-[#2C2420]"
          >
            ×
          </button>
          <img src={src} alt={caption} width={width} height={height} className="mx-auto block h-auto w-full max-w-3xl" />
        </div>
      )}
    </>
  );
}

/** The menu images under an assistant message, the same width as its bubble. */
export default function MenuCards({ menus, className }: { menus: unknown; className: string }) {
  const list = knownMenus(menus);
  if (list.length === 0) return null;
  return (
    <div className="flex justify-start">
      <div className={`space-y-2 ${className}`}>
        {list.map((menu) => (
          <MenuCard key={menu} menu={menu} />
        ))}
      </div>
    </div>
  );
}
