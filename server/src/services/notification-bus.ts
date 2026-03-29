export type NotificationEvent =
  | { type: "schedule_started"; jobId: string; jobTitle: string; conversationId: string }
  | { type: "schedule_step"; conversationId: string; content?: string; reasoning?: string }
  | { type: "schedule_completed"; jobId: string; jobTitle: string; conversationId: string; success: boolean }
  | { type: "notification_created"; notification: { id: string; type: string; title: string; body: string | null; targetUrl: string | null; read: boolean; createdAt: string } };

class NotificationBus {
  private readonly listeners = new Set<(event: NotificationEvent) => void>();

  subscribe(listener: (event: NotificationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: NotificationEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const notificationBus = new NotificationBus();
