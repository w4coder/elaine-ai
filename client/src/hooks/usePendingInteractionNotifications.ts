import { useEffect, useRef } from "react";
import type { AskUserQuestion, PermissionRequest } from "../lib/types";

const REMINDER_MS = 2 * 60 * 1000; // 2 minutes

interface ScheduleReady {
  title: string;
  description: string;
  prompt: string;
}

interface Options {
  pendingPermission: PermissionRequest | null;
  pendingQuestions: AskUserQuestion[] | null;
  scheduleReady: ScheduleReady | null;
  conversationId: string | null;
  conversationTitle: string;
  notify(title: string, opts: { body?: string; targetUrl?: string }): void;
}

type PendingKind =
  | { kind: "permission"; request: PermissionRequest }
  | { kind: "ask_user"; count: number }
  | { kind: "schedule"; title: string }
  | null;

function resolvePending(
  pendingPermission: PermissionRequest | null,
  pendingQuestions: AskUserQuestion[] | null,
  scheduleReady: ScheduleReady | null
): PendingKind {
  if (pendingPermission) return { kind: "permission", request: pendingPermission };
  if (pendingQuestions) return { kind: "ask_user", count: pendingQuestions.length };
  if (scheduleReady) return { kind: "schedule", title: scheduleReady.title };
  return null;
}

function buildNotification(
  pending: NonNullable<PendingKind>,
  label: string
): { title: string; body: string } {
  switch (pending.kind) {
    case "permission":
      return {
        title: "Permission required",
        body: `Agent wants to use "${pending.request.skillName}" in ${label}`,
      };
    case "ask_user":
      return {
        title: "Agent needs your input",
        body: `Agent has ${pending.count} question(s) waiting in ${label}`,
      };
    case "schedule":
      return {
        title: "Schedule ready to confirm",
        body: `"${pending.title}" is ready to schedule in ${label}`,
      };
  }
}

/**
 * Fires a browser + in-app notification when any user interaction is pending
 * (permission request, ask_user questions, or schedule confirmation):
 *
 *   1. Immediately — if the page is hidden at the moment the interaction arrives.
 *   2. On visibilitychange — if the page goes to background while still pending.
 *   3. After 2 minutes — only if the page is hidden at that moment (reminder).
 *
 * Notifications are NOT fired for state that is restored from storage on page
 * load or navigation — only for genuinely new interactions arriving via SSE.
 * A new interaction is detected when the pending kind changes WITHOUT the
 * conversation ID also changing (both changing together = navigation/restore).
 */
export function usePendingInteractionNotifications({
  pendingPermission,
  pendingQuestions,
  scheduleReady,
  conversationId,
  conversationTitle,
  notify,
}: Options): void {
  const prevRef = useRef<{ convId: string | null; kind: string | null }>({
    convId: null,
    kind: null,
  });
  const firedRef = useRef(false);

  useEffect(() => {
    const pending = resolvePending(pendingPermission, pendingQuestions, scheduleReady);
    const kind = pending?.kind ?? null;
    const prev = prevRef.current;

    const convChanged = conversationId !== prev.convId;
    const kindChanged = kind !== prev.kind;

    prevRef.current = { convId: conversationId, kind };

    // Only treat as a new interaction when the pending kind appeared without
    // the conversation ID also changing. If both change together it means the
    // user navigated to a conversation that already had pending state in the
    // DB (a restore), so we must not fire.
    const isNewInteraction = kindChanged && kind !== null && !convChanged;

    if (!isNewInteraction || !conversationId) {
      if (!pending) firedRef.current = false;
      return;
    }

    firedRef.current = false;

    const label = conversationTitle || "a conversation";
    const targetUrl = `/c/${conversationId}`;
    const { title, body } = buildNotification(pending!, label);

    // 1. Fire immediately if the page is already hidden.
    if (document.visibilityState === "hidden") {
      notify(title, { body, targetUrl });
      firedRef.current = true;
    }

    // 2. Fire when the page goes to background while still pending.
    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && !firedRef.current) {
        notify(title, { body, targetUrl });
        firedRef.current = true;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 3. Reminder after 2 minutes — only fires if page is hidden at that moment.
    const reminder = setTimeout(() => {
      if (document.visibilityState === "hidden") {
        notify(`Reminder: ${title}`, {
          body: `Still waiting for your response — ${body}`,
          targetUrl,
        });
      }
    }, REMINDER_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(reminder);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPermission, pendingQuestions, scheduleReady, conversationId]);
}
