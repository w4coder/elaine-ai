# Contributing

## Principles

- Keep the app local-first. Do not add remote dependencies for core behavior unless they remain optional.
- Preserve provider neutrality. OpenAI-compatible endpoints, Ollama, and vLLM should stay first-class citizens.
- Favor small, explicit abstractions over framework-heavy indirection.
- Keep the UI useful for engineering work: code readability, workflow clarity, and session context matter.

## Development flow

1. Install dependencies with `npm install`.
2. Run the app in development with `npm run dev`.
3. Validate changes with `npm run build`.
4. Update documentation when behavior or configuration changes.

## Codebase guidance

- Frontend lives in `client/`.
- Backend lives in `server/`.
- Persistence and schema logic live in `server/src/db/`.
- Provider adapters live in `server/src/providers/`.
- Core chat/title orchestration lives in `server/src/services/`.

## Pull request checklist

- Feature or fix is covered by a manual verification step
- `npm run build` passes
- README/docs stay accurate
- No provider-specific behavior regresses the other local backends
