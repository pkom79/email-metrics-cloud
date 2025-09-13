"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface AutoFitTextProps {
  text: string;
  className?: string; // applied to wrapper
  maxPx?: number; // maximum font size in px
  minPx?: number; // minimum font size in px
  stepPx?: number; // decrement step in px
  title?: string;
}

// Shrinks font-size until text fits on a single line in the available width.
// Uses ResizeObserver to respond to container size changes. Client-only.
export default function AutoFitText({
  text,
  className,
  maxPx = 30,
  minPx = 16,
  stepPx = 1,
  title,
}: AutoFitTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState<number>(maxPx);

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;
    const container = containerRef.current;
    const el = textRef.current;

    const fit = () => {
      if (!container || !el) return;
      // Reset to max first each time to re-measure
      let size = maxPx;
      el.style.fontSize = `${size}px`;
      el.style.whiteSpace = 'nowrap';
      el.style.lineHeight = '1';
      // Give the browser a tick to layout
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetWidth;
      while (size > minPx && el.scrollWidth > container.clientWidth) {
        size -= stepPx;
        el.style.fontSize = `${size}px`;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        el.offsetWidth;
      }
      setFontSize(size);
    };

    const ro = new ResizeObserver(() => {
      // debounce with rAF
      requestAnimationFrame(fit);
    });
    ro.observe(container);
    fit();
    return () => ro.disconnect();
  }, [maxPx, minPx, stepPx, text]);

  return (
    <div className={className} title={title} ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
      <span ref={textRef} style={{ fontSize: `${fontSize}px`, whiteSpace: 'nowrap', lineHeight: 1, display: 'inline-block' }}>{text}</span>
    </div>
  );
}
