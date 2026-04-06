# Open Stitch — Shape Analyzer Architecture Plan

## Context

Open Stitch is an embroidery digitizer web app (TypeScript + Vite + Canvas). Repo: https://github.com/EinsteinUnicorn/open_stitch — Live: https://open-stitch-bay.vercel.app

The app loads SVGs, lets the user assign fill/satin/run stitch types per region, previews stitches on canvas, and exports DST/PES. The core problem: satin stitching doesn't work well because each region only supports a single fixed angle. For shapes like a circular ring, the stitches need to radiate outward (perpendicular to the curve at every point), not all go in one direction.

## What needs to be built

### Step 1: Create `src/stitch-knowledge.ts`

Extract ALL embroidery domain constants from the codebase into a single knowledge file. Currently they're scattered as magic numbers:

- `25.4 / 96` (px-to-mm) hardcoded in `src/svg.ts` line 4
- `spacing: 0.8, angle: 45, runWidth: 1.2, satinWidth: 3, maxSatinWidth: 8` hardcoded in `src/svg.ts` lines 148-152 as default region params
- `2` and `7` (travel thresholds) hardcoded in `src/stitch-generators.ts` lines 16-17

The knowledge file should export these grouped objects:

- `MACHINE` — Brother machine limits: max stitch length 12.1mm, min stitch length 0.3mm, hoop sizes
- `CLASSIFICATION` — thresholds for auto stitch-type assignment: satin max width 8mm, run max width 1.5mm, min closed contour points 3
- `DEFAULTS` — starting values for new regions: fill spacing 0.8mm, satin spacing 0.4mm, default angle 45°, satin width 3mm, run spacing 2mm, run width 1.2mm
- `TRAVEL` — short connect threshold 2mm, trim before jump threshold 7mm
- `QUALITY` — density limits for a future quality gate: min density 2 stitches/mm², max density 30, max stitch length warning 7mm, edge spacing range 0.5-1.2mm
- `SVG_IMPORT` — pxPerInch 96, pxToMm 25.4/96
- `defaultRegionParams()` — function returning the default params object so svg.ts doesn't construct it inline

Then update `src/svg.ts` to import `SVG_IMPORT` and `defaultRegionParams` from stitch-knowledge, and update `src/stitch-generators.ts` to import `TRAVEL` from stitch-knowledge. Remove the hardcoded values. No other file should contain embroidery domain constants after this step.

### Step 2: Extend `src/types.ts`

Add a `ShapeAnalysis` interface and `ShapeClass` type. Add `analysis: ShapeAnalysis | null` to the `SvgRegion` interface. Set it to `null` in svg.ts on import. Deep-copy it in `cloneRegions()` in main.ts.

`ShapeClass` should be a union: `"stroke-straight" | "stroke-curved" | "region-wide" | "region-narrow" | "open-path" | "unknown"`

`ShapeAnalysis` fields:

- `shapeClass: ShapeClass` — drives auto stitch-type selection
- `averageWidth: number` — width across the skeleton in mm
- `skeletonAngle: number` — principal axis angle, the "long" direction (degrees)
- `recommendedAngle: number` — skeletonAngle + 90°, normalized 0-180. This is the stitch direction.
- `needsVariableAngle: boolean` — true for curved shapes like rings where a single angle can't work
- `recommendedStitchType: RegionKind` — fill, satin, or run based on width vs CLASSIFICATION thresholds
- `skeleton: Point[] | null` — sampled medial axis points. 2 points for straight shapes, N points for curves, null if unknown.

### Step 3: Build `src/shape-analyzer.ts`

This is the new pipeline stage that fills in `region.analysis`. It should:

1. Take a region's contours and compute the principal axis angle using the existing `principalAxisAngle()` in `src/geometry.ts`
2. Sweep scanlines perpendicular to the principal axis to measure average width
3. Classify the shape based on width vs thresholds in `CLASSIFICATION`
4. For straight strokes: set `recommendedAngle = principalAxisAngle + 90°`
5. For curved shapes (ring detection — two concentric contours): set `needsVariableAngle = true` and compute skeleton as the midline between inner and outer contours

The iron law for stitch direction: **stitches must cross the narrow dimension of the shape, perpendicular to the skeleton.** This is non-negotiable. If the analyzer produces an angle that would make stitches run parallel to a stroke's long axis, that's a bug.

### Step 4: Wire it into the pipeline

In `main.ts`, the `rebuild()` function should call the analyzer on each region before `buildStitchPlan()`. The stitch generators should read `region.analysis.recommendedAngle` when the user hasn't manually overridden the angle. Add an `angleOverride: boolean` field or similar to track whether the user has manually set the angle vs using the auto value.

## Architecture patterns being followed

- **Knowledge-skills separation** — domain knowledge in stitch-knowledge.ts, procedures everywhere else
- **Pipeline chaining** — SVG import → shape analysis → stitch type assignment → stitch generation → quality gate → export, each stage producing an inspectable artifact
- **Three-mode architecture** (planned) — auto (analyzer decides everything), guided (user overrides per region), headless (batch/CI)
- **Iron law** — stitch perpendicular to skeleton, always crossing narrow width
- **Quality gate loop** (planned) — post-generation checks for stitch length, density, coverage

## Design context

The motivating use case is the zhongcha (中茶) logo. It has:

- A circular ring that needs RADIAL satin (stitches radiating outward, perpendicular to the ring at every point)
- Character strokes (中) that need satin perpendicular to each stroke's long axis — vertical bars get horizontal stitches, horizontal bars get vertical stitches
- Wide areas that need fill stitch
- The current code only supports one fixed angle per region, which can't handle the ring

## Verification

After each step, run `npx tsc --noEmit` to confirm the project still compiles. The app behavior should remain identical through steps 1-2. Step 3 adds the analyzer but doesn't change output until step 4 wires it in. Step 4 should produce visibly different (better) stitch angles in the preview.
