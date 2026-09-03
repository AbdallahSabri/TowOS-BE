import { ulid } from 'ulid';
import type { Params } from 'nestjs-pino';

/**
 * BE-SPEC §9: structured, one line per request, explicit allowlist of loggable
 * fields. No customer name, phone, email, address, plate, or VIN reaches a log,
 * IDs only, and credentials never appear in a log. The `serializers` below are
 * that allowlist for req/res: only method, path (query string stripped) and
 * status code are logged, by construction - not by trying to redact everything
 * else after the fact. `redact` is defense in depth for anything logged later
 * outside these serializers (e.g. a future `logger.error({ ...body })` call).
 */
export function buildPinoOptions(logLevel: string): Params {
  return {
    pinoHttp: {
      level: logLevel,
      genReqId: () => `req_${ulid()}`,
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: stripQueryString(req.url),
        }),
        res: (res: { statusCode: number }) => ({
          statusCode: res.statusCode,
        }),
      },
      redact: {
        paths: [
          'req.headers',
          '*.password',
          '*.token',
          '*.secret',
          '*.authorization',
          '*.cookie',
        ],
        remove: true,
      },
    },
  };
}

function stripQueryString(url: string | undefined): string {
  if (!url) {
    return '';
  }
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}
