import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatReplyForChannel } from "./formatReply.js";

describe("formatReplyForChannel", () => {
  test("formats Slack-friendly markdown", () => {
    const formatted = formatReplyForChannel(
      "slack",
      "# Status\nRead [docs](https://example.com/docs)\n\n**Ready** and ~~old~~"
    );

    assert.match(formatted, /\*Status\*/);
    assert.match(formatted, /<https:\/\/example\.com\/docs\|docs>/);
    assert.match(formatted, /\*Ready\*/);
    assert.match(formatted, /~old~/);
  });

  test("formats Discord-friendly text without masked links", () => {
    const formatted = formatReplyForChannel(
      "discord",
      "## Notes\nSee [runbook](https://example.com/runbook)"
    );

    assert.match(formatted, /\*\*Notes\*\*/);
    assert.match(formatted, /runbook: https:\/\/example\.com\/runbook/);
    assert.doesNotMatch(formatted, /\[runbook\]\(/);
  });

  test("formats Telegram as clean plain text", () => {
    const formatted = formatReplyForChannel(
      "telegram",
      "# Deploy\nUse `npm test` after **setup**.\n\n```ts\nconst ok = true;\n```"
    );

    assert.match(formatted, /^Deploy/m);
    assert.match(formatted, /Use npm test after setup\./);
    assert.match(formatted, / {4}const ok = true;/);
    assert.doesNotMatch(formatted, /```/);
  });

  test("formats WhatsApp with supported emphasis", () => {
    const formatted = formatReplyForChannel(
      "whatsapp",
      "### Update\nOpen [ticket](https://example.com/ticket)\n\n**Done** and ~~closed~~"
    );

    assert.match(formatted, /\*Update\*/);
    assert.match(formatted, /ticket: https:\/\/example\.com\/ticket/);
    assert.match(formatted, /\*Done\*/);
    assert.match(formatted, /~closed~/);
  });
});
