import React from "react";
import { ShieldAlert, ShieldCheck, ShieldPlus, ShieldOff } from "lucide-react";
import type { PermissionRequest } from "../lib/types";

const CAPABILITY_LABELS: Record<string, { label: string; description: string }> = {
  network: { label: "Network access", description: "Fetch URLs and external web pages" },
  filesystem_read: {
    label: "File system (read)",
    description: "Read files and search directories on your machine",
  },
  filesystem_write: {
    label: "File system (write)",
    description: "Write and modify files on your machine",
  },
  shell: { label: "Shell execution", description: "Run shell commands on your machine" },
};

interface PermissionWidgetProps {
  request: PermissionRequest;
  onAllowOnce(): void;
  onAllowThread(): void;
  onDeny(): void;
}

export function PermissionWidget({
  request,
  onAllowOnce,
  onAllowThread,
  onDeny,
}: PermissionWidgetProps) {
  const cap = CAPABILITY_LABELS[request.capability] ?? {
    label: request.capability,
    description: `Use the ${request.capability} capability`,
  };

  return (
    <div className="my-3 rounded-xl border border-yellow-500/40 bg-yellow-500/5 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
        <div className="flex-1 min-w-0">
          <p className="text-s font-medium text-[var(--color-text-primary)]">Permission required</p>
          <p className="mt-0.5 text-[16px] text-[var(--color-text-secondary)]">
            The agent wants to use{" "}
            <span className="font-mono text-[var(--color-text-primary)]">{request.skillName}</span>,
            which requires <strong>{cap.label}</strong>: {cap.description}.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col  flex-wrap gap-2">
        <button
          onClick={onAllowOnce}
          className="flex items-center gap-1.5 rounded-lg bg-yellow-500/20 px-3 py-1.5 text-[16px]! font-medium text-yellow-300 hover:bg-yellow-500/30 transition-colors"
          title="Allow this one call only — you will be asked again next time"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Allow once
        </button>
        <button
          onClick={onAllowThread}
          className="flex items-center gap-1.5 rounded-lg bg-yellow-500/30 px-3 py-1.5 text-[16px]! font-medium text-yellow-200 hover:bg-yellow-500/40 transition-colors"
          title="Allow for the rest of this conversation — won't ask again in this thread"
        >
          <ShieldPlus className="h-3.5 w-3.5" />
          Allow in this thread
        </button>
        <button
          onClick={onDeny}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          title="Deny — the agent will stop this action"
        >
          <ShieldOff className="h-3.5 w-3.5" />
          Deny
        </button>
      </div>
    </div>
  );
}
