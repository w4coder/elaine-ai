import pino from "pino";

/**
 * Shared structured logger for server-side modules that don't have direct
 * access to the Fastify app instance (e.g. background memory jobs).
 *
 * Uses the same pino library that powers Fastify's built-in logger, so all
 * log output is consistently structured JSON in production and pretty-printed
 * in development.
 */
export const logger = pino({ name: "elaine" });
