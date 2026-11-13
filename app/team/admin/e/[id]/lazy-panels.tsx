"use client";

// Tab panels whose code loads only when their tab is open. The server still
// renders them, so the page looks the same; the phone just skips downloading
// the code for tabs nobody opened.

import dynamic from "next/dynamic";

export const AssignPanel = dynamic(() => import("./assign-panel"));
export const ShiftPanel = dynamic(() => import("./shift-panel"));
export const OrderSheet = dynamic(() => import("./order/order-sheet"));
export const ClientListPanel = dynamic(() => import("./client-list-panel"));
export const Closeouts = dynamic(() => import("./closeouts"));
export const BarReadyCard = dynamic(() => import("../../../e/[id]/bar-ready"));
export const ManagerChat = dynamic(() => import("./manager-chat"));
