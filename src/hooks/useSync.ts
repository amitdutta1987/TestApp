import {useCallback, useEffect, useState} from 'react';
import {syncEngine} from '@/sync/SyncEngine';
import type {MergeConflict} from '@/sync/merge';
import type {StockDiscrepancy} from '@/sync/stock';
import type {SyncStatus} from '@/sync/types';

interface SyncState {
  status: SyncStatus;
  /** Products the merge found short because two devices sold offline. */
  discrepancies: StockDiscrepancy[];
  /** Duplicate barcodes it had to break, and rows it could not apply. */
  conflicts: MergeConflict[];
  syncNow: () => Promise<void>;
}

/**
 * Subscribes to the shared engine rather than owning a sync of its own, so the
 * status is identical wherever it is shown and a manual "Sync now" cannot race
 * the background pass.
 */
export function useSync(): SyncState {
  const [status, setStatus] = useState<SyncStatus>({state: 'IDLE', lastSyncAt: null});
  const [discrepancies, setDiscrepancies] = useState<StockDiscrepancy[]>([]);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);

  useEffect(() => syncEngine.subscribe(setStatus), []);

  const syncNow = useCallback(async () => {
    try {
      const outcome = await syncEngine.sync();
      setDiscrepancies(outcome.discrepancies);
      setConflicts(outcome.conflicts);
    } catch {
      // The engine has already published the failure through subscribe(); a
      // second surface for the same error would just be noise.
    }
  }, []);

  return {status, discrepancies, conflicts, syncNow};
}
