import { ArrowLeft, Check, Hash, MessageCircle, MessageSquare, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { notificationStore } from "../lib/notification-store";
import type {
  AppNotification,
  ChannelDescriptor,
  ChannelConnection,
  ChannelId,
  ChannelSenderPermission,
} from "../lib/types";

// ─── Client-side icon map (React components can't come from the server) ────────

const iconSize = 20;

const CHANNEL_ICONS: Record<ChannelId, React.ReactNode> = {
  telegram: <Send size={iconSize} />,
  whatsapp: <MessageSquare size={iconSize} />,
  discord: <Hash size={iconSize} />,
  slack: <MessageCircle size={iconSize} />,
};

// ─── Channel card ─────────────────────────────────────────────────────────────

interface ChannelCardProps {
  channel: ChannelDescriptor;
  connection: ChannelConnection | undefined;
  onConnect(provider: ChannelId): void;
  onDisconnect(connection: ChannelConnection): void;
}

function ChannelCard({ channel, connection, onConnect, onDisconnect }: ChannelCardProps) {
  const connected = !!connection;

  return (
    <div
      className="rounded-2xl flex flex-col overflow-hidden transition-all"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: connected ? `1px solid ${channel.color}44` : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Color accent bar */}
      <div
        className="h-1 w-full"
        style={{ background: connected ? channel.color : "rgba(255,255,255,0.06)" }}
      />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Icon + status */}
        <div className="flex items-start justify-between gap-2">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${channel.color}18`, color: channel.color }}
          >
            {CHANNEL_ICONS[channel.id]}
          </div>
          {connected && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: "rgba(34,197,94,0.12)",
                color: "#4ade80",
                border: "1px solid rgba(34,197,94,0.2)",
              }}
            >
              <Check size={9} />
              Connected
            </span>
          )}
        </div>

        {/* Label + subtext */}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
            {channel.label}
          </span>
          <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
            {connection
              ? (connection.accountName ?? connection.accountEmail ?? connection.accountId)
              : channel.description}
          </p>
        </div>

        {/* Action row */}
        <div className="mt-auto flex items-center gap-2">
          {connected ? (
            <button
              type="button"
              onClick={() => onDisconnect(connection!)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: "rgba(239,68,68,0.1)",
                color: "#f87171",
                border: "1px solid rgba(239,68,68,0.18)",
              }}
            >
              <Trash2 size={11} />
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onConnect(channel.id)}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: `${channel.color}20`,
                color: channel.color,
                border: `1px solid ${channel.color}40`,
              }}
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<ChannelDescriptor[]>([]);
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [senderPermissions, setSenderPermissions] = useState<ChannelSenderPermission[]>([]);
  const [pendingNotifications, setPendingNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    void notificationStore.init();
    void Promise.all([
      api.listChannels(),
      api.listChannelAccounts(),
      api.listChannelSenders(),
      api.listNotifications({ limit: 100 }),
    ]).then(([chans, conns, senders, notifications]) => {
      setChannels(chans);
      setConnections(conns);
      setSenderPermissions(senders);
      setPendingNotifications(
        notifications.filter((notification) => notification.type === "channel_permission_request")
      );
    });
  }, []);

  useEffect(() => {
    return notificationStore.subscribe((items) => {
      setPendingNotifications(
        items.filter((notification) => notification.type === "channel_permission_request")
      );
    });
  }, []);

  async function handleConnect(_provider: ChannelId) {
    // Connect is handled via the Settings > Channels tab
    navigate("/settings?tab=channels");
  }

  async function handleDisconnect(connection: ChannelConnection) {
    await api.disconnectChannel(connection.id);
    setConnections((prev) => prev.filter((c) => c.id !== connection.id));
    setSenderPermissions((prev) => prev.filter((entry) => entry.connectionId !== connection.id));
  }

  async function updateSenderPermission(
    entry: ChannelSenderPermission,
    status: "approved" | "blocked"
  ) {
    const updated = await api.setChannelSenderPermission({
      connectionId: entry.connectionId,
      channelId: entry.channelId,
      senderId: entry.senderId,
      senderName: entry.senderName,
      status,
    });
    setSenderPermissions((prev) => [
      updated,
      ...prev.filter(
        (current) =>
          !(current.connectionId === updated.connectionId && current.senderId === updated.senderId)
      ),
    ]);
  }

  async function resolvePendingNotification(
    notification: AppNotification,
    status: "approved" | "blocked"
  ) {
    const metadata = notification.metadata;
    if (
      !metadata ||
      typeof metadata.connectionId !== "string" ||
      typeof metadata.channelId !== "string" ||
      typeof metadata.senderId !== "string"
    ) {
      return;
    }

    const updated = await api.setChannelSenderPermission({
      connectionId: metadata.connectionId,
      channelId: metadata.channelId as ChannelId,
      senderId: metadata.senderId,
      senderName: typeof metadata.senderName === "string" ? metadata.senderName : null,
      status,
    });

    notificationStore.remove(notification.id);
    setSenderPermissions((prev) => [
      updated,
      ...prev.filter(
        (current) =>
          !(current.connectionId === updated.connectionId && current.senderId === updated.senderId)
      ),
    ]);
  }

  async function resetSenderPermission(entry: ChannelSenderPermission) {
    await api.deleteChannelSenderPermission(entry.connectionId, entry.senderId);
    setSenderPermissions((prev) =>
      prev.filter(
        (current) =>
          !(current.connectionId === entry.connectionId && current.senderId === entry.senderId)
      )
    );
  }

  const unresolvedPendingNotifications = pendingNotifications.filter((notification) => {
    const metadata = notification.metadata;
    if (
      !metadata ||
      typeof metadata.connectionId !== "string" ||
      typeof metadata.senderId !== "string"
    ) {
      return false;
    }

    return !senderPermissions.some(
      (entry) =>
        entry.connectionId === metadata.connectionId && entry.senderId === metadata.senderId
    );
  });

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "#0f0f11", color: "rgba(255,255,255,0.85)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-base font-semibold">Channels</h1>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
            Connect messaging channels. Tokens are encrypted on your device and never leave your
            machine.
          </p>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
          >
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                connection={connections.find((c) => c.provider === channel.id)}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                Pending Requests
              </h2>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                New senders wait here until you allow or block them.
              </span>
            </div>

            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {unresolvedPendingNotifications.length === 0 ? (
                <div className="px-4 py-5 text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                  No pending sender approvals.
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  {unresolvedPendingNotifications.map((notification) => {
                    const metadata = notification.metadata as Record<string, unknown>;
                    const channel = channels.find((item) => item.id === metadata.channelId);
                    const connection = connections.find(
                      (item) => item.id === metadata.connectionId
                    );
                    const senderName =
                      typeof metadata.senderName === "string" && metadata.senderName.trim()
                        ? metadata.senderName
                        : String(metadata.senderId);
                    return (
                      <div key={notification.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-sm font-medium"
                            style={{ color: "rgba(255,255,255,0.9)" }}
                          >
                            {senderName}
                          </div>
                          <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {channel?.label ?? String(metadata.channelId)}
                            {" · "}
                            {connection?.accountName ??
                              connection?.accountId ??
                              String(metadata.connectionId)}
                            {" · "}
                            {String(metadata.senderId)}
                          </div>
                          {typeof metadata.messagePreview === "string" &&
                            metadata.messagePreview && (
                              <div
                                className="text-xs mt-1"
                                style={{ color: "rgba(255,255,255,0.5)" }}
                              >
                                {metadata.messagePreview}
                              </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void resolvePendingNotification(notification, "approved")
                            }
                            className="px-3 py-1.5 rounded-lg text-xs"
                            style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80" }}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            onClick={() => void resolvePendingNotification(notification, "blocked")}
                            className="px-3 py-1.5 rounded-lg text-xs"
                            style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
                          >
                            Block
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                Sender Permissions
              </h2>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                First message from a new sender creates an approval request.
              </span>
            </div>

            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {senderPermissions.length === 0 ? (
                <div className="px-4 py-5 text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                  No sender decisions yet.
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  {senderPermissions.map((entry) => {
                    const connection = connections.find((item) => item.id === entry.connectionId);
                    const channel = channels.find((item) => item.id === entry.channelId);
                    return (
                      <div
                        key={`${entry.connectionId}:${entry.senderId}`}
                        className="px-4 py-3 flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-sm font-medium"
                              style={{ color: "rgba(255,255,255,0.9)" }}
                            >
                              {entry.senderName ?? entry.senderId}
                            </span>
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full"
                              style={{
                                background:
                                  entry.status === "approved"
                                    ? "rgba(34,197,94,0.14)"
                                    : "rgba(239,68,68,0.14)",
                                color: entry.status === "approved" ? "#4ade80" : "#f87171",
                              }}
                            >
                              {entry.status}
                            </span>
                          </div>
                          <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {channel?.label ?? entry.channelId}
                            {" · "}
                            {connection?.accountName ?? connection?.accountId ?? entry.connectionId}
                            {" · "}
                            {entry.senderId}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void updateSenderPermission(entry, "approved")}
                            className="px-3 py-1.5 rounded-lg text-xs"
                            style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80" }}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateSenderPermission(entry, "blocked")}
                            className="px-3 py-1.5 rounded-lg text-xs"
                            style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
                          >
                            Block
                          </button>
                          <button
                            type="button"
                            onClick={() => void resetSenderPermission(entry)}
                            className="px-3 py-1.5 rounded-lg text-xs"
                            style={{
                              background: "rgba(255,255,255,0.08)",
                              color: "rgba(255,255,255,0.65)",
                            }}
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
