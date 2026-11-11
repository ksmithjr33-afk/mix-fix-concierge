"use client";

import { useState } from "react";
import type { CloseoutView } from "@/lib/team/closeout-db";
import { timeLabel } from "@/lib/team/clock-label";
import { CloseoutSummary } from "../../../e/[id]/closeout-card";

// Closeouts from the bartenders on this event, with earlier saves.
function One({ c, tz }: { c: CloseoutView; tz?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-2 border-t border-[#EDE6DF] pt-3 first:border-0 first:pt-0">
      <p className="font-medium text-[#2C2420]">{c.staffFirstName}</p>
      <CloseoutSummary c={c} tz={tz} />
      {c.versions.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm text-[#6B5D52] underline">
            {open ? "Hide earlier versions" : `Earlier versions (${c.versions.length})`}
          </button>
          {open && (
            <ul className="text-sm text-[#6B5D52] space-y-1">
              {c.versions.map((v) => (
                <li key={v.version}>
                  Version {v.version}, {timeLabel(v.at, undefined, tz)}: {v.rating.replace("_", " ")}
                  {v.photoUrl && (
                    <a href={v.photoUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#B5845A] underline">
                      photo
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export default function Closeouts({ closeouts, timeZone }: { closeouts: CloseoutView[]; timeZone?: string }) {
  return (
    <section className="bg-white rounded-2xl border border-[#DDD5CC] p-4 space-y-3">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Closeouts ({closeouts.length})</h2>
      <ul className="space-y-3">
        {closeouts.map((c) => (
          <One key={c.id} c={c} tz={timeZone} />
        ))}
      </ul>
    </section>
  );
}
