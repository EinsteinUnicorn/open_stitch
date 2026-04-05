# Prompt: Refine the UI of "Open Stitch" Embroidery Digitizer

## Context for the LLM

I'm building a product called **Open Stitch** — a browser-based embroidery digitizer that converts SVG vector files into machine-embroidery stitch files (DST and PES). The app uses AI-assisted tooling in its development and is being submitted as part of a grant application to an AI research organization. The reviewers have marketing, sales, and product backgrounds — not necessarily embroidery or hardware expertise.

The current stack is TypeScript + Vite + Canvas, with a Python backend for PES export. The app currently works: you load an SVG, it detects color regions, generates fill/satin/run stitches, previews them on a canvas, and exports machine-ready files.

I need you to refine the UI to feel like a **polished, brandable product** rather than an engineering prototype. The audience is people who evaluate AI-powered tools and creative software — they need to immediately understand what the product does and feel that it's well-crafted.

---

## Brand: Open Stitch

**Tagline options**:
- "Design to stitch in seconds"

**Brand personality**: Precise, craft-forward, modern, accessible. The intersection of digital fabrication and textile tradition. Think: if Figma made an embroidery tool.

**Name logic**: "Open" = open-source ethos, accessible, transparent process. "Stitch" = the atomic unit of embroidery, tactile, real.

---

## Style Guide Requirements

### Color Palette

Design a palette that evokes **thread and fabric meeting digital precision**. Requirements:
- A warm neutral base (think unbleached linen or natural cotton canvas — not stark white, not yellow-beige)
- A primary accent color that feels crafty but modern (consider deep indigo, forest teal, or a rich burgundy — something that looks like a real thread color)
- A secondary accent for CTAs and success states
- A muted palette for metadata, labels, and secondary text
- Semantic colors: success (export complete), warning (large jump distance), error (failed export)
- The canvas/preview area background should feel like fabric — subtle texture or grain, not a CSS grid

### Typography

- **Headlines/Brand**: A serif or semi-serif with personality — something that signals craft and quality. Consider fonts available on Google Fonts: Playfair Display, DM Serif Display, Lora, or Fraunces
- **Body/UI**: A clean geometric or humanist sans-serif. Consider: Inter, DM Sans, or Outfit
- **Monospace** (for stats, stitch counts, dimensions): JetBrains Mono or IBM Plex Mono
- Stats and numbers should feel like data visualization — large, confident, with units styled smaller

### Layout & Information Architecture

Restructure the left panel to tell a story with four clear phases:

1. **Import** — Load your SVG file. Show a drag-and-drop zone with a subtle icon. When files are loaded, show them as compact chips/cards with the region count.

2. **Configure** — Region list with stitch type controls. This is the "work" phase. Each region card should show: a small color swatch, the region name, stitch type selector, and a collapsible section for spacing/angle/width parameters. The currently-selected region should be visually prominent.

3. **Preview Stats** — Design dimensions, stitch count, thread count. Present these as a compact dashboard strip, not a full section. Use large monospace numbers. Consider: "2,928 stitches · 6 threads · 90×90mm"

4. **Export** — The culmination. Export buttons should be the most prominent CTAs on the page. Consider a split button or card: "Export DST" (primary) and "Export PES" (secondary). Add a brief success state when export completes.

### Canvas / Preview Area

This is the hero of the product. Refinements needed:

- **Default mode ("Design View")**: Show stitch lines with thread colors, no index numbers, no jump highlights. Clean and beautiful — this is what you'd screenshot for marketing.
- **Debug mode ("Stitch View")**: Toggle to show index numbers, jump stitches in amber, trim points. Label this clearly as a diagnostic view.
- Add a **toggle button** in the canvas overlay bar: "Design View / Stitch View"
- The canvas background should suggest fabric: a very subtle linen texture or warm off-white with faint woven grid lines (not the current CSS grid dots)
- Region outlines should be refined: thinner, more consistent, with subtle hover states

### Header / Brand Bar

Add a minimal top bar or integrate branding into the panel:
- "Open Stitch" wordmark — the word "Open" in the sans-serif body font (light weight), "Stitch" in the serif headline font (bold). This creates a visual tension between digital and craft.
- Optional: a small logomark. Consider a simple geometric icon — a needle/thread abstraction, or a single stitch "X" mark rendered as a clean vector.
- Subtle tagline beneath the wordmark in muted text

### Micro-interactions & Polish

- Buttons should have hover states with subtle transitions (150ms ease)
- Range sliders should show their current value in a tooltip or inline label (currently done, but style it better)
- The "Rebuild Stitches" action should feel secondary — it's a refresh, not a primary action. Consider making it an icon button (refresh icon) rather than a prominent labeled button
- Loading/processing state: when rebuilding stitches, show a brief skeleton or pulse animation on the canvas
- File import: animate the region cards appearing when a new SVG is loaded
- Export success: brief toast notification or checkmark animation

### Component Styling

- **Cards/Sections**: Softer radius (12-16px), subtle shadow, no hard borders. Use elevation (shadow depth) to create hierarchy rather than borders.
- **Buttons**: Primary = filled with primary accent, slightly rounded (8-10px radius, not full pill). Secondary = outlined or ghost. Danger = soft red background.
- **Inputs/Selects**: Consistent border radius, subtle focus rings in the accent color
- **Color swatches**: Slightly larger (24px), with a subtle ring/border. Consider showing thread color names from standard embroidery thread catalogs.
- **Badges**: The "Closed path" / "Open polyline" badge should use a more neutral styling — it's metadata, not a warning.

### Responsive Considerations

- Optimize for 1280px+ desktop as the primary experience (this is the demo/presentation view)
- The panel should be scrollable without affecting the canvas
- Canvas should fill available height minus any header bar
- At narrow widths, stack vertically with canvas on top

---

## What to Produce

1. **A complete CSS file** (or CSS custom properties + component styles) implementing this style guide
2. **Updated HTML structure** for the left panel reflecting the new information architecture (four phases)
3. **A canvas overlay bar** with Design View / Stitch View toggle and zoom controls
4. **A header/brand bar** component with the Open Stitch wordmark

Do NOT change any of the TypeScript logic, stitch generation, SVG parsing, or canvas rendering code. Only change `styles.css`, the HTML template in `main.ts`, and the `renderPreview` function's visual parameters (line widths, colors, index label visibility based on a view mode toggle).

Preserve all existing functionality — every button, input, and interaction must continue to work. Add the view mode toggle as new functionality.

---

## Visual References (for tone)

Think about the visual quality of these products (don't copy them, but match their level of craft):
- Figma's UI: clean, purposeful, every pixel considered
- Linear's aesthetic: minimal but warm, great typography
- Glowforge's marketing: craft meets technology, premium but accessible
- The Loom/Notion style of "software that feels like a workspace, not a dashboard"

The goal: when a grants reviewer opens this URL, their first reaction should be "oh, this is a real product" — not "oh, this is a hackathon project."
