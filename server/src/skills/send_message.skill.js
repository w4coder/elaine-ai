/**
 * send_message.skill.js
 *
 * Send a message to a user via a configured social integration
 * (Telegram, Slack, Discord, etc.)
 * using the IntegrationEngine.
 *
 * Use integrationEngine.list() via a prior tool call to discover available
 * integration IDs and their names/types.
 *
 * Returns: { sent: true } on success.
 * Returns: { sent: false, reason: string } on failure.
 */

export default {
  name: "send_message",

  description:
    "Send a text message to a user via a configured social integration " +
    "(Telegram, Slack, Discord, …). " +
    "Use the integration ID from the integrations list. " +
    "chatId is the recipient channel/user/chat ID when the integration needs one. " +
    "Returns { sent: true } on success or { sent: false, reason } on failure.",

  input_schema: {
    type: "object",
    properties: {
      integrationId: {
        type: "string",
        description: "ID of the social integration to use (from the /integrations list).",
      },
      chatId: {
        type: "string",
        description: "Target chat or user ID (required for Telegram).",
      },
      text: {
        type: "string",
        description: "Message text to send.",
      },
    },
    required: ["integrationId", "text"],
  },

  async execute(input = {}, { integrationEngine } = {}) {
    if (!integrationEngine) {
      return {
        sent: false,
        reason: "Social integrations are not available. Check backend configuration.",
      };
    }

    const { integrationId, chatId = "", text } = input;
    if (!integrationId) return { sent: false, reason: '"integrationId" is required' };
    if (!String(text || "").trim()) return { sent: false, reason: '"text" must not be empty' };

    try {
      await integrationEngine.sendMessage(integrationId, chatId, String(text));
      return { sent: true };
    } catch (err) {
      return { sent: false, reason: err.message };
    }
  },
};
