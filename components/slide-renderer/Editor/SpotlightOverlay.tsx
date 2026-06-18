'use client';

import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { useCanvasStore } from '@/lib/store/canvas';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spotlight overlay component
 *
 * Uses DOM measurement (getBoundingClientRect) to compute spotlight position,
 * avoiding alignment offsets from percentage coordinate conversion.
 */
export function SpotlightOverlay() {
  const spotlightElementId = useCanvasStore.use.spotlightElementId();
  const spotlightOptions = useCanvasStore.use.spotlightOptions();
  const laserElementId = useCanvasStore.use.laserElementId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );

  // Compute target element position in SVG coordinate system via DOM measurement
  const measure = useCallback(() => {
    if (!spotlightElementId || !containerRef.current) {
      setRect(null);
      return;
    }

    const domElement = document.getElementById(`screen-element-${spotlightElementId}`);
    if (!domElement) {
      setRect(null);
      return;
    }

    // Prefer measuring .element-content (the actual rendered area for auto-height)
    const contentEl = domElement.querySelector('.element-content');
    const targetEl = contentEl ?? domElement;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    if (containerRect.width === 0 || containerRect.height === 0) {
      setRect(null);
      return;
    }

    // Convert to SVG viewBox 0-100 coordinates
    setRect({
      x: ((targetRect.left - containerRect.left) / containerRect.width) * 100,
      y: ((targetRect.top - containerRect.top) / containerRect.height) * 100,
      w: (targetRect.width / containerRect.width) * 100,
      h: (targetRect.height / containerRect.height) * 100,
    });
  }, [spotlightElementId]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
    measure();
  }, [measure, elements]);

  const active = !!spotlightElementId && !!spotlightOptions && !!rect;
  const dimness = spotlightOptions?.dimness ?? 0.7;
  const showFallbackPointer = active && !laserElementId;
  const pointerX = rect ? rect.x + rect.w / 2 : 0;
  const pointerY = rect ? Math.max(2.4, rect.y - 2.2) : 0;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[100] pointer-events-none overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {active && rect && (
          <motion.div
            key={`spotlight-${spotlightElementId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0"
            >
              <defs>
                <mask id={`mask-${spotlightElementId}`}>
                  {/* White background = show mask layer (dimmed) */}
                  <rect x="0" y="0" width="100" height="100" fill="white" />
                  {/* Black rectangle = hide mask layer (highlighted area / cutout) */}
                  <motion.rect
                    fill="black"
                    initial={{
                      x: rect.x - 8,
                      y: rect.y - 8,
                      width: rect.w + 16,
                      height: rect.h + 16,
                      rx: 4,
                    }}
                    animate={{
                      x: rect.x - 0.4,
                      y: rect.y - 0.6,
                      width: rect.w + 0.8,
                      height: rect.h + 1.2,
                      rx: 1,
                    }}
                    transition={{
                      duration: 0.6,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </mask>
              </defs>

              {/* Dimmed Background */}
              <rect
                width="100"
                height="100"
                fill={`rgba(0,0,0,${dimness})`}
                mask={`url(#mask-${spotlightElementId})`}
                className="backdrop-blur-[1.5px]"
              />

              {/* THE ONE BORDER - white border */}
              <motion.rect
                initial={{
                  x: rect.x - 4,
                  y: rect.y - 4,
                  width: rect.w + 8,
                  height: rect.h + 8,
                  opacity: 0,
                  rx: 2,
                }}
                animate={{
                  x: rect.x - 0.4,
                  y: rect.y - 0.6,
                  width: rect.w + 0.8,
                  height: rect.h + 1.2,
                  opacity: 1,
                  rx: 1,
                }}
                fill="none"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth="1.2"
                style={{ vectorEffect: 'non-scaling-stroke' } as React.CSSProperties}
                transition={{
                  duration: 0.5,
                  delay: 0.05,
                  ease: [0.16, 1, 0.3, 1],
                }}
              />
            </svg>

            {showFallbackPointer && (
              <motion.div
                key={`spotlight-pointer-${spotlightElementId}`}
                initial={{
                  opacity: 0,
                  left: `${pointerX}%`,
                  top: `${pointerY + 1.2}%`,
                  scale: 0.9,
                }}
                animate={{
                  opacity: 1,
                  left: `${pointerX}%`,
                  top: `${pointerY}%`,
                  scale: 1,
                }}
                exit={{
                  opacity: 0,
                  scale: 0.9,
                }}
                transition={{
                  duration: 0.45,
                  ease: [0.16, 1, 0.3, 1],
                  opacity: { duration: 0.18 },
                }}
                className="absolute z-[101] pointer-events-none"
              >
                <div className="relative -translate-x-1/2 -translate-y-1/2">
                  <motion.div
                    animate={{ scale: [1, 2.8], opacity: [0.55, 0] }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.4,
                      ease: 'easeOut',
                      repeatDelay: 0.25,
                    }}
                    className="absolute inset-0 rounded-full border border-[#ff6a4d]/70"
                  />

                  <div
                    className="h-3 w-3 rounded-full bg-[#ff3b30]"
                    style={{
                      boxShadow:
                        '0 0 0 6px rgba(255, 59, 48, 0.16), 0 0 14px 3px rgba(255, 59, 48, 0.28)',
                    }}
                  />
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
