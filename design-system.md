# AARO Parking — Design System

## 1. Layout Architecture

### App Structure
```
+------------------------------------------------------------------+
| .app-layout (flex, 100dvh)                                        |
|                                                                    |
| +----------+  +--------------------------------------------------+ |
| | Sidebar  |  | <main> canvas-area (flex: row)                   | |
| | (fixed)  |  |                                                  | |
| | 280-360px|  | +--------+ +---+ +--------+ +---+ +---------+   | |
| |          |  | | Canvas | | S | | Graph  | | S | | Prompt  |   | |
| |          |  | | flex:1 | | p | | 400px  | | p | | 360px   |   | |
| |          |  | | min300 | | l | | resize | | l | | resize  |   | |
| |          |  | |        | | i | | 200-   | | i | | 200-    |   | |
| |          |  | |        | | t | | 800px  | | t | | 800px   |   | |
| |          |  | +--------+ +---+ +--------+ +---+ +---------+   | |
| +----------+  +--------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Panel Widths
| Panel | Default | Min | Max | Resize |
|-------|---------|-----|-----|--------|
| Sidebar | `clamp(280px, 22vw, 360px)` | 280px | 360px | Responsive |
| Parking Canvas | `flex: 1` | 300px | - | Auto |
| Knowledge Graph | 400px | 200px | 800px | Splitter drag |
| AI Assistant | 360px | 200px | 800px | Splitter drag |
| Splitter | 5px | - | - | Fixed |

### Panel Header (Unified)
All panels share the same header style:
```
Height: 32px
Padding: 6px 12px
Font: 12px / 600
Color: #333
Background: #f8f8f8
Border-bottom: 1px solid #e5e5e5
Right metadata: 10px / 400 / #999
```

---

## 2. Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

### Scale
| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `title` | 15px | 600 | Sidebar header |
| `base` | 14px | 400 | Body text |
| `small` | 12px | 400-600 | Buttons, labels, UI |
| `xs` | 11px | 600 | Section titles (uppercase) |
| `xxs` | 10px | 400 | Metadata, panel info |
| `canvas-label` | 9px | 400 | Grid labels, coords |
| `spot-label` | 7-8px | 400 | Spot numbers, dims |

### Special
- Section titles: `text-transform: uppercase; letter-spacing: 0.06em`
- Sidebar header: `letter-spacing: 0.02em`
- Numeric values: `font-variant-numeric: tabular-nums`
- Line height: `1.5` (global)

---

## 3. Color System

### CSS Variables
```css
:root {
  --text-primary: #333;
  --text-secondary: #555;
  --text-muted: #888;
  --bg-canvas: #FAFAFA;
  --bg-sidebar: #F5F5F5;
  --bg-section: #FFFFFF;
  --border-color: #E0E0E0;
  --border-light: #EEEEEE;
}
```

### Canvas Palette
| Element | Fill | Stroke |
|---------|------|--------|
| Edge spots | `rgba(70, 130, 180, 0.35)` | `rgba(70, 130, 180, 0.6)` |
| Inner zone | `rgba(76, 153, 0, 0.35)` | `rgba(76, 153, 0, 0.6)` |
| Access lane | `rgba(200, 150, 50, 0.4)` | — |
| Inner ring | `rgba(200, 80, 80, 0.4)` | — |
| Boundary | — | `rgba(60, 60, 60, 0.8)` |
| Road edge | — | `rgba(70, 130, 180, 0.8)` |
| Spot outline | — | `rgba(40, 40, 40, 0.65)` |
| ADA spot | `rgba(230, 180, 50, 0.18)` | `rgba(180, 140, 30, 0.6)` |
| Bike spot | `rgba(60, 160, 80, 0.2)` | `rgba(40, 120, 60, 0.6)` |
| Selection | `rgba(255, 100, 50, 0.1)` | `rgba(255, 100, 50, 0.7)` |
| Highlight (graph) | `rgba(255, 160, 40, 0.25)` | `rgba(255, 160, 40, 0.7)` |

### Graph Node Colors
| Type | Fill | Opacity |
|------|------|---------|
| Parcel, Edge, Ring | `#222` | 0.85 |
| Parking spots | `#777` | 0.85 |
| Selected stroke | `#FF8C00` | 1.0 |
| Dimmed (inactive) | — | 0.15 |

### Grid
| Level | Color | Width |
|-------|-------|-------|
| Minor | `rgba(0, 0, 0, 0.04)` | 0.5px |
| Major | `rgba(0, 0, 0, 0.08)` | 0.5px |
| Labels | `rgba(0, 0, 0, 0.25)` | 9px |

### Gumball (Direction Arrows)
| Axis | Active | Inactive |
|------|--------|----------|
| Perpendicular | `rgba(220, 50, 50, 1)` / 3.5px | `rgba(220, 80, 80, 0.6)` / 2px |
| Tangent | `rgba(50, 180, 50, 1)` / 3.5px | `rgba(80, 180, 80, 0.6)` / 2px |

---

## 4. Spacing

```css
--padding-base: 12px;
--padding-small: 8px;
--padding-xs: 4px;
--gap-base: 8px;
```

| Breakpoint | Sidebar padding | Canvas padding |
|-----------|----------------|----------------|
| Mobile | 8px | 6px |
| Tablet | 10px | 8px |
| Desktop | 12px | 12px |

---

## 5. Components

### Button `.btn`
```
Padding: 6px 12px
Font: 12px / inherit
Border: 1px solid var(--border-color)
Border-radius: 6px
Background: #FFF → hover #EAEAEA → active #333
Color: #555 → active #FFF
Transition: 150ms
```

### Button Small `.btn-sm`
```
Padding: 4px 8px
Font: 11px
```

### Toggle Switch `.toggle-switch`
```
Width: 36px (mobile: 40px)
Height: 20px (mobile: 22px)
Border-radius: 10px
Background: var(--border-color) → on: var(--text-primary)
Slider: 16px circle (mobile: 18px), #FFF
Transition: 200ms
```

### Input `.sidebar-select`
```
Width: 100%
Padding: 5px 8px
Font: 11px
Border: 1px solid var(--border-color)
Border-radius: 4px
Focus border: var(--text-secondary)
```

### Slider
```
Track: height 4px (mobile: 8px), var(--border-color), radius 1px
Thumb: 14px circle (mobile: 20px), var(--text-primary)
```

### Stats Grid `.stats-grid`
```
Grid: 2 columns (mobile: 1)
Gap: 4px
Item padding: 6px 8px
Item border: 1px solid var(--border-light)
Item radius: 4px
Label: 10px uppercase, letter-spacing 0.04em, var(--text-muted)
Value: 14px / 600, var(--text-primary)
```

### Status Badge `.status-badge`
```
Padding: 3px 8px
Border-radius: 10px
Font: 11px / 600
Pass: bg rgba(76, 153, 0, 0.12), color #3a7a00
Fail: bg rgba(160, 50, 50, 0.12), color #a03232
```

---

## 6. Canvas Rendering Specs

### Line Widths
| Element | Width |
|---------|-------|
| Spot outline | 0.4px |
| Boundary | 1.0px |
| Road edge | 1.5px |
| Inner ring | 1.0px |
| Grid lines | 0.5px |
| Split line | 2.0px |
| Gumball active | 3.5px |
| Gumball inactive | 2.0px |

### Dash Patterns
| Element | Pattern |
|---------|---------|
| Result boundary | `[6, 4]` |
| Simplified boundary | `[8, 4]` |
| Access lane | `[3, 2]` |
| Inner ring | `[6, 4]` |
| Split in progress | `[5, 3]` |
| Preview line | `[4, 4]` |

### World Unit Constants
| Constant | Value |
|----------|-------|
| Spot width | 2.5m |
| Spot depth | 5.0m |
| Aisle width | 6.0m |
| Entry gap | 6.0m (3m half) |
| Fillet radius | 6.0m |
| Road corridor | 6.0m |
| Miter limit | 3.0m |

### Vertex States
| State | Fill | Radius | Stroke |
|-------|------|--------|--------|
| Default | #333 | 4px | — |
| Selected | `rgba(70, 130, 180, 0.5)` | 5px | — |
| Hover | `rgba(160, 50, 50, 0.6)` | 6px | 1.5px |

---

## 7. Graph View (Knowledge Graph)

### Force Layout
```
Repulsion: 800 * alpha
Attraction: 0.015 * alpha
Target distance: 70px
Damping: 0.7 → 1.0 (over 300 frames)
Alpha: 1.0 → 0.01 (force decay)
Gravity: 0.003 * alpha
Stable threshold: energy < 0.1
```

### Node Sizes (radius)
| Type | Radius |
|------|--------|
| Parcel | 20 |
| Underground | 16 |
| Inner Ring | 14 |
| Entry/Validation/UG Level/Ramp | 10 |
| Boundary Edge | 8 |
| Edge/Inner Spot | 6 |

### Tooltip (Hover Bubble)
```
Background: rgba(255, 255, 255, 0.92)
Border: 1px solid rgba(0, 0, 0, 0.08)
Border-radius: 10px
Shadow: rgba(0, 0, 0, 0.1) blur 12px offset-y 2px
Padding: 10px
Title: 11px bold #111
Content: 10px monospace #333
Header height: 32px
Line height: 16px
```

### Initial Layout
```
Layer spacing: 110px vertical
Node spacing: 70px horizontal
Random jitter: +/-12px
```

---

## 8. AI Assistant Panel

### Layout
```
Header: 32px, same unified style
Chat area: flex 1, overflow-y auto, padding 8px
Input bar: flex-shrink 0, padding 6px, border-top 1px solid #eee
```

### Message Bubbles
```
User: bg #E8F0FE, no border, radius 8px
AI: bg #FFF, border 1px solid #eee, radius 8px
Padding: 6px 10px
Font: 12px, line-height 1.5
Label: 10px / 600, user #1565C0, AI #444
```

### Input
```
Font: 11px
Padding: 6px 8px
Border: 1px solid #ddd
Border-radius: 6px
```

### Send Button
```
Padding: 6px 10px
Font: 11px / 600
Background: #333 (disabled: #ccc)
Color: #fff
Border-radius: 6px
```

---

## 9. Responsive Breakpoints

| Tier | Range | Layout |
|------|-------|--------|
| 1 | ≤479px | Sidebar overlay (70vh), column |
| 2 | 480-767px | Sidebar stacked (35vh), column |
| 3 | ≥768px | Side-by-side, sidebar 280px |
| 4 | ≥1024px | Sidebar 320px |
| 5 | ≥1440px | Sidebar 360px |

### Mobile Adaptations
- Touch targets: min 44px
- Toggle: 40x22px (vs 36x20px)
- Slider thumb: 20px (vs 14px)
- Slider track: 8px (vs 4px)
- Sidebar: rounded top, box-shadow, overlay backdrop

---

## 10. Z-Index Stack

| Layer | Element | Value |
|-------|---------|-------|
| Base | Canvas, panels | auto |
| Overlay | Sidebar backdrop (mobile) | 99 |
| Top | Sidebar (mobile) | 100 |
| Float | Download button (graph) | 5 |

---

## 11. Transitions

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Sidebar | max-height, transform | 300ms | ease |
| Button | background, color | 150ms | default |
| Toggle | background | 200ms | default |
| Toggle slider | transform | 200ms | default |
| Parcel item | background, border | 100ms | default |

---

## 12. Scrollbar

```css
.sidebar::-webkit-scrollbar { width: 4px; }
.sidebar::-webkit-scrollbar-track { background: transparent; }
.sidebar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
.sidebar::-webkit-scrollbar-thumb:hover { background: #aaa; }
```
