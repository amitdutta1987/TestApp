import type {SqlValue} from '@/database/driver';
import type {SyncedTable} from '@/database/schema/sync';

/** One row's worth of change, in the shape the API speaks. */
export interface SyncChange {
  table: SyncedTable;
  id: string;
  op: 'UPSERT' | 'DELETE';
  /** Full current row state for an UPSERT; absent for a DELETE. */
  row?: Record<string, SqlValue>;
}

export interface PushRequest {
  deviceId: string;
  changes: SyncChange[];
}

export interface PushResponse {
  /** Rows the server durably stored. Only these are cleared from the outbox. */
  accepted: {table: SyncedTable; id: string}[];
  /** Rows the server refused, with a reason — kept for retry or inspection. */
  rejected: {table: SyncedTable; id: string; reason: string}[];
}

export interface PullResponse {
  changes: SyncChange[];
  /** Opaque, monotonically increasing. Persisted so the next pull resumes. */
  cursor: string;
  hasMore: boolean;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  imagesUploaded: number;
  imagesDownloaded: number;
  discrepancies: import('./stock').StockDiscrepancy[];
  /** Decisions the merge had to make, or rows it could not apply. */
  conflicts: import('./merge').MergeConflict[];
  cursor: string;
}

export type SyncStatus =
  | {state: 'IDLE'; lastSyncAt: string | null}
  | {state: 'SYNCING'}
  | {state: 'OFFLINE'; pendingChanges: number}
  | {state: 'ERROR'; message: string; pendingChanges: number};
