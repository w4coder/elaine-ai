export async function withTypingIndicator<T>(
  sendTyping: () => Promise<void>,
  task: () => Promise<T>,
  intervalMs: number = 4000
): Promise<T> {
  await sendTyping().catch(() => {});

  const timer = setInterval(() => {
    void sendTyping().catch(() => {});
  }, intervalMs);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}
