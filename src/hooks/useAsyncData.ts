import {useFocusEffect} from '@react-navigation/native';
import {useCallback, useEffect, useRef, useState} from 'react';
import {toUserMessage} from '@/utils/errors';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads data on mount and again whenever the screen regains focus, which is how
 * a detail screen picks up a sale made two screens deeper without any global
 * store. `reload` is exposed for pull-to-refresh and post-mutation refreshes.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): State<T> & {reload: () => Promise<void>; refreshing: boolean} {
  const [state, setState] = useState<State<T>>({data: null, loading: true, error: null});
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  // Guards against a slow first request resolving after a newer one.
  const requestId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableLoader = useCallback(loader, deps);

  const run = useCallback(
    async (isRefresh: boolean) => {
      const id = ++requestId.current;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setState(previous => ({...previous, loading: true}));
      }
      try {
        const data = await stableLoader();
        if (mounted.current && id === requestId.current) {
          setState({data, loading: false, error: null});
        }
      } catch (error) {
        if (mounted.current && id === requestId.current) {
          setState({data: null, loading: false, error: toUserMessage(error)});
        }
      } finally {
        if (mounted.current && id === requestId.current) {
          setRefreshing(false);
        }
      }
    },
    [stableLoader],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const reload = useCallback(() => run(true), [run]);

  return {...state, refreshing, reload};
}
