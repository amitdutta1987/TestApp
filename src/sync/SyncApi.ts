import {SYNC} from '@/constants/config';
import {AppError} from '@/utils/errors';
import type {PullResponse, PushRequest, PushResponse} from './types';

/**
 * What the engine needs from a sync server.
 *
 * Named separately from the class so the engine can be driven against a stand-in
 * in tests: SyncApi's private fields would otherwise make it structurally
 * unmatchable.
 */
export interface SyncApiContract {
  readonly configured: boolean;
  push(body: PushRequest): Promise<PushResponse>;
  pull(cursor: string, limit: number): Promise<PullResponse>;
  uploadUrl(path: string): Promise<{url: string}>;
  downloadUrl(path: string): Promise<{url: string}>;
}

/**
 * HTTP client for the sync Worker.
 *
 * Every failure is turned into an AppError with a message a shopkeeper can act
 * on. Sync runs in the background, so a raw fetch rejection surfacing in the UI
 * as "Network request failed" would be both alarming and useless.
 */
export class SyncApi implements SyncApiContract {
  constructor(
    private readonly baseUrl: string = SYNC.baseUrl,
    private readonly apiKey: string = SYNC.apiKey,
  ) {}

  get configured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.configured) {
      throw new AppError('SYNC_NOT_CONFIGURED', 'Cloud sync is not set up on this device yet.');
    }

    // React Native's fetch has no timeout of its own; without this a request on
    // a stalled connection never settles and the sync lock is held forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AppError(
        'SYNC_UNREACHABLE',
        aborted
          ? 'The sync server took too long to respond. Your data is safe on this device.'
          : 'Could not reach the sync server. Your data is safe on this device.',
        {cause: error},
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) {
      throw new AppError('SYNC_UNAUTHORISED', 'This device was rejected by the sync server.');
    }
    if (!response.ok) {
      throw new AppError('SYNC_FAILED', `The sync server returned an error (${response.status}).`);
    }

    return (await response.json()) as T;
  }

  push(body: PushRequest): Promise<PushResponse> {
    return this.request<PushResponse>('/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  pull(cursor: string, limit: number): Promise<PullResponse> {
    const query = `?cursor=${encodeURIComponent(cursor)}&limit=${limit}`;
    return this.request<PullResponse>(`/v1/sync/pull${query}`, {method: 'GET'});
  }

  /** Short-lived, single-object URL. The app never holds AWS credentials. */
  uploadUrl(path: string): Promise<{url: string}> {
    return this.request<{url: string}>('/v1/images/upload-url', {
      method: 'POST',
      body: JSON.stringify({path}),
    });
  }

  downloadUrl(path: string): Promise<{url: string}> {
    return this.request<{url: string}>('/v1/images/download-url', {
      method: 'POST',
      body: JSON.stringify({path}),
    });
  }
}

export const syncApi = new SyncApi();
