/**
 * Queue-based rate limiter for Notion API.
 * Enforces max 3 requests/second with exponential backoff on 429 errors.
 */
export class RateLimiter {
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly intervalMs: number;
  private lastCallTime = 0;

  constructor(requestsPerSecond = 3, maxConcurrent = 1) {
    this.intervalMs = Math.ceil(1000 / requestsPerSecond);
    this.maxConcurrent = maxConcurrent;
  }

  /** Enqueue a function to be rate-limited */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;

    const item = this.queue.shift();
    if (!item) return;

    this.running++;

    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    const waitTime = Math.max(0, this.intervalMs - elapsed);

    if (waitTime > 0) {
      await this.delay(waitTime);
    }

    this.lastCallTime = Date.now();

    try {
      const result = await this.executeWithRetry(item.fn);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.running--;
      this.processQueue();
    }
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 5
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRateLimited = error?.status === 429 || error?.code === "rate_limited";
        if (!isRateLimited || attempt === maxRetries) throw error;

        const retryAfter = this.parseRetryAfter(error);
        const backoff = retryAfter || Math.min(1000 * Math.pow(2, attempt), 30000);
        await this.delay(backoff);
      }
    }
    throw new Error("Rate limiter: max retries exceeded");
  }

  private parseRetryAfter(error: any): number | null {
    const header = error?.headers?.["retry-after"];
    if (header) {
      const seconds = parseFloat(header);
      if (!isNaN(seconds)) return seconds * 1000;
    }
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Number of items waiting in the queue */
  get pending(): number {
    return this.queue.length;
  }

  /** Clear all pending items */
  clear(): void {
    for (const item of this.queue) {
      item.reject(new Error("Rate limiter cleared"));
    }
    this.queue = [];
  }
}
