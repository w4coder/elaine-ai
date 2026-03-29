import { Bell, BellDot, Clock, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationStore, type InAppNotification } from "../lib/notification-store";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const TYPE_COLOR: Record<string, string> = {
  schedule_completed: "var(--accent)",
  schedule_started: "#a78bfa",
  schedule_failed: "#f87171",
};

export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>(() =>
    notificationStore.getAll()
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => notificationStore.subscribe(setNotifications), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const unread = notifications.filter((n) => !n.read).length;

  function handleItemClick(n: InAppNotification) {
    notificationStore.markRead(n.id);
    setOpen(false);
    navigate(`/notifications/${n.id}`);
  }

  function handleViewAll() {
    setOpen(false);
    navigate("/notifications");
  }

  return (
    <div className="relative z-10">
      {/* Bell button with unread badge */}
      <button
        ref={buttonRef}
        type="button"
        className="icon-button relative flex items-center justify-center rounded-sm"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        {unread > 0 ? <BellDot size={20} /> : <Bell size={20} />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-white text-[10px] font-semibold leading-4 flex items-center justify-center pointer-events-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-white/10 bg-[var(--surface)] shadow-xl overflow-hidden flex flex-col"
          style={{ maxHeight: "440px" }}
        >
          {/* Header */}
          <div className="flex items-center px-4 py-3 border-b border-white/8 flex-shrink-0">
            <span className="text-sm font-medium text-[var(--text)]">Notifications</span>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--text-muted)]">
                <Bell size={28} className="opacity-30" />
                <p className="text-xs">No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`w-full text-left px-4 py-3 flex flex-col gap-0.5 border-b border-white/5 transition-colors hover:bg-white/5 ${n.read ? "opacity-55" : ""}`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span
                        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: TYPE_COLOR[n.type] ?? "var(--accent)" }}
                      />
                    )}
                    <span
                      className={`text-xs font-medium leading-snug flex-1 ${!n.read ? "text-white" : "text-[var(--text)]"}`}
                    >
                      {n.title}
                    </span>
                  </div>
                  {n.body && (
                    <p className="text-xs text-[var(--text-soft)] leading-relaxed pl-3.5">{n.body}</p>
                  )}
                  <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] mt-0.5 pl-3.5">
                    <Clock size={9} />
                    {timeAgo(n.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Footer — View all */}
          <button
            type="button"
            onClick={handleViewAll}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs! border-t border-white/8 hover:bg-white/5 transition-colors flex-shrink-0"
            style={{ color: "var(--accent)" }}
          >
            <ExternalLink size={11} />
            View all notifications
            {unread > 0 && (
              <span
                className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {unread}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
