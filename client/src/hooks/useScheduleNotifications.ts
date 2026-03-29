import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { notificationStore } from "../lib/notification-store";
import { useNotifications } from "./useNotifications";

export function useScheduleNotifications(options?: {
  onStarted?: (conversationId: string) => void;
  onStep?: (conversationId: string, content?: string, reasoning?: string) => void;
  onCompleted?: (conversationId: string, success: boolean) => void;
}) {
  const { notify } = useNotifications();
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Bootstrap store from server once on mount
  useEffect(() => {
    void notificationStore.init();
  }, []);

  useEffect(() => {
    const unsubscribe = api.subscribeNotificationEvents({
      onScheduleStarted({ jobTitle, conversationId }) {
        notify(`Schedule started: ${jobTitle}`, {
          body: "Running now…",
          tag: `schedule-start-${conversationId}`,
          targetUrl: `/c/${conversationId}`,
        });
        optionsRef.current?.onStarted?.(conversationId);
      },
      onScheduleStep({ conversationId, content, reasoning }) {
        optionsRef.current?.onStep?.(conversationId, content, reasoning);
      },
      onScheduleCompleted({ jobTitle, conversationId, success }) {
        if (success) {
          notify(`Schedule completed: ${jobTitle}`, {
            body: "Run finished successfully.",
            tag: `schedule-done-${conversationId}`,
            targetUrl: `/c/${conversationId}`,
          });
        } else {
          notify(`Schedule failed: ${jobTitle}`, {
            body: "An error occurred during the run.",
            tag: `schedule-fail-${conversationId}`,
            targetUrl: `/c/${conversationId}`,
          });
        }
        optionsRef.current?.onCompleted?.(conversationId, success);
      },
      // Persist new server-created notifications into the local store
      onNotificationCreated({ notification }) {
        notificationStore.addFromServer(notification);
      },
    });

    return unsubscribe;
  }, [notify]);
}
