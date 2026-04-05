import type { Point } from "./types";

const DEG_TO_RAD = Math.PI / 180;

export function rotatePoint(point: Point, angleDeg: number): Point {
  const angle = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function rotatePoints(points: Point[], angleDeg: number): Point[] {
  return points.map((point) => rotatePoint(point, angleDeg));
}

export function polygonBounds(points: Point[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function contoursBounds(contours: Point[][]) {
  const allPoints = contours.flat();
  return polygonBounds(allPoints);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

export function samplePolyline(points: Point[], spacing: number, closed = false): Point[] {
  if (points.length < 2) {
    return points.slice();
  }
  const source = closed ? [...points, points[0]] : points;
  const sampled: Point[] = [source[0]];
  let carry = 0;

  for (let i = 1; i < source.length; i += 1) {
    const start = source[i - 1];
    const end = source[i];
    const segmentLength = distance(start, end);
    if (segmentLength === 0) {
      continue;
    }

    let cursor = spacing - carry;
    while (cursor <= segmentLength) {
      const t = cursor / segmentLength;
      sampled.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
      cursor += spacing;
    }
    carry = segmentLength - (cursor - spacing);
    if (carry >= spacing) {
      carry = 0;
    }
  }

  const last = source[source.length - 1];
  if (!closed && (sampled.length === 0 || !samePoint(sampled[sampled.length - 1], last))) {
    sampled.push(last);
  }
  return dedupePoints(sampled);
}

export function scanlineIntersections(points: Point[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ymin = Math.min(a.y, b.y);
    const ymax = Math.max(a.y, b.y);
    if (a.y === b.y || y < ymin || y >= ymax) {
      continue;
    }
    const ratio = (y - a.y) / (b.y - a.y);
    xs.push(a.x + (b.x - a.x) * ratio);
  }
  return xs.sort((left, right) => left - right);
}

export function verticalIntersections(points: Point[], x: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const xmin = Math.min(a.x, b.x);
    const xmax = Math.max(a.x, b.x);
    if (a.x === b.x || x < xmin || x >= xmax) {
      continue;
    }
    const ratio = (x - a.x) / (b.x - a.x);
    ys.push(a.y + (b.y - a.y) * ratio);
  }
  return ys.sort((top, bottom) => top - bottom);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInContours(point: Point, contours: Point[][]): boolean {
  return contours.reduce((inside, contour) => (pointInPolygon(point, contour) ? !inside : inside), false);
}

export function centroid(points: Point[]): Point {
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

export function principalAxisAngle(points: Point[]): number {
  const center = centroid(points);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  return (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function unitNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

export function dedupePoints(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
}

export function samePoint(a: Point, b: Point, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

export function sampleSegment(start: Point, end: Point, spacing: number): Point[] {
  const length = distance(start, end);
  if (length === 0) {
    return [start];
  }
  const points: Point[] = [];
  const step = Math.max(0.6, spacing);
  for (let cursor = 0; cursor < length; cursor += step) {
    const t = cursor / length;
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }
  points.push(end);
  return dedupePoints(points);
}
