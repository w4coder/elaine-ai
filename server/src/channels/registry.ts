/**
 * Channel registry — four messaging channels Elaine can receive messages on
 * and reply through. Inspired by OpenClaw's plugin registry pattern.
 *
 * Auth strategies:
 *   "token" — user provides a bot/app token; validation happens via the
 *              platform's REST API before the runner starts.
 *   "qr"    — WhatsApp Web session bootstrapped by scanning a QR code via Baileys.
 */

import type { ChannelId } from "../types.js";

export type ChannelAuthType = "token" | "qr";

export interface ChannelDescriptor {
  id: ChannelId;
  label: string;
  description: string;
  authType: ChannelAuthType;
  color: string;
  docsUrl: string;
  tokenLabel?: string;
  tokenPlaceholder?: string;
  /** Second required credential (Slack app-level token for Socket Mode) */
  token2Label?: string;
  token2Placeholder?: string;
  needsClientCredentials: boolean;
}

interface ChannelEntry {
  descriptor: ChannelDescriptor;
}

const CHANNEL_ORDER: ChannelId[] = ["telegram", "whatsapp", "discord", "slack"];

const CHANNELS: Record<ChannelId, ChannelEntry> = {
  telegram: {
    descriptor: {
      id: "telegram",
      label: "Telegram",
      description: "Users message your Telegram bot; Elaine replies",
      authType: "token",
      color: "#0088cc",
      docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
      tokenLabel: "Bot Token",
      tokenPlaceholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      needsClientCredentials: false,
    },
  },

  whatsapp: {
    descriptor: {
      id: "whatsapp",
      label: "WhatsApp",
      description: "Scan QR with WhatsApp to connect via WhatsApp Web",
      authType: "qr",
      color: "#25d366",
      docsUrl: "https://faq.whatsapp.com/1317564962315842",
      needsClientCredentials: false,
    },
  },

  discord: {
    descriptor: {
      id: "discord",
      label: "Discord",
      description: "Elaine responds to messages in any channel the bot can read",
      authType: "token",
      color: "#5865f2",
      docsUrl: "https://discord.com/developers/applications",
      tokenLabel: "Bot Token",
      tokenPlaceholder: "MTa…",
      needsClientCredentials: false,
    },
  },

  slack: {
    descriptor: {
      id: "slack",
      label: "Slack",
      description: "Elaine responds to messages in Slack via Socket Mode",
      authType: "token",
      color: "#4a154b",
      docsUrl: "https://api.slack.com/apps",
      tokenLabel: "Bot Token (xoxb-…)",
      tokenPlaceholder: "xoxb-…",
      token2Label: "App-Level Token (xapp-…)",
      token2Placeholder: "xapp-…",
      needsClientCredentials: false,
    },
  },
};

export function getChannelRegistry(): ChannelDescriptor[] {
  return CHANNEL_ORDER.map((id) => CHANNELS[id].descriptor);
}

export function getChannelDescriptor(id: ChannelId): ChannelDescriptor {
  return CHANNELS[id].descriptor;
}

export function getTokenChannelIds(): ChannelId[] {
  return CHANNEL_ORDER.filter((id) => CHANNELS[id].descriptor.authType === "token");
}
