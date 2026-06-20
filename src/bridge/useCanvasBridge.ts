import { useEffect, useRef, useState } from 'react';
import { CanvasBridge } from './canvasBridge';
import type { CanvasBridgeFrame, CanvasBridgeSnapshot } from '../types/architecture';

interface BridgePerformanceAcc {
  samples: number;
  totalMs: number;
  maxMs: number;
}

const buildBridgeFrame = (
  bridge: CanvasBridge,
  perf: BridgePerformanceAcc,
  present: CanvasBridgeSnapshot['present'],
): CanvasBridgeFrame => {
  const start = performance.now();
  const snapshot = bridge.reconcile(present);
  const reconcileMs = performance.now() - start;

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
};

export const useCanvasBridge = (present: CanvasBridgeSnapshot['present']): CanvasBridgeFrame => {
  const bridgeRef = useRef(new CanvasBridge());
  const perfRef = useRef<BridgePerformanceAcc>({
    samples: 0,
    totalMs: 0,
    maxMs: 0,
  });
  const frameRef = useRef<CanvasBridgeFrame | null>(null);
  const pendingPresentRef = useRef(present);
  const scheduledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const [, forceUpdate] = useState(0);

  if (!frameRef.current) {
    frameRef.current = buildBridgeFrame(bridgeRef.current, perfRef.current, present);
  }

  useEffect(() => {
    pendingPresentRef.current = present;

    if (scheduledRef.current && rafIdRef.current !== null) {
      return;
    }

    if (scheduledRef.current && rafIdRef.current === null) {
      scheduledRef.current = false;
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      frameRef.current = buildBridgeFrame(bridgeRef.current, perfRef.current, pendingPresentRef.current);
      forceUpdate((value) => value + 1);
      return;
    }

    scheduledRef.current = true;
    rafIdRef.current = window.requestAnimationFrame(() => {
      scheduledRef.current = false;
      rafIdRef.current = null;
      frameRef.current = buildBridgeFrame(bridgeRef.current, perfRef.current, pendingPresentRef.current);
      forceUpdate((value) => value + 1);
    });
  }, [present]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      scheduledRef.current = false;
    };
  }, []);

  return frameRef.current;
};
