/**
 * Animation utilities library
 * 
 * Centralized animation system for consistent motion design across the application.
 * Respects user accessibility preferences (prefers-reduced-motion).
 */

/**
 * Spring configuration presets for Framer Motion animations
 * 
 * @example
 * ```tsx
 * <motion.div animate={{ x: 100 }} transition={springConfigs.bouncy} />
 * ```
 */
export const springConfigs = {
  /** Bouncy spring with overshoot - use for playful interactions */
  bouncy: { type: "spring" as const, stiffness: 300, damping: 10 },
  /** Smooth spring - use for general UI transitions */
  smooth: { type: "spring" as const, stiffness: 200, damping: 26 },
  /** Snappy spring - use for quick feedback */
  snappy: { type: "spring" as const, stiffness: 400, damping: 30 },
} as const;

/**
 * Standard animation durations in milliseconds
 * 
 * Philosophy: Keep animations purposeful and fast
 * - Most UI transitions: 150-300ms
 * - Chart animations: 500-800ms
 */
export const timing = {
  /** Quick interactions (150ms) */
  fast: 150,
  /** Standard transitions (300ms) */
  normal: 300,
  /** Slower, more noticeable transitions (500ms) */
  slow: 500,
  /** Chart and data visualizations (800ms) */
  chart: 800,
} as const;

/**
 * CSS cubic-bezier easing functions
 * 
 * @example
 * ```tsx
 * <div style={{ transition: `opacity ${timing.normal}ms ${easing.easeInOut}` }} />
 * ```
 */
export const easing = {
  /** Ease in and out - use for most transitions */
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** Ease out - use for elements entering */
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
  /** Ease in - use for elements exiting */
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/**
 * Calculate stagger delay for sequential animations
 * 
 * @param index - Zero-based index of the item
 * @param baseDelay - Base delay in milliseconds (default: 50ms)
 * @returns Delay in milliseconds
 * 
 * @example
 * ```tsx
 * items.map((item, i) => (
 *   <motion.div
 *     key={item.id}
 *     initial={{ opacity: 0 }}
 *     animate={{ opacity: 1 }}
 *     transition={{ delay: getStaggerDelay(i) / 1000 }}
 *   />
 * ))
 * ```
 */
export function getStaggerDelay(index: number, baseDelay = 50): number {
  return index * baseDelay;
}

/**
 * Get inline style object with stagger animation delay
 * 
 * @param index - Zero-based index of the item
 * @param baseDelay - Base delay in milliseconds (default: 50ms)
 * @returns Style object with animationDelay property
 * 
 * @example
 * ```tsx
 * <div style={getStaggerStyle(index)} className="animate-fade-in">
 *   {content}
 * </div>
 * ```
 */
export function getStaggerStyle(index: number, baseDelay = 50) {
  return {
    animationDelay: `${getStaggerDelay(index, baseDelay)}ms`,
  };
}

/**
 * CSS-in-JS keyframe definitions for inline animations
 * 
 * Use with CSS animations or as reference for motion libraries
 */
export const keyframes = {
  /** Fade in from transparent to opaque */
  fadeIn: {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  /** Fade out from opaque to transparent */
  fadeOut: {
    from: { opacity: 1 },
    to: { opacity: 0 },
  },
  /** Slide up with fade in */
  slideUp: {
    from: { opacity: 0, transform: "translateY(10px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
  /** Slide down with fade in */
  slideDown: {
    from: { opacity: 0, transform: "translateY(-10px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
  /** Slide in from left */
  slideInLeft: {
    from: { opacity: 0, transform: "translateX(-10px)" },
    to: { opacity: 1, transform: "translateX(0)" },
  },
  /** Slide in from right */
  slideInRight: {
    from: { opacity: 0, transform: "translateX(10px)" },
    to: { opacity: 1, transform: "translateX(0)" },
  },
  /** Scale up with fade in */
  scaleIn: {
    from: { opacity: 0, transform: "scale(0.95)" },
    to: { opacity: 1, transform: "scale(1)" },
  },
} as const;

/**
 * Framer Motion animation variants for common patterns
 * 
 * @example
 * ```tsx
 * <motion.div variants={motionVariants.fadeIn} initial="hidden" animate="visible" />
 * ```
 */
export const motionVariants = {
  /** Fade in animation */
  fadeIn: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: timing.normal / 1000 } },
  },
  /** Fade and slide up animation */
  slideUp: {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: timing.normal / 1000, ease: [0.4, 0, 0.2, 1] },
    },
  },
  /** Fade and slide down animation */
  slideDown: {
    hidden: { opacity: 0, y: -10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: timing.normal / 1000, ease: [0.4, 0, 0.2, 1] },
    },
  },
  /** Scale in animation */
  scaleIn: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: timing.normal / 1000, ease: [0.4, 0, 0.2, 1] },
    },
  },
  /** Stagger container for child animations */
  staggerContainer: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.05,
      },
    },
  },
  /** Stagger item (use with staggerContainer) */
  staggerItem: {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: timing.fast / 1000 },
    },
  },
} as const;

/**
 * Check if the user prefers reduced motion
 * 
 * @returns true if user has enabled prefers-reduced-motion
 * 
 * @example
 * ```tsx
 * const shouldAnimate = !prefersReducedMotion();
 * ```
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Get animation duration, respecting reduced motion preference
 * 
 * @param duration - Desired duration in milliseconds
 * @returns 0 if reduced motion is preferred, otherwise the original duration
 * 
 * @example
 * ```tsx
 * <motion.div animate={{ x: 100 }} transition={{ duration: getAnimationDuration(300) / 1000 }} />
 * ```
 */
export function getAnimationDuration(duration: number): number {
  return prefersReducedMotion() ? 0 : duration;
}

/**
 * Get transition config that respects reduced motion preference
 * 
 * @param transition - Framer Motion transition config
 * @returns Modified transition with duration: 0 if reduced motion is preferred
 * 
 * @example
 * ```tsx
 * <motion.div animate={{ x: 100 }} transition={getAccessibleTransition(springConfigs.smooth)} />
 * ```
 */
export function getAccessibleTransition<T extends Record<string, unknown>>(
  transition: T
): T {
  if (prefersReducedMotion()) {
    return { ...transition, duration: 0 };
  }
  return transition;
}

/**
 * Get Framer Motion variants that respect reduced motion preference
 * 
 * @param variants - Motion variants object
 * @returns Variants with instant transitions if reduced motion is preferred
 * 
 * @example
 * ```tsx
 * <motion.div variants={getAccessibleVariants(motionVariants.fadeIn)} initial="hidden" animate="visible" />
 * ```
 */
export function getAccessibleVariants<T extends Record<string, unknown>>(
  variants: T
): T {
  if (!prefersReducedMotion()) return variants;

  const accessibleVariants: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variants)) {
    if (typeof value === "object" && value !== null) {
      accessibleVariants[key] = {
        ...value,
        transition: { duration: 0 },
      };
    } else {
      accessibleVariants[key] = value;
    }
  }
  return accessibleVariants as T;
}
