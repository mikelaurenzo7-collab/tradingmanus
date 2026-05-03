import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  springConfigs,
  timing,
  easing,
  getStaggerDelay,
  getStaggerStyle,
  keyframes,
  motionVariants,
  prefersReducedMotion,
  getAnimationDuration,
  getAccessibleTransition,
  getAccessibleVariants,
} from "./animations";

describe("animations", () => {
  describe("springConfigs", () => {
    it("exports bouncy spring configuration", () => {
      expect(springConfigs.bouncy).toEqual({
        type: "spring",
        stiffness: 300,
        damping: 10,
      });
    });

    it("exports smooth spring configuration", () => {
      expect(springConfigs.smooth).toEqual({
        type: "spring",
        stiffness: 200,
        damping: 26,
      });
    });

    it("exports snappy spring configuration", () => {
      expect(springConfigs.snappy).toEqual({
        type: "spring",
        stiffness: 400,
        damping: 30,
      });
    });
  });

  describe("timing", () => {
    it("defines fast timing at 150ms", () => {
      expect(timing.fast).toBe(150);
    });

    it("defines normal timing at 300ms", () => {
      expect(timing.normal).toBe(300);
    });

    it("defines slow timing at 500ms", () => {
      expect(timing.slow).toBe(500);
    });

    it("defines chart timing at 800ms", () => {
      expect(timing.chart).toBe(800);
    });
  });

  describe("easing", () => {
    it("defines easeInOut cubic-bezier", () => {
      expect(easing.easeInOut).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    });

    it("defines easeOut cubic-bezier", () => {
      expect(easing.easeOut).toBe("cubic-bezier(0, 0, 0.2, 1)");
    });

    it("defines easeIn cubic-bezier", () => {
      expect(easing.easeIn).toBe("cubic-bezier(0.4, 0, 1, 1)");
    });
  });

  describe("getStaggerDelay", () => {
    it("calculates stagger delay with default base delay", () => {
      expect(getStaggerDelay(0)).toBe(0);
      expect(getStaggerDelay(1)).toBe(50);
      expect(getStaggerDelay(2)).toBe(100);
      expect(getStaggerDelay(5)).toBe(250);
    });

    it("calculates stagger delay with custom base delay", () => {
      expect(getStaggerDelay(0, 100)).toBe(0);
      expect(getStaggerDelay(1, 100)).toBe(100);
      expect(getStaggerDelay(3, 75)).toBe(225);
    });
  });

  describe("getStaggerStyle", () => {
    it("returns style object with animation delay", () => {
      expect(getStaggerStyle(0)).toEqual({ animationDelay: "0ms" });
      expect(getStaggerStyle(1)).toEqual({ animationDelay: "50ms" });
      expect(getStaggerStyle(3)).toEqual({ animationDelay: "150ms" });
    });

    it("returns style object with custom base delay", () => {
      expect(getStaggerStyle(2, 100)).toEqual({ animationDelay: "200ms" });
      expect(getStaggerStyle(4, 25)).toEqual({ animationDelay: "100ms" });
    });
  });

  describe("keyframes", () => {
    it("defines fadeIn keyframes", () => {
      expect(keyframes.fadeIn).toEqual({
        from: { opacity: 0 },
        to: { opacity: 1 },
      });
    });

    it("defines fadeOut keyframes", () => {
      expect(keyframes.fadeOut).toEqual({
        from: { opacity: 1 },
        to: { opacity: 0 },
      });
    });

    it("defines slideUp keyframes", () => {
      expect(keyframes.slideUp).toEqual({
        from: { opacity: 0, transform: "translateY(10px)" },
        to: { opacity: 1, transform: "translateY(0)" },
      });
    });

    it("defines slideDown keyframes", () => {
      expect(keyframes.slideDown).toEqual({
        from: { opacity: 0, transform: "translateY(-10px)" },
        to: { opacity: 1, transform: "translateY(0)" },
      });
    });

    it("defines slideInLeft keyframes", () => {
      expect(keyframes.slideInLeft).toEqual({
        from: { opacity: 0, transform: "translateX(-10px)" },
        to: { opacity: 1, transform: "translateX(0)" },
      });
    });

    it("defines slideInRight keyframes", () => {
      expect(keyframes.slideInRight).toEqual({
        from: { opacity: 0, transform: "translateX(10px)" },
        to: { opacity: 1, transform: "translateX(0)" },
      });
    });

    it("defines scaleIn keyframes", () => {
      expect(keyframes.scaleIn).toEqual({
        from: { opacity: 0, transform: "scale(0.95)" },
        to: { opacity: 1, transform: "scale(1)" },
      });
    });
  });

  describe("motionVariants", () => {
    it("defines fadeIn variants", () => {
      expect(motionVariants.fadeIn).toEqual({
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.3 } },
      });
    });

    it("defines slideUp variants", () => {
      expect(motionVariants.slideUp).toEqual({
        hidden: { opacity: 0, y: 10 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
        },
      });
    });

    it("defines slideDown variants", () => {
      expect(motionVariants.slideDown).toEqual({
        hidden: { opacity: 0, y: -10 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
        },
      });
    });

    it("defines scaleIn variants", () => {
      expect(motionVariants.scaleIn).toEqual({
        hidden: { opacity: 0, scale: 0.95 },
        visible: {
          opacity: 1,
          scale: 1,
          transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
        },
      });
    });

    it("defines staggerContainer variants", () => {
      expect(motionVariants.staggerContainer).toEqual({
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.05,
            delayChildren: 0.05,
          },
        },
      });
    });

    it("defines staggerItem variants", () => {
      expect(motionVariants.staggerItem).toEqual({
        hidden: { opacity: 0, y: 10 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.15 },
        },
      });
    });
  });

  describe("prefersReducedMotion", () => {
    beforeEach(() => {
      // Reset matchMedia mock before each test
      vi.stubGlobal("window", {
        matchMedia: vi.fn(),
      });
    });

    it("returns false when reduced motion is not preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
      });

      expect(prefersReducedMotion()).toBe(false);
      expect(window.matchMedia).toHaveBeenCalledWith(
        "(prefers-reduced-motion: reduce)"
      );
    });

    it("returns true when reduced motion is preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true,
      });

      expect(prefersReducedMotion()).toBe(true);
      expect(window.matchMedia).toHaveBeenCalledWith(
        "(prefers-reduced-motion: reduce)"
      );
    });

    it("returns false in SSR environment (no window)", () => {
      vi.stubGlobal("window", undefined);
      expect(prefersReducedMotion()).toBe(false);
    });
  });

  describe("getAnimationDuration", () => {
    beforeEach(() => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn(),
      });
    });

    it("returns original duration when reduced motion is not preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false });

      expect(getAnimationDuration(300)).toBe(300);
      expect(getAnimationDuration(500)).toBe(500);
      expect(getAnimationDuration(0)).toBe(0);
    });

    it("returns 0 when reduced motion is preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });

      expect(getAnimationDuration(300)).toBe(0);
      expect(getAnimationDuration(500)).toBe(0);
      expect(getAnimationDuration(1000)).toBe(0);
    });
  });

  describe("getAccessibleTransition", () => {
    beforeEach(() => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn(),
      });
    });

    it("returns original transition when reduced motion is not preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const transition = { type: "spring", stiffness: 300, damping: 20 };
      expect(getAccessibleTransition(transition)).toEqual(transition);
    });

    it("returns transition with duration 0 when reduced motion is preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });

      const transition = { type: "spring", stiffness: 300, damping: 20 };
      expect(getAccessibleTransition(transition)).toEqual({
        ...transition,
        duration: 0,
      });
    });

    it("preserves all original properties", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const transition = { delay: 0.5, ease: "easeIn", custom: "value" };
      expect(getAccessibleTransition(transition)).toEqual(transition);
    });
  });

  describe("getAccessibleVariants", () => {
    beforeEach(() => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn(),
      });
    });

    it("returns original variants when reduced motion is not preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const variants = {
        hidden: { opacity: 0, transition: { duration: 0.3 } },
        visible: { opacity: 1, transition: { duration: 0.5 } },
      };
      expect(getAccessibleVariants(variants)).toEqual(variants);
    });

    it("returns variants with instant transitions when reduced motion is preferred", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });

      const variants = {
        hidden: { opacity: 0, transition: { duration: 0.3 } },
        visible: { opacity: 1, transition: { duration: 0.5 } },
      };
      const result = getAccessibleVariants(variants);

      expect(result.hidden.transition).toEqual({ duration: 0 });
      expect(result.visible.transition).toEqual({ duration: 0 });
      expect(result.hidden.opacity).toBe(0);
      expect(result.visible.opacity).toBe(1);
    });

    it("handles variants without transitions", () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });

      const variants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1 },
      };
      const result = getAccessibleVariants(variants);

      expect((result.hidden as { transition?: unknown }).transition).toEqual({
        duration: 0,
      });
      expect((result.visible as { transition?: unknown }).transition).toEqual({
        duration: 0,
      });
    });
  });
});
