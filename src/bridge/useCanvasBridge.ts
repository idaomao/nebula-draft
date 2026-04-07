import { useMemo, useRef } from 'react';
import { CanvasBridge } from './canvasBridge';
import type { CanvasBridgeFrame, CanvasBridgeSnapshot } from '../types/architecture';

interface BridgePerformanceAcc {
  samples: number;
  totalMs: number;
  maxMs: number;
}

export const useCanvasBridge = (present: CanvasBridgeSnapshot['present']): CanvasBridgeFrame => {
  const bridgeRef = useRef(new CanvasBridge());
  const perfRef = useRef<BridgePerformanceAcc>({
    samples: 0,
    totalMs: 0,
    maxMs: 0,
  });

  return useMemo(() => {
    const start = performance.now();
    const snapshot = bridgeRef.current.reconcile(present);
    const reconcileMs = performance.now() - start;

    const perf = perfRef.current;
    perf.samples += 1;
    perf.totalMs += reconcileMs;
    perf.maxMs = Math.max(perf.maxMs, reconcileMs);

    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;

    snapshot.commands.forEach((command) => {
      if (command.type === 'create-element') {
        createCount += 1;
        return;
      }
      if (command.type === 'update-element') {
        updateCount += 1;
        return;
      }
      if (command.type === 'delete-element') {
        deleteCount += 1;
      }
    });

    return {
      snapshot,
      metrics: {
        reconcileMs,
        averageReconcileMs: perf.totalMs / perf.samples,
        maxReconcileMs: perf.maxMs,
        commandCount: snapshot.commands.length,
        createCount,
        updateCount,
        deleteCount,
      },
    };
  }, [present]);
};
