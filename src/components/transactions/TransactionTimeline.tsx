import React from "react";
import {
  CheckCircle2,
  Clock,
  Package,
  Truck,
  CreditCard,
  AlertTriangle,
  User,
  Store,
  ShieldCheck,
} from "lucide-react";
import { TimelineActor } from "@/types";
import { formatDate } from "@/lib/utils";

export interface TimelineEventItem {
  id?: string;
  title: string;
  description?: string | null;
  actor: TimelineActor;
  createdAt: string;
}

interface TransactionTimelineProps {
  events: TimelineEventItem[];
  emptyMessage?: string;
}

export function TransactionTimeline({
  events,
  emptyMessage = "No events recorded yet.",
}: TransactionTimelineProps) {
  if (!events || events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-surface-500">
        <Clock className="mx-auto h-8 w-8 text-surface-400 mb-2" />
        {emptyMessage}
      </div>
    );
  }

  const getActorBadge = (actor: TimelineActor) => {
    switch (actor) {
      case "BUYER":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
            <User className="h-3 w-3" /> Buyer
          </span>
        );
      case "SELLER":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <Store className="h-3 w-3" /> Verified Seller
          </span>
        );
      case "CARRIER":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
            <Truck className="h-3 w-3" /> Logistics Carrier
          </span>
        );
      case "SYSTEM":
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-surface-600 bg-surface-100 px-2 py-0.5 rounded-full border border-surface-200">
            <ShieldCheck className="h-3 w-3" /> Automated System
          </span>
        );
    }
  };

  const getEventIcon = (title: string, actor: TimelineActor) => {
    const t = title.toLowerCase();
    if (t.includes("payment") || t.includes("paid")) {
      return <CreditCard className="h-4 w-4 text-emerald-600" />;
    }
    if (t.includes("shipment") || t.includes("dispatched") || t.includes("carrier")) {
      return <Truck className="h-4 w-4 text-indigo-600" />;
    }
    if (t.includes("delivered")) {
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    }
    if (t.includes("dispute") || t.includes("return") || t.includes("cancelled")) {
      return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    }
    if (t.includes("order")) {
      return <Package className="h-4 w-4 text-brand-600" />;
    }
    return <Clock className="h-4 w-4 text-surface-500" />;
  };

  return (
    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-200">
      {events.map((event, index) => (
        <div key={event.id || index} className="relative flex items-start gap-4">
          <div className="absolute -left-6 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-4 ring-white shadow-sm border border-surface-200">
            {getEventIcon(event.title, event.actor)}
          </div>
          <div className="flex-1 bg-surface-50/60 rounded-lg p-3.5 border border-surface-200/80">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h4 className="text-sm font-semibold text-surface-900">{event.title}</h4>
              <div className="flex items-center gap-2">
                {getActorBadge(event.actor)}
                <span className="text-xs text-surface-400">{formatDate(event.createdAt)}</span>
              </div>
            </div>
            {event.description && (
              <p className="text-xs text-surface-600 leading-relaxed mt-1">
                {event.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
