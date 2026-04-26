import { ArrowLeft, Check, Hash, MessageCircle, MessageSquare, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { notificationStore } from "../lib/notification-store";
import type {
  AppNotification,
  ChannelCapabilityGrant,
  ChannelDescriptor,
  ChannelConnection,
  ChannelId,
  ChannelRoutingMode,
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

const ROUTING_OPTIONS: Array<{
  value: ChannelRoutingMode;
  label: string;
  description: string;
}> = [
  { value: "direct", label: "DMs only", description: "Only direct/private chats trigger replies." },
  {
    value: "mentions",
    label: "Mentions",
    description: "Direct chats always work; group replies require a mention.",
  },
  { value: "all", label: "All messages", description: "Reply to every visible message." },
];

function supportsThreadReplies(provider: ChannelId): boolean {
  return provider === "slack" || provider === "discord" || provider === "telegram";
}

function describeConversationKey(connectionId: string, conversationKey: string): string {
  if (conversationKey.startsWith(`${connectionId}:target:`)) {
    return `target:${conversationKey.slice(`${connectionId}:target:`.length)}`;
  }

  if (conversationKey.startsWith(`${connectionId}:`)) {
    return conversationKey.slice(connectionId.length + 1);
  }

  return conversationKey;
}

function formatCapabilityDecision(decision: ChannelCapabilityGrant["decision"]): string {
  if (decision === "chat") {
    return "Allowed in this chat";
  }
  if (decision === "once") {
    return "Allowed once";
  }
  return "Denied";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

// ─── Channel card ─────────────────────────────────────────────────────────────

interface ChannelCardProps {
  channel: ChannelDescriptor;
  connection: ChannelConnection | undefined;
  saving: boolean;
  onConnect(provider: ChannelId): void;
  onDisconnect(connection: ChannelConnection): void;
  onUpdateSettings(
    connection: ChannelConnection,
    patch: Partial<Pick<ChannelConnection, "routingMode" | "replyInThread">>
  ): void;
}

function ChannelCard({
  channel,
  connection,
  saving,
  onConnect,
  onDisconnect,
  onUpdateSettings,
}: ChannelCardProps) {
  const connected = !!connection;
  const selectedRouting =
    ROUTING_OPTIONS.find((option) => option.value === connection?.routingMode) ??
    ROUTING_OPTIONS[0];

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
              disabled={saving}
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
              disabled={saving}
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

        {connected && (
          <div
            className="pt-4 mt-2 flex flex-col gap-3"
            style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
          >
            <label className="flex flex-col gap-1">
              <span
                className="text-[11px] uppercase tracking-[0.18em]"
                style={{ color: "rgba(255,255,255,0.35)" }}
              >
                Routing
              </span>
              <select
                value={connection.routingMode}
                disabled={saving}
                onChange={(event) =>
                  onUpdateSettings(connection, {
                    routingMode: event.target.value as ChannelRoutingMode,
                  })
                }
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.88)",
                }}
              >
                {ROUTING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
              {selectedRouting.description}
            </p>

            {supportsThreadReplies(channel.id) && (
              <label
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.88)" }}>
                    Reply in thread
                  </span>
                  <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Keep group replies attached to the original message when supported.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={connection.replyInThread}
                  disabled={saving}
                  onChange={(event) =>
                    onUpdateSettings(connection, {
                      replyInThread: event.target.checked,
                    })
                  }
                />
              </label>
            )}
          </div>
        )}
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
  const [capabilityGrants, setCapabilityGrants] = useState<ChannelCapabilityGrant[]>([]);
  const [pendingNotifications, setPendingNotifications] = useState<AppNotification[]>([]);
  const [savingConnectionId, setSavingConnectionId] = useState<string | null>(null);
  const [grantActionKey, setGrantActionKey] = useState<string | null>(null);

  useEffect(() => {
    void notificationStore.init();
    void Promise.all([
      api.listChannels(),
      api.listChannelAccounts(),
      api.listChannelSenders(),
      api.listChannelCapabilities(),
      api.listNotifications({ limit: 100 }),
    ]).then(([chans, conns, senders, grants, notifications]) => {
      setChannels(chans);
      setConnections(conns);
      setSenderPermissions(senders);
      setCapabilityGrants(grants);
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
    setCapabilityGrants((prev) => prev.filter((entry) => entry.connectionId !== connection.id));
  }

  async function handleUpdateChannelSettings(
    connection: ChannelConnection,
    patch: Partial<Pick<ChannelConnection, "routingMode" | "replyInThread">>
  ) {
    setSavingConnectionId(connection.id);
    try {
      const updated = await api.updateChannelAccount(connection.id, patch);
      setConnections((prev) =>
        prev.map((current) => (current.id === updated.id ? updated : current))
      );
    } finally {
      setSavingConnectionId(null);
    }
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

  async function revokeCapabilityGrant(payload: {
    connectionId: string;
    conversationKey?: string;
    capability?: string;
  }) {
    const actionKey = [
      payload.connectionId,
      payload.conversationKey ?? "*",
      payload.capability ?? "*",
    ].join(":");

    setGrantActionKey(actionKey);
    try {
      await api.revokeChannelCapability(payload);
      setCapabilityGrants((prev) =>
        prev.filter((entry) => {
          if (entry.connectionId !== payload.connectionId) {
            return true;
          }
          if (payload.conversationKey && entry.conversationKey !== payload.conversationKey) {
            return true;
          }
          if (payload.capability && entry.capability !== payload.capability) {
            return true;
          }
          return false;
        })
      );
    } finally {
      setGrantActionKey(null);
    }
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

  const capabilityConnections = connections
    .map((connection) => ({
      connection,
      grants: capabilityGrants.filter((entry) => entry.connectionId === connection.id),
    }))
    .filter((entry) => entry.grants.length > 0);

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
            {channels.map((channel) => {
              const connection = connections.find((item) => item.provider === channel.id);
              return (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  connection={connection}
                  saving={savingConnectionId === connection?.id}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                  onUpdateSettings={handleUpdateChannelSettings}
                />
              );
            })}
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

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                Capability Grants
              </h2>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Review and revoke chat-scoped channel tool approvals.
              </span>
            </div>

            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {capabilityConnections.length === 0 ? (
                <div className="px-4 py-5 text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                  No saved capability grants yet.
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  {capabilityConnections.map(({ connection, grants }) => (
                    <div key={connection.id} className="px-4 py-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div
                            className="text-sm font-medium"
                            style={{ color: "rgba(255,255,255,0.9)" }}
                          >
                            {connection.accountName ??
                              connection.accountEmail ??
                              connection.accountId}
                          </div>
                          <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {connection.provider} · {grants.length} saved grant
                            {grants.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={grantActionKey === `${connection.id}:*:*`}
                          onClick={() =>
                            void revokeCapabilityGrant({ connectionId: connection.id })
                          }
                          className="px-3 py-1.5 rounded-lg text-xs"
                          style={{
                            background: "rgba(239,68,68,0.12)",
                            color: "#f87171",
                          }}
                        >
                          Revoke all
                        </button>
                      </div>

                      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                        {grants.map((entry) => {
                          const revokeOneKey = [
                            entry.connectionId,
                            entry.conversationKey,
                            entry.capability,
                          ].join(":");
                          const revokeChatKey = [
                            entry.connectionId,
                            entry.conversationKey,
                            "*",
                          ].join(":");

                          return (
                            <div
                              key={`${entry.connectionId}:${entry.conversationKey}:${entry.capability}`}
                              className="py-3 flex items-center gap-3"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className="text-sm font-medium"
                                    style={{ color: "rgba(255,255,255,0.9)" }}
                                  >
                                    {entry.capability}
                                  </span>
                                  <span
                                    className="text-[10px] px-2 py-0.5 rounded-full"
                                    style={{
                                      background:
                                        entry.decision === "deny"
                                          ? "rgba(239,68,68,0.14)"
                                          : "rgba(56,189,248,0.14)",
                                      color: entry.decision === "deny" ? "#f87171" : "#67e8f9",
                                    }}
                                  >
                                    {formatCapabilityDecision(entry.decision)}
                                  </span>
                                </div>
                                <div
                                  className="text-xs mt-1 break-all"
                                  style={{ color: "rgba(255,255,255,0.35)" }}
                                >
                                  Chat:{" "}
                                  {describeConversationKey(connection.id, entry.conversationKey)}
                                </div>
                                <div
                                  className="text-xs mt-1"
                                  style={{ color: "rgba(255,255,255,0.35)" }}
                                >
                                  Updated {formatTimestamp(entry.updatedAt)}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap justify-end">
                                <button
                                  type="button"
                                  disabled={grantActionKey === revokeChatKey}
                                  onClick={() =>
                                    void revokeCapabilityGrant({
                                      connectionId: entry.connectionId,
                                      conversationKey: entry.conversationKey,
                                    })
                                  }
                                  className="px-3 py-1.5 rounded-lg text-xs"
                                  style={{
                                    background: "rgba(255,255,255,0.08)",
                                    color: "rgba(255,255,255,0.7)",
                                  }}
                                >
                                  Revoke chat
                                </button>
                                <button
                                  type="button"
                                  disabled={grantActionKey === revokeOneKey}
                                  onClick={() =>
                                    void revokeCapabilityGrant({
                                      connectionId: entry.connectionId,
                                      conversationKey: entry.conversationKey,
                                      capability: entry.capability,
                                    })
                                  }
                                  className="px-3 py-1.5 rounded-lg text-xs"
                                  style={{
                                    background: "rgba(239,68,68,0.12)",
                                    color: "#f87171",
                                  }}
                                >
                                  Revoke
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
