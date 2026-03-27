import { useEffect, useState, useRef } from 'react';
import type { CollectionProgressEvent } from '@shared/types.js';

interface UseCollectionSSEOptions {
  enabled: boolean;  // Only connect when collection is active
}

interface UseCollectionSSEReturn {
  latestEvent: CollectionProgressEvent | null;
  isConnected: boolean;
}

export function useCollectionSSE({ enabled }: UseCollectionSSEOptions): UseCollectionSSEReturn {
  const [latestEvent, setLatestEvent] = useState<CollectionProgressEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const es = new EventSource('/api/collection/progress');
    esRef.current = es;

    es.addEventListener('progress', (e) => {
      try {
        const event: CollectionProgressEvent = JSON.parse(e.data);
        setLatestEvent(event);
      } catch {
        // Ignore malformed progress events
      }
    });

    es.addEventListener('status', (e) => {
      try {
        const event: CollectionProgressEvent = JSON.parse(e.data);
        setLatestEvent(event);
      } catch {
        // Ignore malformed status events
      }
    });

    es.onopen = () => setIsConnected(true);
    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects by default
    };

    return () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [enabled]);

  return { latestEvent, isConnected };
}
