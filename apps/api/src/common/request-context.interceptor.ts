import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context';

/**
 * Seeds the per-request AsyncLocalStorage with the caller's IP and (if already
 * authenticated by the guards) user id. Runs after guards, so req.user is set.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly ctx: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const store = {
      ip: clientIp(req),
      userId: req?.user?.id,
    };
    // Run the rest of the request pipeline inside the ALS context so any service
    // it reaches (e.g. AuditService) sees this store.
    return this.ctx.run(store, () => next.handle());
  }
}

/**
 * Best-effort client IP. Prefers the left-most X-Forwarded-For hop (the original
 * client) when behind a proxy, falling back to the socket / Express-derived ip.
 */
function clientIp(req: {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string | undefined {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (fwd) {
    const first = (Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  return normalizeIp(req?.ip ?? req?.socket?.remoteAddress);
}

/**
 * Tidy the raw address into something readable in the audit log:
 *  - IPv6 loopback (::1) → 127.0.0.1 (what an operator expects for localhost)
 *  - IPv4-mapped IPv6 (::ffff:203.0.113.7) → 203.0.113.7
 */
function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  if (ip === '::1') return '127.0.0.1';
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped ? mapped[1] : ip;
}
