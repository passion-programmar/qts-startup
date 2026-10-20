const transientErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

type ErrorWithCause = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

export function isTransientDatabaseConnectionError(error: unknown): boolean {
  let current = error;
  const visited = new Set<unknown>();

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as ErrorWithCause;
    if (
      typeof candidate.code === "string" &&
      transientErrorCodes.has(candidate.code)
    ) {
      return true;
    }
    if (typeof candidate.message === "string") {
      const message = candidate.message.toLowerCase();
      if (
        message.includes("error connecting to database") ||
        message.includes("fetch failed") ||
        message.includes("network connection was lost")
      ) {
        return true;
      }
    }
    current = candidate.cause;
  }

  return false;
}

export async function retryTransientDatabaseRead<T>(
  operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseConnectionError(error)) throw error;
    await wait(150);
    return operation();
  }
}
