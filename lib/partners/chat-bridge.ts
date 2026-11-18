// The partner chat route hands its checked planner to the concierge chat route
// in process: it builds a Request, attaches the planner here, and calls the
// chat route's POST. Only server code can attach, so a browser request to
// /api/chat can never claim to be a planner. Server only.

import type { EventAccess } from "@/lib/partners/db";
import type { PlannerChatContext } from "@/lib/partners/chat";
import type { MoneyAccess } from "@/lib/partners/rules";

export interface PartnerChat {
  access: EventAccess;
  ctx: PlannerChatContext;
  money: MoneyAccess;
}

const byRequest = new WeakMap<Request, PartnerChat>();

export function attachPartnerChat(request: Request, chat: PartnerChat): Request {
  byRequest.set(request, chat);
  return request;
}

export function partnerChatFor(request: Request): PartnerChat | null {
  return byRequest.get(request) ?? null;
}
