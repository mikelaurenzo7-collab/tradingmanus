# Glassmorphism & Advanced Effects - Utility Classes

## Overview

This document describes the new utility classes added to `client/src/index.css` for creating premium glassmorphism effects and advanced animations throughout the application.

All effects are:
- ✅ GPU-accelerated (using `transform`, `opacity`, `filter`)
- ✅ Accessibility-friendly (respect `prefers-reduced-motion`)
- ✅ Tailwind v4 compatible
- ✅ Performance-optimized with `will-change` hints

---

## Core Glassmorphism Classes

### `.glass-card`

Creates a glassmorphism effect with frosted glass appearance.

**Properties:**
- Semi-transparent dark background: `rgba(18, 18, 24, 0.6)`
- 20px backdrop blur (with Safari `-webkit-` prefix)
- Subtle white border: `1px solid rgba(255, 255, 255, 0.1)`
- GPU-accelerated with `will-change: transform`

**Usage:**
```html
<!-- Basic stat card -->
<div class="glass-card p-6 rounded-lg">
  <h3>Total Volume</h3>
  <p class="text-2xl">$42,500</p>
</div>

<!-- Dashboard widget -->
<div class="glass-card backdrop-blur-xl border rounded-xl p-4">
  <div class="space-y-2">
    <h4>Active Positions</h4>
    <ul>...</ul>
  </div>
</div>
```

**Recommended combinations:**
- `glass-card` + `glow-primary` → Premium cards with glow
- `glass-card` + `transition-card` → Interactive cards with hover effects
- `glass-card` + `pulse-live` → Real-time dashboard widgets

---

## Glow Effects

### `.glow-primary`

Adds a soft purple glow shadow using the primary brand color.

**Properties:**
- Box shadow: `0 0 20px rgba(168, 85, 247, 0.4)`
- GPU hint: `will-change: transform`

**Usage:**
```html
<!-- Highlighted card -->
<div class="glass-card glow-primary p-4">
  <h3>Featured Position</h3>
  <p>High confidence signal</p>
</div>

<!-- Primary CTA button -->
<button class="glass-card glow-primary glow-hover px-6 py-3">
  Execute Trade
</button>
```

### `.glow-hover`

Interactive glow that intensifies on hover.

**Properties:**
- Smooth transition: `box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Hover shadow: `0 0 30px rgba(168, 85, 247, 0.6)`

**Usage:**
```html
<div class="glow-primary glow-hover cursor-pointer">
  Hover for enhanced glow
</div>
```

---

## Borders

### `.gradient-border-image`

Applies a vibrant purple-to-pink gradient border using CSS `border-image`.

**Properties:**
- 2px solid border
- Gradient: `linear-gradient(135deg, #a855f7, #ec4899)`

**Usage:**
```html
<!-- Premium container -->
<div class="gradient-border-image rounded-lg p-6">
  <h2>Premium Feature</h2>
  <p>Exclusive content</p>
</div>

<!-- Call-to-action box -->
<div class="glass-card gradient-border-image p-8">
  <h3>Upgrade to Pro</h3>
  <button>Get Started</button>
</div>
```

**Note:** For rounded corners, apply `border-radius` to the parent element.

---

## Animations

### `.pulse-live`

Green pulsing border animation for live/real-time indicators.

**Properties:**
- 2s infinite animation with cubic-bezier easing
- Green border pulses: `rgba(34, 197, 94, 0.4)` → `rgba(34, 197, 94, 0.8)`
- Expanding box-shadow ring effect
- GPU-accelerated: `will-change: transform`

**Usage:**
```html
<!-- Live market data card -->
<div class="glass-card pulse-live p-4">
  <div class="flex items-center gap-2">
    <span class="text-green-500">●</span>
    <span>Live Updates</span>
  </div>
  <p class="text-2xl font-mono">$0.65</p>
</div>

<!-- Real-time connection status -->
<span class="pulse-live inline-block px-3 py-1 rounded-full">
  ⚡ Connected
</span>
```

**Perfect for:**
- Live price feeds
- Real-time position updates
- Active connection indicators
- Streaming data displays

---

### `.shimmer-load`

Shimmer/skeleton loading animation for content placeholders.

**Properties:**
- 1.5s infinite animation with ease-in-out
- Horizontal sweeping gradient effect
- Subtle white shimmer: `rgba(255, 255, 255, 0.05)` → `0.1` → `0.05`
- GPU-optimized: `will-change: background-position`

**Usage:**
```html
<!-- Loading skeleton for list items -->
<div class="space-y-2">
  <div class="shimmer-load h-4 w-full rounded bg-gray-800"></div>
  <div class="shimmer-load h-4 w-3/4 rounded bg-gray-800"></div>
  <div class="shimmer-load h-4 w-1/2 rounded bg-gray-800"></div>
</div>

<!-- Loading card -->
<div class="glass-card p-6">
  <div class="shimmer-load h-6 w-32 rounded mb-4"></div>
  <div class="shimmer-load h-20 w-full rounded"></div>
</div>
```

**Perfect for:**
- Data table loading states
- Card placeholder content
- Text skeleton screens
- Image placeholders

---

## Transition Utilities

### `.transition-scale`

Smooth scale transition with hover effect.

**Properties:**
- Transform transition: `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Hover: `scale(1.02)`
- GPU hint: `will-change: transform`

**Usage:**
```html
<button class="transition-scale px-4 py-2 bg-primary rounded">
  Hover Me
</button>
```

---

### `.transition-opacity-smooth`

Smooth opacity transition utility.

**Properties:**
- Opacity transition: `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- GPU hint: `will-change: opacity`

**Usage:**
```html
<div class="transition-opacity-smooth hover:opacity-70">
  Fades on hover
</div>
```

---

### `.transition-card`

Combined transition for interactive card elements (transform + opacity + shadow).

**Properties:**
- Smooth transitions for: `transform`, `opacity`, `box-shadow`
- Timing: `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Hover effects:
  - Lift up: `translateY(-2px)`
  - Slight scale: `scale(1.01)`
  - Opacity: `0.95`

**Usage:**
```html
<!-- Interactive dashboard card -->
<div class="glass-card transition-card p-6 cursor-pointer">
  <h3>Market Overview</h3>
  <p>Click to expand</p>
</div>

<!-- Clickable stat card -->
<a href="/positions" class="glass-card transition-card block p-4">
  <div class="text-sm text-muted-foreground">Open Positions</div>
  <div class="text-3xl font-bold">12</div>
</a>
```

**Perfect for:**
- Clickable cards
- Navigation items
- Interactive dashboard widgets
- List items with hover states

---

### `.fade-in-gpu`

GPU-accelerated fade-in animation for smooth page/component entry.

**Properties:**
- Duration: `0.5s cubic-bezier(0.4, 0, 0.2, 1)`
- Animates: opacity `0 → 1`, translateY `10px → 0`
- Uses `translateZ(0)` for GPU acceleration

**Usage:**
```html
<!-- Animated card on mount -->
<div class="glass-card fade-in-gpu p-6">
  <h3>New Content</h3>
  <p>Smoothly fades in</p>
</div>

<!-- Staggered list items (use with delay utilities) -->
<div class="space-y-2">
  <div class="fade-in-gpu" style="animation-delay: 0ms;">Item 1</div>
  <div class="fade-in-gpu" style="animation-delay: 100ms;">Item 2</div>
  <div class="fade-in-gpu" style="animation-delay: 200ms;">Item 3</div>
</div>
```

---

## Accessibility: Reduced Motion Support

All animations and transitions respect the `prefers-reduced-motion: reduce` media query.

**When reduced motion is enabled:**
- ❌ All animations are disabled (`animation: none`)
- ❌ All transitions are disabled (`transition: none`)
- ❌ Hover transforms are removed
- ✅ Critical visual feedback is preserved (static borders, shadows)

**Affected classes:**
- `.pulse-live` → Static green border + subtle shadow
- `.shimmer-load` → Static semi-transparent background
- `.fade-in-gpu` → No animation
- `.transition-scale`, `.transition-card`, `.glow-hover` → No transitions

**Testing:**
1. **macOS:** System Preferences → Accessibility → Display → Reduce motion
2. **Windows:** Settings → Accessibility → Visual effects → Animation effects (off)
3. **CSS DevTools:** Emulate `prefers-reduced-motion: reduce`

---

## Performance: GPU Acceleration

All effects use GPU-accelerated CSS properties to ensure smooth 60fps animations:

### GPU-Friendly Properties Used:
- ✅ `transform` (scale, translate)
- ✅ `opacity`
- ✅ `filter` / `backdrop-filter`
- ✅ `will-change` hints for browser optimization

### Avoid (Not Used):
- ❌ `width` / `height` (triggers layout)
- ❌ `top` / `left` (use `transform: translate` instead)
- ❌ `margin` / `padding` for animations

### Browser Compatibility:
- **Backdrop Filter:** Modern browsers + Safari (with `-webkit-` prefix included)
- **Border Image Gradient:** All modern browsers
- **Will-Change:** All modern browsers

---

## Common Patterns & Recipes

### Premium Dashboard Card
```html
<div class="glass-card glow-primary transition-card p-6 rounded-xl">
  <h3 class="text-xl font-bold mb-2">Total PnL</h3>
  <p class="text-3xl font-mono text-green-500">+$12,450</p>
</div>
```

### Real-time Data Widget
```html
<div class="glass-card pulse-live p-4 rounded-lg">
  <div class="flex items-center justify-between mb-2">
    <span class="text-sm text-muted-foreground">BTC/USD</span>
    <span class="text-green-500 text-xs">● Live</span>
  </div>
  <p class="text-2xl font-mono">$64,250.00</p>
</div>
```

### Loading Skeleton Card
```html
<div class="glass-card p-6 rounded-lg">
  <div class="shimmer-load h-6 w-40 rounded mb-4"></div>
  <div class="shimmer-load h-24 w-full rounded mb-2"></div>
  <div class="shimmer-load h-4 w-3/4 rounded"></div>
</div>
```

### Modal / Command Palette
```html
<div class="glass-card glow-primary rounded-2xl max-w-2xl mx-auto p-8 fade-in-gpu">
  <h2 class="text-2xl font-bold mb-4">Execute Trade</h2>
  <form>...</form>
</div>
```

### Interactive Stat Grid
```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
  <div class="glass-card transition-card p-4 rounded-lg cursor-pointer">
    <div class="text-sm text-muted-foreground">Win Rate</div>
    <div class="text-2xl font-bold text-green-500">68.5%</div>
  </div>
  <!-- More cards... -->
</div>
```

---

## Migration Guide

### Replace existing patterns:

**Before:**
```html
<div class="laurenzo-card">
  Content
</div>
```

**After:**
```html
<div class="glass-card transition-card">
  Content
</div>
```

**Before:**
```html
<div class="shimmer">
  Loading...
</div>
```

**After:**
```html
<div class="shimmer-load">
  Loading...
</div>
```

---

## Files Changed

- **Modified:** `client/src/index.css` — Added `@layer utilities` section with 10+ new classes
- **Created:** `client/src/demo/glassmorphism-demo.html` — Visual testing demo
- **Created:** `client/src/demo/GLASSMORPHISM_EFFECTS.md` — This documentation

---

## Next Steps

These utility classes are ready to be integrated into:
1. ✅ Dashboard stat cards
2. ✅ Position list items
3. ✅ Modal dialogs
4. ✅ Command palette
5. ✅ Real-time market feeds
6. ✅ Loading skeletons
7. ✅ Interactive buttons
8. ✅ Navigation elements

**Usage reminder:** Combine classes for maximum effect:
```html
<div class="glass-card glow-primary transition-card pulse-live">
  Premium interactive card with all effects
</div>
```
