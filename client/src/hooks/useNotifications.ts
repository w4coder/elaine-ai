import { useCallback } from "react";

/** In-app notifications are persisted server-side; browser notifications are disabled. */
export function useNotifications() {
  const notify = useCallback(
    (_title: string, _options: NotificationOptions & { targetUrl?: string }) => {},
    []
  );

  return { notify };
}
