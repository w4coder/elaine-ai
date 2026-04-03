import { ArrowLeft, Bell, BellOff, Check, Clock, ExternalLink, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { notificationStore } from "../lib/notification-store";
import type { AppNotification } from "../lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TYPE_COLOR: Record<string, string> = {
  schedule_completed: "#4ade80",
  schedule_started: "#a78bfa",
  schedule_failed: "#f87171",
  channel_permission_request: "#f59e0b",
};

const TYPE_LABEL: Record<string, string> = {
  schedule_completed: "Completed",
  schedule_started: "Started",
  schedule_failed: "Failed",
  channel_permission_request: "Approval",
};

function getChannelPermissionMetadata(notification: AppNotification): {
  connectionId: string;
  channelId: import("../lib/types").ChannelId;
  senderId: string;
  senderName: string | null;
} | null {
  if (notification.type !== "channel_permission_request" || !notification.metadata) {
    return null;
  }

  const metadata = notification.metadata;
  if (
    typeof metadata.connectionId !== "string" ||
    typeof metadata.channelId !== "string" ||
    typeof metadata.senderId !== "string"
  ) {
    return null;
  }

  return {
    connectionId: metadata.connectionId,
    channelId: metadata.channelId as import("../lib/types").ChannelId,
    senderId: metadata.senderId,
    senderName: typeof metadata.senderName === "string" ? metadata.senderName : null,
  };
}

// ─── Notification detail panel ────────────────────────────────────────────────

interface DetailPanelProps {
  id: string;
  onBack?: () => void;
}

function DetailPanel({ id, onBack }: DetailPanelProps) {
  const navigate = useNavigate();
  const [notification, setNotification] = useState<AppNotification | null | undefined>(undefined);

  useEffect(() => {
    setNotification(undefined);
    void api
      .getNotification(id)
      .then((n) => {
        setNotification(n);
        if (!n.read) {
          notificationStore.markRead(n.id);
          setNotification({ ...n, read: true });
        }
      })
      .catch(() => setNotification(null));
  }, [id]);

  if (notification === undefined) {
    return (
      <div className="flex items-center justify-center flex-1 h-full">
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
          Loading…
        </p>
      </div>
    );
  }

  if (notification === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 flex-1 h-full">
        <Bell size={28} style={{ color: "rgba(255,255,255,0.1)" }} />
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
          Notification not found
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs underline"
            style={{ color: "var(--accent)" }}
          >
            Back to notifications
          </button>
        )}
      </div>
    );
  }

  const color = TYPE_COLOR[notification.type] ?? "var(--accent)";
  const channelPermission = getChannelPermissionMetadata(notification);

  return (
    <div className="flex flex-col h-full">
      {/* Detail header */}
      <div
        className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-lg transition-colors md:hidden"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <span className="text-sm font-semibold flex-1" style={{ color: "rgba(255,255,255,0.85)" }}>
          Detail
        </span>
        <button
          type="button"
          onClick={() => {
            notificationStore.remove(notification.id);
            if (onBack) onBack();
            else navigate("/notifications");
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors"
          style={{ background: "rgba(239,68,68,0.08)", color: "#f87171" }}
          title="Delete notification"
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>

      {/* Detail body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div
          className="rounded-2xl p-5 flex flex-col gap-4"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {notification.type in TYPE_LABEL && (
            <span
              className="self-start text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: `${color}20`, color }}
            >
              {TYPE_LABEL[notification.type]}
            </span>
          )}

          <h2 className="text-base font-semibold" style={{ color: "#fff" }}>
            {notification.title}
          </h2>

          {notification.body && (
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              {notification.body}
            </p>
          )}

          <div
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            <Clock size={11} />
            {formatFull(notification.createdAt)}
          </div>

          {channelPermission && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  await api.setChannelSenderPermission({
                    connectionId: channelPermission.connectionId,
                    channelId: channelPermission.channelId,
                    senderId: channelPermission.senderId,
                    senderName: channelPermission.senderName,
                    status: "approved",
                  });
                  notificationStore.remove(notification.id);
                  navigate("/channels");
                }}
                className="self-start flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  color: "#4ade80",
                  border: "1px solid rgba(34,197,94,0.24)",
                }}
              >
                <Check size={13} />
                Allow sender
              </button>
              <button
                type="button"
                onClick={async () => {
                  await api.setChannelSenderPermission({
                    connectionId: channelPermission.connectionId,
                    channelId: channelPermission.channelId,
                    senderId: channelPermission.senderId,
                    senderName: channelPermission.senderName,
                    status: "blocked",
                  });
                  notificationStore.remove(notification.id);
                  navigate("/channels");
                }}
                className="self-start flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{
                  background: "rgba(239,68,68,0.12)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.24)",
                }}
              >
                <X size={13} />
                Block sender
              </button>
            </div>
          )}

          {notification.targetUrl && (
            <button
              type="button"
              onClick={() => navigate(notification.targetUrl!)}
              className="self-start flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
            >
              <ExternalLink size={13} />
              Open conversation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state for detail panel ────────────────────────────────────────────

function DetailEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 h-full">
      <Bell size={32} style={{ color: "rgba(255,255,255,0.08)" }} />
      <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
        Select a notification to read it
      </p>
    </div>
  );
}

// ─── Main layout (split-pane) ─────────────────────────────────────────────────

export function NotificationsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    notificationStore.getAll()
  );

  useEffect(() => {
    return notificationStore.subscribe((items) => setNotifications([...items]));
  }, []);

  function handleSelect(notifId: string) {
    navigate(`/notifications/${notifId}`);
  }

  function handleBack() {
    navigate("/notifications");
  }

  // On mobile: show list when no id, show detail when id is set
  // On md+: always show both panels side by side
  const showList = !id; // mobile: show list only when nothing selected
  const showDetail = !!id; // mobile: show detail only when something selected

  return (
    <div className="flex h-full" style={{ background: "#0f0f11", color: "rgba(255,255,255,0.85)" }}>
      {/* Left: notification list */}
      <div
        className={`
          flex-col h-full overflow-hidden flex-shrink-0
          ${showList ? "flex" : "hidden"} md:flex
          w-full md:w-72 lg:w-80
        `}
        style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}
      >
        {/* Page-level header */}
        <div
          className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <button
            type="button"
            onClick={() => navigate("/")}
            className="p-1 rounded-lg transition-colors"
            style={{ color: "rgba(255,255,255,0.45)" }}
            title="Back to home"
          >
            <ArrowLeft size={15} />
          </button>
          <Bell size={13} style={{ color: "rgba(255,255,255,0.4)" }} />
          <span
            className="text-sm font-semibold flex-1"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Notifications
          </span>
          {notifications.filter((n) => !n.read).length > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {notifications.filter((n) => !n.read).length}
            </span>
          )}
        </div>

        {/* List body */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 h-48">
              <Bell size={28} style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                No notifications
              </p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              {notifications.map((n) => {
                const isSelected = n.id === id;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="group w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
                      style={{
                        background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background =
                            "rgba(255,255,255,0.03)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                      onClick={() => handleSelect(n.id)}
                    >
                      {/* Unread dot */}
                      <div className="flex flex-col items-center pt-1.5 flex-shrink-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: n.read
                              ? "rgba(255,255,255,0.15)"
                              : (TYPE_COLOR[n.type] ?? "var(--accent)"),
                            opacity: n.read ? 0.35 : 1,
                          }}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <span
                            className="text-xs font-medium leading-snug truncate"
                            style={{ color: n.read ? "rgba(255,255,255,0.55)" : "#fff" }}
                          >
                            {n.title}
                          </span>
                          {n.type in TYPE_LABEL && (
                            <span
                              className="text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0"
                              style={{
                                background: `${TYPE_COLOR[n.type] ?? "var(--accent)"}22`,
                                color: TYPE_COLOR[n.type] ?? "var(--accent)",
                              }}
                            >
                              {TYPE_LABEL[n.type]}
                            </span>
                          )}
                        </div>
                        {n.body && (
                          <p
                            className="text-[11px] leading-relaxed line-clamp-2"
                            style={{ color: "rgba(255,255,255,0.35)" }}
                          >
                            {n.body}
                          </p>
                        )}
                        <span
                          className="flex items-center gap-1 text-[10px] mt-0.5"
                          style={{ color: "rgba(255,255,255,0.25)" }}
                        >
                          <Clock size={9} />
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>

                      {/* Row actions */}
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (n.read) notificationStore.markUnread(n.id);
                            else notificationStore.markRead(n.id);
                          }}
                          className="p-1 rounded transition-colors hover:bg-white/10"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                          title={n.read ? "Mark as unread" : "Mark as read"}
                        >
                          {n.read ? <BellOff size={11} /> : <Check size={11} />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            notificationStore.remove(n.id);
                          }}
                          className="p-1 rounded transition-colors hover:bg-red-500/10"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                          title="Delete"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right: detail panel */}
      <div
        className={`
          flex-col flex-1 h-full overflow-hidden
          ${showDetail ? "flex" : "hidden"} md:flex
        `}
      >
        {id ? <DetailPanel id={id} onBack={handleBack} /> : <DetailEmpty />}
      </div>
    </div>
  );
}

// Keep export alias so App.tsx doesn't need changes for the detail route
export { NotificationsPage as NotificationDetailPage };
