"use client";

import ChatThread, { type ChatProps } from "../../../e/[id]/chat-thread";
import { useActiveTab } from "./manager-tabs";

/** The event team chat on the manager view's Chat tab: loads and marks read while the tab is open. */
export default function ManagerChat(props: ChatProps) {
  const active = useActiveTab() === "chat";
  return (
    <section className="space-y-2">
      <h2 className="px-1 font-heading text-base font-bold text-[#2C2420]">
        Message team
        {props.unread > 0 && !active && <span className="ml-2 align-middle rounded-full bg-[#A0412D] px-1.5 text-[11px] font-bold text-white">{props.unread} unread</span>}
      </h2>
      <ChatThread {...props} active={active} />
    </section>
  );
}
