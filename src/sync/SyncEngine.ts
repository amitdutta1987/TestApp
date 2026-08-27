import {SYNC} from '@/constants/config';
import {getDriver} from '@/database/database';
import type {SqlDriver} from '@/database/driver';
import {AppError, toUserMessage} from '@/utils/errors';
import {ChangeTracker} from './ChangeTracker';
import {RemoteImageService} from './RemoteImageService';
import {syncApi, type SyncApiContract} from './SyncApi';
import {applyRemoteChanges, type MergeConflict} from './merge';
import type {StockDiscrepancy} from './stock';
import type {SyncOutcome, SyncStatus} from './types';

type Listener = (status: SyncStatus) => void;

/**
 * Drives one sync pass: push local changes, pull remote ones, move images.
 *
 * Push happens before pull so this device's work is durable on the server
 * before it starts accepting other devices' versions of the same rows —
 * otherwise an incoming last-write-wins row could overwrite a local edit that
 * had not yet been sent, and the edit would be lost with nothing to replay it.
 */
export class SyncEngine {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<Listener>();
  private status: SyncStatus = {state: 'IDLE', lastSyncAt: null};

  constructor(
    private readonly injectedDriver?: SqlDriver,
    private readonly api: SyncApiContract = syncApi,
  ) {}

  private get driver(): SqlDriver {
    return this.injectedDriver ?? getDriver();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(status: SyncStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  /** Periodic background sync. Safe to call twice; the second call is ignored. */
  start(): void {
    if (this.timer || !this.api.configured) {
      return;
    }
    this.timer = setInterval(() => {
      void this.sync().catch(() => undefined);
    }, SYNC.intervalMs);
    void this.sync().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One full pass.
   *
   * Re-entrancy is guarded rather than queued: two overlapping passes would
   * both read the same outbox rows and push them twice. The writes are
   * idempotent so nothing would corrupt, but it wastes a shop's mobile data.
   */
  async sync(): Promise<SyncOutcome> {
    if (this.running) {
      throw new AppError('SYNC_FAILED', 'A sync is already in progress.');
    }
    if (!this.api.configured) {
      throw new AppError('SYNC_NOT_CONFIGURED', 'Cloud sync is not set up on this device yet.');
    }

    this.running = true;
    this.emit({state: 'SYNCING'});

    const tracker = new ChangeTracker(this.driver);
    const images = new RemoteImageService(this.driver, this.api);

    try {
      const pushed = await this.push(tracker);
      const {pulled, discrepancies, conflicts, cursor} = await this.pull(tracker);

      // Images are queued from the rows that just arrived, so this must follow
      // the pull rather than run alongside it.
      await images.queueMissingImages();
      const transferred = await images.processQueue();

      await tracker.markSynced(cursor);
      this.emit({state: 'IDLE', lastSyncAt: await tracker.getControl('last_sync_at')});

      return {
        pushed,
        pulled,
        imagesUploaded: transferred.uploaded,
        imagesDownloaded: transferred.downloaded,
        discrepancies,
        conflicts,
        cursor,
      };
    } catch (error) {
      const pending = await tracker.pendingCount().catch(() => 0);
      const unreachable =
        error instanceof AppError &&
        (error.code === 'SYNC_UNREACHABLE' || error.code === 'SYNC_NOT_CONFIGURED');

      // Being offline is the app's normal state, not an error worth shouting
      // about: the shop keeps selling and the outbox keeps the work.
      this.emit(
        unreachable
          ? {state: 'OFFLINE', pendingChanges: pending}
          : {state: 'ERROR', message: toUserMessage(error), pendingChanges: pending},
      );
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async push(tracker: ChangeTracker): Promise<number> {
    let pushed = 0;

    // Drains in batches so a device that has been offline for a week is not
    // asked to send its whole backlog in one request.
    for (;;) {
      const changes = await tracker.collect(SYNC.pushBatchSize);
      if (changes.length === 0) {
        break;
      }

      const deviceId = await tracker.deviceId();
      const response = await this.api.push({deviceId, changes});

      // Only acknowledged rows leave the outbox. A rejected row stays and is
      // retried next pass rather than vanishing.
      await tracker.acknowledge(response.accepted);
      pushed += response.accepted.length;

      if (response.accepted.length === 0) {
        // Nothing got through — retrying the same batch would spin forever.
        break;
      }
      if (changes.length < SYNC.pushBatchSize) {
        break;
      }
    }

    return pushed;
  }

  private async pull(tracker: ChangeTracker): Promise<{
    pulled: number;
    discrepancies: StockDiscrepancy[];
    conflicts: MergeConflict[];
    cursor: string;
  }> {
    let cursor = (await tracker.getControl('cursor')) ?? '0';
    let pulled = 0;
    const discrepancies: StockDiscrepancy[] = [];
    const conflicts: MergeConflict[] = [];

    for (;;) {
      const page = await this.api.pull(cursor, SYNC.pullPageSize);
      if (page.changes.length > 0) {
        const merged = await applyRemoteChanges(this.driver, page.changes);
        pulled += merged.applied;
        discrepancies.push(...merged.discrepancies);
        conflicts.push(...merged.conflicts);
      }

      // Persisted per page: a connection dropped mid-backlog resumes here
      // rather than replaying from the beginning.
      cursor = page.cursor;
      await tracker.setControl('cursor', cursor);

      if (!page.hasMore) {
        break;
      }
    }

    return {pulled, discrepancies, conflicts, cursor};
  }
}

export const syncEngine = new SyncEngine();
