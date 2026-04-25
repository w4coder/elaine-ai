import { api } from "./api";
import type { AppNotification } from "./types";

// Re-export so existing consumers (NotificationCenter, useNotifications) keep working
export type { AppNotification as InAppNotification };

type Listener = (notifications: AppNotification[]) => void;

class NotificationStore {
  private items: AppNotification[] = [];
  private readonly listeners = new Set<Listener>();
  private initialized = false;

  getAll(): AppNotification[] {
    return this.items;
  }

  unreadCount(): number {
    return this.items.filter((n) => !n.read).length;
  }

  /** Bootstrap from server once. Subsequent calls are no-ops to avoid overwriting optimistic updates. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const notifications = await api.listNotifications({ limit: 100 });
      this.items = notifications;
      this.notify();
    } catch {
      this.initialized = false; // allow retry on failure
    }
  }

  /** Called when SSE delivers a new notification_created event. */
  addFromServer(notification: AppNotification): void {
    // Avoid duplicates
    if (this.items.some((n) => n.id === notification.id)) return;
    this.items = [notification, ...this.items].slice(0, 200);
    this.notify();
  }

  markRead(id: string): void {
    this.items = this.items.map((n) => (n.id === id ? { ...n, read: true } : n));
    this.notify();
    void api.markNotificationRead(id, true).catch(() => undefined);
  }

  markUnread(id: string): void {
    this.items = this.items.map((n) => (n.id === id ? { ...n, read: false } : n));
    this.notify();
    void api.markNotificationRead(id, false).catch(() => undefined);
  }

  markAllRead(): void {
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.notify();
    void api.markAllNotificationsRead().catch(() => undefined);
  }

  remove(id: string): void {
    this.items = this.items.filter((n) => n.id !== id);
    this.notify();
    void api.deleteNotification(id).catch(() => undefined);
  }

  upsert(notification: AppNotification): void {
    const existingIndex = this.items.findIndex((item) => item.id === notification.id);
    if (existingIndex === -1) {
      this.items = [notification, ...this.items].slice(0, 200);
    } else {
      this.items = this.items.map((item) => (item.id === notification.id ? notification : item));
    }
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.items);
  }
}

export const notificationStore = new NotificationStore();
