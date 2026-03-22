import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { collectionQueue } from '../services/collection-queue.js';
import type { CollectionProgressEvent } from '../../shared/types.js';

const collection = new Hono();

// POST /api/collection/start — start batch or specific repos
collection.post('/api/collection/start', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({ repoIds: z.array(z.number()).optional() });
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  // Start collection in the background (don't await — returns immediately)
  collectionQueue.startBatch(parsed.data.repoIds).catch((err) => {
    console.error('Collection batch error:', err);
  });

  return c.json({ started: true });
});

// POST /api/collection/stop — stop all collection
collection.post('/api/collection/stop', (c) => {
  collectionQueue.stopAll();
  return c.json({ stopped: true });
});

// POST /api/collection/skip — skip current repo
collection.post('/api/collection/skip', (c) => {
  collectionQueue.skipCurrent();
  return c.json({ skipped: true });
});

// GET /api/collection/status — current batch status (polling fallback)
collection.get('/api/collection/status', (c) => {
  return c.json(collectionQueue.getStatus());
});

// GET /api/collection/resume-info — check for incomplete collections (D-16)
collection.get('/api/collection/resume-info', (c) => {
  return c.json(collectionQueue.getIncompleteForResume());
});

// GET /api/collection/progress — SSE stream for live progress (D-06)
collection.get('/api/collection/progress', (c) => {
  return streamSSE(c, async (stream) => {
    const listener = (event: CollectionProgressEvent) => {
      stream.writeSSE({
        data: JSON.stringify(event),
        event: 'progress',
        id: String(Date.now()),
      });
    };

    stream.onAbort(() => {
      collectionQueue.removeProgressListener(listener);
    });

    collectionQueue.addProgressListener(listener);

    // Send current status immediately as first event
    const status = collectionQueue.getStatus();
    await stream.writeSSE({
      data: JSON.stringify({ type: 'status_snapshot', ...status }),
      event: 'status',
      id: String(Date.now()),
    });

    // Hold connection open until batch completes or client disconnects
    await new Promise<void>((resolve) => {
      const checkDone = (event: CollectionProgressEvent) => {
        if (event.type === 'batch_complete') {
          collectionQueue.removeProgressListener(checkDone);
          resolve();
        }
      };
      collectionQueue.addProgressListener(checkDone);
      stream.onAbort(() => {
        collectionQueue.removeProgressListener(checkDone);
        resolve();
      });
    });

    // Cleanup the main listener
    collectionQueue.removeProgressListener(listener);
  });
});

export default collection;
