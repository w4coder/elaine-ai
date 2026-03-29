import type { FastifyReply } from "fastify";
import type { ChatStreamEventMap, EphemeralStreamEventMap } from "../types.js";

function createBaseSse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  return {
    send(event: string, payload: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    },
    close() {
      reply.raw.end();
    },
    onClose(handler: () => void) {
      reply.raw.on("close", handler);
    },
  };
}

export function createSse(reply: FastifyReply) {
  const sse = createBaseSse(reply);
  return {
    send<K extends keyof ChatStreamEventMap>(event: K, payload: ChatStreamEventMap[K]) {
      sse.send(String(event), payload);
    },
    close: sse.close,
  };
}

export function createEphemeralSse(reply: FastifyReply) {
  const sse = createBaseSse(reply);
  return {
    send<K extends keyof EphemeralStreamEventMap>(event: K, payload: EphemeralStreamEventMap[K]) {
      sse.send(String(event), payload);
    },
    close: sse.close,
  };
}

export function createGenericSse(reply: FastifyReply) {
  return createBaseSse(reply);
}
