import {neon} from '@neondatabase/serverless';
import {isSafeImageKey, presignDownload, presignUpload, type S3Config} from './images';
import {applyPush, pullChanges, type SyncChange} from './sync';

export interface Env {
  DATABASE_URL: string;
  SYNC_API_KEY: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  S3_BUCKET: string;
  /** Set for R2 or any S3-compatible service; empty for AWS S3. */
  S3_ENDPOINT?: string;
}

/** Largest batch a single push may carry, to bound memory and request time. */
const MAX_PUSH_CHANGES = 1000;
const MAX_PULL_LIMIT = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

/**
 * Constant-time comparison.
 *
 * A plain `===` on a secret leaks its prefix through timing. The cost here is
 * negligible and the habit is worth keeping.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorised(request: Request, env: Env): boolean {
  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix) || !env.SYNC_API_KEY) {
    return false;
  }
  return secretsMatch(header.slice(prefix.length), env.SYNC_API_KEY);
}

function s3ConfigFrom(env: Env): S3Config {
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    bucket: env.S3_BUCKET,
    endpoint: env.S3_ENDPOINT,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/v1/health') {
      return json({ok: true});
    }

    if (!authorised(request, env)) {
      return json({error: 'unauthorised'}, 401);
    }

    const sql = neon(env.DATABASE_URL);

    try {
      if (url.pathname === '/v1/sync/push' && request.method === 'POST') {
        const body = (await request.json()) as {changes?: SyncChange[]};
        const changes = Array.isArray(body.changes) ? body.changes : [];
        if (changes.length > MAX_PUSH_CHANGES) {
          return json({error: `at most ${MAX_PUSH_CHANGES} changes per push`}, 413);
        }
        return json(await applyPush(sql, changes));
      }

      if (url.pathname === '/v1/sync/pull' && request.method === 'GET') {
        const cursor = url.searchParams.get('cursor') ?? '0';
        const requested = Number(url.searchParams.get('limit') ?? '200');
        const limit = Number.isFinite(requested)
          ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PULL_LIMIT)
          : 200;
        return json(await pullChanges(sql, cursor, limit));
      }

      if (url.pathname === '/v1/images/upload-url' && request.method === 'POST') {
        const {path} = (await request.json()) as {path?: string};
        if (!path || !isSafeImageKey(path)) {
          return json({error: 'invalid image path'}, 400);
        }
        return json({url: await presignUpload(s3ConfigFrom(env), path)});
      }

      if (url.pathname === '/v1/images/download-url' && request.method === 'POST') {
        const {path} = (await request.json()) as {path?: string};
        if (!path || !isSafeImageKey(path)) {
          return json({error: 'invalid image path'}, 400);
        }
        return json({url: await presignDownload(s3ConfigFrom(env), path)});
      }

      return json({error: 'not found'}, 404);
    } catch (error) {
      // The message is logged for the operator but not returned: it can carry
      // connection strings and table details.
      console.error('sync request failed', error);
      return json({error: 'internal error'}, 500);
    }
  },
};
