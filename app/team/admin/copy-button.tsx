"use client";

import { useState } from "react";

/** Copies text to the clipboard and says so for two seconds. */
export default function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: select a hidden field and copy it.
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium">
      {copied ? "Copied" : label}
    </button>
  );
}
