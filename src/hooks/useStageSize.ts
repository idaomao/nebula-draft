import { useEffect, useRef, useState } from 'react';

interface Size {
  width: number;
  height: number;
}

export const useStageSize = <T extends HTMLElement>() => {
  const containerRef = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  return {
    containerRef,
    size,
  };
};
