/**
 * WhatsApp runner — uses Baileys (WhatsApp Web multi-device).
 *
 * Two modes:
 *   setup  — starts Baileys, emits QR codes via an async generator until the
 *             user scans and the session is established, then resolves with the
 *             account identity so the caller can persist the connection.
 *   runner — loads a saved session and starts listening for messages.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../../db/database.js";
import { formatReplyForChannel } from "../formatReply.js";
import { routeMessage } from "../messageRouter.js";
import { withTypingIndicator } from "../typing.js";
import type { ChannelConnection, ChannelReplyOptions } from "../../types.js";

function sessionsRoot(): string {
  const dir = resolve(getProjectRoot(), "server", "data", "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveSessionDir(connectionId: string): string {
  return resolve(sessionsRoot(), `whatsapp-${connectionId}`);
}

function sessionDir(connectionId: string): string {
  const dir = resolveSessionDir(connectionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function moveWhatsAppSession(fromConnectionId: string, toConnectionId: string): void {
  if (fromConnectionId === toConnectionId) return;

  const fromDir = resolveSessionDir(fromConnectionId);
  if (!existsSync(fromDir)) return;

  const toDir = resolveSessionDir(toConnectionId);
  if (existsSync(toDir)) {
    rmSync(toDir, { recursive: true, force: true });
  }

  renameSync(fromDir, toDir);
}

export function deleteWhatsAppSession(connectionId: string): void {
  const dir = resolveSessionDir(connectionId);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

export interface QrEvent {
  type: "qr";
  dataUrl: string;
}

export interface ConnectedEvent {
  type: "connected";
  accountId: string;
  accountName: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type WhatsAppSetupEvent = QrEvent | ConnectedEvent | ErrorEvent;

/**
 * Starts a WhatsApp Web session for setup.
 * Yields QR code data-URLs; resolves with account info once connected.
 * Handles the normal post-scan restart (stream error 515 / restartRequired)
 * by reconnecting and waiting for "open" before yielding "connected".
 */
export async function* setupWhatsApp(connectionId: string): AsyncGenerator<WhatsAppSetupEvent> {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir(connectionId));
  const { default: QRCode } = await import("qrcode");

  const queue: WhatsAppSetupEvent[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  let shouldRestart = false;

  function push(event: WhatsAppSetupEvent): void {
    queue.push(event);
    notify?.();
    notify = null;
  }

  function wake(): void {
    notify?.();
    notify = null;
  }

  async function waitForChange(): Promise<void> {
    if (queue.length > 0 || done || shouldRestart) return;
    await new Promise<void>((r) => {
      notify = r;
    });
  }

  function createSocket(): ReturnType<typeof makeWASocket> {
    shouldRestart = false;
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["Elaine", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        void QRCode.toDataURL(qr).then((dataUrl) => push({ type: "qr", dataUrl }));
      }

      if (connection === "open") {
        const id = sock.user?.id?.split(":")[0] ?? connectionId;
        const name = sock.user?.name ?? id;
        push({ type: "connected", accountId: id, accountName: name });
        done = true;
        wake();
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason === DisconnectReason.restartRequired) {
          // Normal WhatsApp post-pairing restart — reconnect silently
          shouldRestart = true;
          wake();
        } else if (reason === DisconnectReason.loggedOut) {
          done = true;
          wake();
        } else {
          push({ type: "error", message: "Connection closed unexpectedly" });
          done = true;
          wake();
        }
      }
    });

    return sock;
  }

  let sock = createSocket();

  while (!done) {
    await waitForChange();
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (shouldRestart && !done) {
      sock.end(undefined);
      sock = createSocket();
    }
  }

  // Drain any remaining events (e.g. "connected")
  while (queue.length > 0) {
    yield queue.shift()!;
  }
}

export class WhatsAppRunner {
  private connection: ChannelConnection;
  private stopped = false;
  private sock: ReturnType<typeof makeWASocket> | null = null;

  constructor(connection: ChannelConnection) {
    this.connection = connection;
  }

  async start(): Promise<void> {
    const dir = resolveSessionDir(this.connection.id);
    if (!existsSync(dir)) return;

    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.sock?.end(undefined);
  }

  async sendMessage(targetId: string, text: string, _options?: ChannelReplyOptions): Promise<void> {
    if (!this.sock) {
      throw new Error("WhatsApp runner is not connected");
    }
    await this.sock.sendMessage(targetId, { text: formatReplyForChannel("whatsapp", text) });
  }

  private async connect(): Promise<void> {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir(this.connection.id));

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["Elaine", "Chrome", "1.0.0"],
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close" && !this.stopped) {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          void this.connect(); // reconnect
        }
      }
    });

    this.sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
        if (!text) continue;
        const jid = msg.key.remoteJid;
        if (!jid) continue;
        const senderId = msg.key.participant ?? jid;
        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

        void this.handleMessage(jid, senderId, text, mentionedJids);
      }
    });
  }

  private async handleMessage(
    jid: string,
    senderId: string,
    text: string,
    mentionedJids: string[]
  ): Promise<void> {
    if (!this.sock) return;
    try {
      const isDirect = !jid.endsWith("@g.us");
      const botJid = this.sock.user?.id?.split(":")[0] ?? null;
      const isMention = !isDirect && !!botJid && mentionedJids.some((item) => item === botJid);
      if (!this.shouldRouteMessage(isDirect, isMention)) {
        return;
      }

      const conversationKey = isDirect
        ? `${this.connection.id}:dm:${jid}`
        : `${this.connection.id}:chat:${jid}:sender:${senderId}`;
      const reply = await withTypingIndicator(
        async () => {
          if (!this.sock) return;
          await this.sock.presenceSubscribe(jid).catch(() => {});
          await this.sock.sendPresenceUpdate("composing", jid);
        },
        () =>
          routeMessage({
            connectionId: this.connection.id,
            channelId: "whatsapp",
            senderId,
            senderName: null,
            conversationKey,
            replyTargetId: jid,
            text,
          }),
        10000
      );

      if (reply) {
        await this.sendMessage(jid, reply);
      }
    } catch {
      // Ignore routing errors
    } finally {
      await this.sock?.sendPresenceUpdate("paused", jid).catch(() => {});
    }
  }

  private shouldRouteMessage(isDirect: boolean, isMention: boolean): boolean {
    if (isDirect) {
      return true;
    }

    switch (this.connection.routingMode) {
      case "all":
        return true;
      case "mentions":
        return isMention;
      case "direct":
      default:
        return false;
    }
  }
}
