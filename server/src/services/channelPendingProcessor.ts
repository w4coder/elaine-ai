import { routeMessage } from "../channels/messageRouter.js";
import { sendChannelMessage } from "../channels/runnerManager.js";
import { deletePendingChannelMessage } from "../db/repository.js";
import { listPendingMessagesForSender } from "./channelAccess.js";

export async function processPendingMessagesForSender(
  connectionId: string,
  senderId: string
): Promise<void> {
  const pendingMessages = listPendingMessagesForSender(connectionId, senderId);

  for (const pending of pendingMessages) {
    const reply = await routeMessage({
      connectionId: pending.connectionId,
      channelId: pending.channelId,
      senderId: pending.senderId,
      senderName: pending.senderName,
      replyTargetId: pending.replyTargetId,
      text: pending.text,
    });

    if (reply) {
      await sendChannelMessage(pending.connectionId, pending.replyTargetId, reply);
    }

    deletePendingChannelMessage(pending.id);
  }
}
