// src/modules/provisoning/retry.util.ts

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean; // exponential backoff
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, delayMs = 5000, backoff = true, onRetry } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        throw lastError;
      }

      const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;

      if (onRetry) {
        onRetry(lastError, attempt);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
