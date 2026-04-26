import { routeMessage } from "../channels/messageRouter.js";
import { sendChannelMessage } from "../channels/runnerManager.js";
import {
  deletePendingChannelCapabilityRequest,
  listPendingChannelCapabilityRequests,
} from "../db/repository.js";

export async function processPendingCapabilityRequestsForConversation(input: {
  connectionId: string;
  scopeKey: string;
  capability: string;
  limit?: number;
}): Promise<void> {
  const pending = listPendingChannelCapabilityRequests(
    input.connectionId,
    input.scopeKey,
    input.capability
  );
  const max = Math.max(1, input.limit ?? pending.length);

  for (const request of pending.slice(0, max)) {
    await sendChannelMessage(
      request.connectionId,
      request.replyTargetId,
      `Approval received for ${request.capability}. Continuing your request now.`,
      {
        threadId: request.replyThreadId,
        replyMessageId: request.replyMessageId,
      }
    ).catch(() => undefined);

    const reply = await routeMessage({
      connectionId: request.connectionId,
      channelId: request.channelId,
      senderId: request.senderId,
      senderName: request.senderName,
      conversationKey: request.conversationKey,
      replyTargetId: request.replyTargetId,
      replyThreadId: request.replyThreadId,
      replyMessageId: request.replyMessageId,
      text: request.text,
    });

    if (reply) {
      await sendChannelMessage(request.connectionId, request.replyTargetId, reply, {
        threadId: request.replyThreadId,
        replyMessageId: request.replyMessageId,
      });
    }

    deletePendingChannelCapabilityRequest(request.id);
  }
}

export async function denyPendingCapabilityRequestsForConversation(input: {
  connectionId: string;
  scopeKey: string;
  capability: string;
}): Promise<void> {
  const pending = listPendingChannelCapabilityRequests(
    input.connectionId,
    input.scopeKey,
    input.capability
  );

  for (const request of pending) {
    await sendChannelMessage(
      request.connectionId,
      request.replyTargetId,
      `I can't use ${request.capability} in this chat without approval.`,
      {
        threadId: request.replyThreadId,
        replyMessageId: request.replyMessageId,
      }
    ).catch(() => undefined);

    deletePendingChannelCapabilityRequest(request.id);
  }
}
