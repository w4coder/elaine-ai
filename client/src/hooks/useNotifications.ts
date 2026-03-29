import { useCallback, useEffect, useRef } from "react";

/** Requests browser notification permission on first call (no-op if already granted/denied). */
export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => {
        permissionRef.current = p;
      });
    }
  }, []);

  /** Fire a browser notification only (in-app persistence is handled server-side). */
  const notify = useCallback(
    (title: string, options: NotificationOptions & { targetUrl?: string }) => {
      const { targetUrl, body, ...notifOptions } = options;
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const n = new Notification(title, { body, ...notifOptions });
        if (targetUrl) {
          n.onclick = () => {
            window.focus();
            window.location.href = targetUrl;
          };
        }
      }
    },
    []
  );

  return { notify };
}
