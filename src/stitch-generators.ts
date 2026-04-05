import {
  centroid,
  contoursBounds,
  distance,
  pointInContours,
  polylineLength,
  rotatePoints,
  sampleSegment,
  samplePolyline,
  scanlineIntersections,
  unitNormal,
  verticalIntersections,
} from "./geometry";
import type { Point, RegionKind, StitchPoint, SvgRegion, ThreadInfo } from "./types";

const SHORT_CONNECT_THRESHOLD_MM = 2;
const TRIM_BEFORE_JUMP_THRESHOLD_MM = 7;

interface RegionBlock {
  region: SvgRegion;
  stitches: StitchPoint[];
  entry: Point;
  exit: Point;
  reversible: boolean;
}

function isRedLike(colorHex: string): boolean {
  const normalized = colorHex.toLowerCase();
  return normalized.startsWith("#c2") || normalized.startsWith("#b4") || normalized.startsWith("#79");
}

export function generateRunStitches(points: Point[], spacing: number, color: number): StitchPoint[] {
  const sampled = samplePolyline(points, Math.max(spacing, 0.5));
  return sampled.map((point) => ({ x: point.x, y: point.y, cmd: "stitch" as const, color }));
}

function repeatRunPasses(base: StitchPoint[], passes: number): StitchPoint[] {
  if (passes <= 1 || base.length === 0) {
    return base.slice();
  }

  const repeated: StitchPoint[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const ordered = pass % 2 === 0 ? base : base.slice().reverse().map((stitch) => ({ ...stitch }));
    if (repeated.length === 0) {
      repeated.push(...ordered);
      continue;
    }
    const first = ordered.find((stitch) => stitch.x !== undefined && stitch.y !== undefined);
    if (first?.x !== undefined && first?.y !== undefined) {
      repeated.push({ x: first.x, y: first.y, cmd: "jump", color: first.color });
    }
    repeated.push(...ordered);
  }
  return dedupeStitches(repeated);
}

function runPassCount(runWidth: number): number {
  return Math.max(1, Math.min(6, Math.round(runWidth / 0.6)));
}

function generateContourRunStitches(contours: Point[][], spacing: number, runWidth: number, color: number): StitchPoint[] {
  const closedContours = contours
    .filter((contour) => contour.length >= 3)
    .slice()
    .sort((left, right) => Math.abs(polylineLength(right)) - Math.abs(polylineLength(left)));

  if (closedContours.length === 0) {
    return [];
  }

  const stitches: StitchPoint[] = [];
  closedContours.forEach((contour, index) => {
    const outline = samplePolyline(contour, Math.max(spacing, 0.5), true);
    if (outline.length === 0) {
      return;
    }
    if (index > 0) {
      stitches.push({ x: outline[0].x, y: outline[0].y, cmd: "jump", color });
    }
    outline.forEach((point) => stitches.push({ x: point.x, y: point.y, cmd: "stitch", color }));
  });

  return dedupeStitches(stitches);
}

function generateClosedColumnSatin(
  contour: Point[],
  spacing: number,
  angle: number,
  maxSatinWidth: number,
  color: number,
): StitchPoint[] | null {
  const axisAngle = angle;
  const rotated = rotatePoints(contour, -axisAngle);
  const bounds = contoursBounds([rotated]);
  const step = Math.max(spacing, 0.5);
  const columns: { a: Point; b: Point; width: number }[] = [];

  for (let x = bounds.minX + step / 2; x <= bounds.maxX; x += step) {
    const intersections = verticalIntersections(rotated, x);
    if (intersections.length < 2) {
      continue;
    }
    const top = intersections[0];
    const bottom = intersections[intersections.length - 1];
    const width = bottom - top;
    if (width < 0.2) {
      continue;
    }
    columns.push({
      a: rotatePoints([{ x, y: top }], axisAngle)[0],
      b: rotatePoints([{ x, y: bottom }], axisAngle)[0],
      width,
    });
  }

  if (columns.length < 2) {
    return null;
  }

  const averageWidth = columns.reduce((sum, column) => sum + column.width, 0) / columns.length;
  if (averageWidth > maxSatinWidth) {
    return null;
  }

  const stitches: StitchPoint[] = [];
  columns.forEach((column, index) => {
    const pair = index % 2 === 0 ? [column.a, column.b] : [column.b, column.a];
    pair.forEach((point) => stitches.push({ x: point.x, y: point.y, cmd: "stitch", color }));
  });
  return dedupeStitches(stitches);
}

export function generateSatinStitches(
  points: Point[],
  contours: Point[][],
  spacing: number,
  width: number,
  angle: number,
  color: number,
  maxSatinWidth: number,
): StitchPoint[] {
  const closedContours = contours.filter((contour) => contour.length >= 3);
  if (closedContours.length === 1) {
    const columnSatin = generateClosedColumnSatin(closedContours[0], spacing, angle, maxSatinWidth, color);
    if (columnSatin) {
      return columnSatin;
    }
    return generateFillStitches(contours, spacing, angle, color);
  }
  if (closedContours.length >= 2) {
    return generateFillStitches(contours, spacing, angle, color);
  }

  const sampled = samplePolyline(points, Math.max(spacing, 0.75));
  if (sampled.length < 2) {
    return [];
  }
  const halfWidth = Math.max(width, 0.8) / 2;
  const stitches: StitchPoint[] = [];

  for (let i = 0; i < sampled.length; i += 1) {
    const current = sampled[i];
    const next = sampled[Math.min(i + 1, sampled.length - 1)];
    const prev = sampled[Math.max(i - 1, 0)];
    const normal = unitNormal(prev, next);
    const left = { x: current.x + normal.x * halfWidth, y: current.y + normal.y * halfWidth };
    const right = { x: current.x - normal.x * halfWidth, y: current.y - normal.y * halfWidth };
    const pair = i % 2 === 0 ? [left, right] : [right, left];
    for (const point of pair) {
      stitches.push({ x: point.x, y: point.y, cmd: "stitch", color });
    }
  }

  return dedupeStitches(stitches);
}

export function generateFillStitches(contours: Point[][], spacing: number, angle: number, color: number): StitchPoint[] {
  const closedContours = contours.filter((contour) => contour.length >= 3);
  if (closedContours.length === 0) {
    return [];
  }
  const rotatedContours = closedContours.map((contour) => rotatePoints(contour, -angle));
  const bounds = contoursBounds(rotatedContours);
  const rows: Point[][][] = [];
  const rowSpacing = Math.max(spacing, 0.3);
  const stitchSpacing = Math.min(Math.max(spacing * 0.9, 0.45), 2);

  for (let y = bounds.minY + rowSpacing / 2; y <= bounds.maxY; y += rowSpacing) {
    const intersections = rotatedContours
      .flatMap((contour) => scanlineIntersections(contour, y))
      .sort((a, b) => a - b)
      .filter((value, index, list) => index === 0 || Math.abs(value - list[index - 1]) > 0.01);
    const rowSegments: Point[][] = [];
    for (let i = 0; i < intersections.length - 1; i += 1) {
      const start = intersections[i];
      const end = intersections[i + 1];
      if (end === undefined || end - start < 0.2) {
        continue;
      }
      const mid = { x: (start + end) / 2, y };
      if (!pointInContours(mid, rotatedContours)) {
        continue;
      }
      const rotatedSegment = sampleSegment({ x: start, y }, { x: end, y }, stitchSpacing);
      rowSegments.push(rotatePoints(rotatedSegment, angle));
    }
    if (rowSegments.length > 0) {
      rows.push(rowSegments);
    }
  }

  const stitches: StitchPoint[] = [];
  let lastPoint: Point | null = null;

  rows.forEach((segments, index) => {
    const orderedSegments = index % 2 === 0 ? segments : segments.slice().reverse();
    orderedSegments.forEach((segment) => {
      const orderedPoints = index % 2 === 0 ? segment : segment.slice().reverse();
      const start = orderedPoints[0];
      if (lastPoint && distance(lastPoint, start) > stitchSpacing * 1.5) {
        stitches.push({ x: start.x, y: start.y, cmd: "jump", color });
      }
      orderedPoints.forEach((point) => stitches.push({ x: point.x, y: point.y, cmd: "stitch", color }));
      lastPoint = orderedPoints[orderedPoints.length - 1];
    });
  });

  const edgeSpacing = Math.min(Math.max(spacing, 0.5), 1.2);
  closedContours.forEach((contour) => {
    const outline = samplePolyline(contour, edgeSpacing, true);
    if (outline.length === 0) {
      return;
    }
    if (stitches.length > 0) {
      const start = outline[0];
      stitches.push({ x: start.x, y: start.y, cmd: "jump", color });
    }
    outline.forEach((point) => stitches.push({ x: point.x, y: point.y, cmd: "stitch", color }));
  });

  return dedupeStitches(stitches);
}

function dedupeStitches(stitches: StitchPoint[]): StitchPoint[] {
  return stitches.filter((stitch, index) => {
    if (index === 0) {
      return true;
    }
    const prev = stitches[index - 1];
    return stitch.x !== prev.x || stitch.y !== prev.y || stitch.cmd !== prev.cmd;
  });
}

function firstCoordinate(stitches: StitchPoint[]): Point | null {
  const stitch = stitches.find((item) => item.x !== undefined && item.y !== undefined);
  return stitch && stitch.x !== undefined && stitch.y !== undefined ? { x: stitch.x, y: stitch.y } : null;
}

function lastCoordinate(stitches: StitchPoint[]): Point | null {
  for (let index = stitches.length - 1; index >= 0; index -= 1) {
    const stitch = stitches[index];
    if (stitch.x !== undefined && stitch.y !== undefined) {
      return { x: stitch.x, y: stitch.y };
    }
  }
  return null;
}

function reverseRegionStitches(stitches: StitchPoint[]): StitchPoint[] {
  return stitches
    .slice()
    .reverse()
    .map((stitch) => ({ ...stitch }));
}

function buildRegionBlock(region: SvgRegion, colorIndex: number): RegionBlock | null {
  const stitches = generateRegionStitches(region, colorIndex);
  const entry = firstCoordinate(stitches);
  const exit = lastCoordinate(stitches);
  if (!entry || !exit || stitches.length === 0) {
    return null;
  }
  return {
    region,
    stitches,
    entry,
    exit,
    reversible: region.stitchType === "fill",
  };
}

function orientBlock(block: RegionBlock, reverse: boolean): RegionBlock {
  if (!reverse || !block.reversible) {
    return block;
  }
  const stitches = reverseRegionStitches(block.stitches);
  const entry = firstCoordinate(stitches);
  const exit = lastCoordinate(stitches);
  if (!entry || !exit) {
    return block;
  }
  return {
    ...block,
    stitches,
    entry,
    exit,
  };
}

function generateRegionStitches(region: SvgRegion, colorIndex: number): StitchPoint[] {
  switch (region.stitchType as RegionKind) {
    case "fill":
      return generateFillStitches(region.contours, region.params.spacing, region.params.angle, colorIndex);
    case "satin":
      return generateSatinStitches(
        region.points,
        region.contours,
        region.params.spacing,
        region.params.satinWidth,
        region.params.angle,
        colorIndex,
        region.params.maxSatinWidth,
      );
    case "run":
    default:
      if (region.closed) {
        return generateContourRunStitches(region.contours, region.params.spacing, region.params.runWidth, colorIndex);
      }
      return repeatRunPasses(generateRunStitches(region.points, region.params.spacing, colorIndex), runPassCount(region.params.runWidth));
  }
}

function optimizeRegionBlocks(blocks: RegionBlock[]): RegionBlock[] {
  if (blocks.length <= 1) {
    return blocks.slice();
  }

  const remaining = blocks.slice();
  let currentPoint: Point | null = null;
  const ordered: RegionBlock[] = [];

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestBlock = remaining[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const forwardDistance = currentPoint ? distance(currentPoint, candidate.entry) : centroid(candidate.region.points).x + centroid(candidate.region.points).y;
      if (forwardDistance < bestDistance) {
        bestDistance = forwardDistance;
        bestIndex = index;
        bestBlock = candidate;
      }

      if (candidate.reversible && currentPoint) {
        const reversed = orientBlock(candidate, true);
        const reverseDistance = distance(currentPoint, reversed.entry);
        if (reverseDistance < bestDistance) {
          bestDistance = reverseDistance;
          bestIndex = index;
          bestBlock = reversed;
        }
      }
    });

    ordered.push(bestBlock);
    currentPoint = bestBlock.exit;
    remaining.splice(bestIndex, 1);
  }

  return ordered;
}

function groupRegionsByColor(regions: SvgRegion[]): { color: string; regions: SvgRegion[] }[] {
  const groups = new Map<string, SvgRegion[]>();
  regions.forEach((region) => {
    const key = region.color.toLowerCase();
    const collection = groups.get(key);
    if (collection) {
      collection.push(region);
      return;
    }
    groups.set(key, [region]);
  });
  return Array.from(groups.entries()).map(([color, groupedRegions]) => ({ color, regions: groupedRegions }));
}

function appendTravel(stitches: StitchPoint[], from: Point | null, to: Point, colorIndex: number) {
  if (!from) {
    stitches.push({ x: to.x, y: to.y, cmd: "jump", color: colorIndex });
    return;
  }

  const travelDistance = distance(from, to);
  if (travelDistance <= 0.01) {
    return;
  }
  if (travelDistance <= SHORT_CONNECT_THRESHOLD_MM) {
    const connector = generateRunStitches([from, to], Math.max(travelDistance / 2, 0.5), colorIndex);
    connector.slice(1).forEach((stitch) => stitches.push(stitch));
    return;
  }
  if (travelDistance > TRIM_BEFORE_JUMP_THRESHOLD_MM) {
    stitches.push({ x: from.x, y: from.y, cmd: "trim", color: colorIndex });
  }
  stitches.push({ x: to.x, y: to.y, cmd: "jump", color: colorIndex });
}

export function buildStitchPlan(regions: SvgRegion[]): { stitches: StitchPoint[]; threads: ThreadInfo[] } {
  const groupedByColor = groupRegionsByColor(regions);
  const stitches: StitchPoint[] = [];
  const threads: ThreadInfo[] = groupedByColor.map((group, index) => ({
    hex: group.color,
    name: `Color ${index + 1}`,
  }));

  groupedByColor.forEach((group, colorIndex) => {
    const blocks = optimizeRegionBlocks(
      group.regions
        .map((region) => buildRegionBlock(region, colorIndex))
        .filter((block): block is RegionBlock => block !== null),
    );

    let previousExit: Point | null = null;

    blocks.forEach((block, regionIndex) => {
      if (block.stitches.length === 0) {
        return;
      }

      if (stitches.length > 0 && regionIndex === 0) {
        stitches.push({ cmd: "color_change" });
        previousExit = null;
      }
      appendTravel(stitches, previousExit, block.entry, colorIndex);
      stitches.push(...block.stitches);
      stitches.push({
        cmd: "trim",
        x: block.exit.x,
        y: block.exit.y,
        color: colorIndex,
      });
      previousExit = block.exit;
    });
  });

  return { stitches, threads };
}
