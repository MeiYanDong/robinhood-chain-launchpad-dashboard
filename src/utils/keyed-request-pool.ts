interface QueuedRequest<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class KeyedRequestPool<T> {
  private active = 0;
  private readonly queue: QueuedRequest<T>[] = [];
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error("Request-pool concurrency must be a positive integer");
    }
  }

  run(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.drain();
    });
    this.inFlight.set(key, promise);
    void promise.then(
      () => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      },
      () => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      },
    );
    return promise;
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const request = this.queue.shift();
      if (!request) return;
      this.active += 1;
      void Promise.resolve()
        .then(request.operation)
        .then(request.resolve, request.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}
