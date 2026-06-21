import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestStore {
  ip?: string;
  userId?: string;
}

/**
 * Per-request ambient context backed by AsyncLocalStorage. Populated once at the
 * edge (by RequestContextInterceptor) so deeply-nested services — e.g. the audit
 * logger — can read the caller's IP/identity without threading them through every
 * method signature.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestStore>();

  run<T>(store: RequestStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  get(): RequestStore | undefined {
    return this.als.getStore();
  }

  get ip(): string | undefined {
    return this.als.getStore()?.ip;
  }

  get userId(): string | undefined {
    return this.als.getStore()?.userId;
  }
}
