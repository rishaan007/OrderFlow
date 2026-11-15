import * as React from "react";
import { cn } from "@/lib/utils";
import { FolderOpen } from "lucide-react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-surface-300 bg-surface-50/50 p-8 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-100 text-surface-500 mb-4">
        {icon || <FolderOpen className="h-6 w-6" />}
      </div>
      <h4 className="text-base font-semibold text-surface-900 mb-1">{title}</h4>
      <p className="max-w-sm text-sm text-surface-500 mb-5">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
