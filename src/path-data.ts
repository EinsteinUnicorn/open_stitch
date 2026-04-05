import type { Point } from "./types";

type PathCommandType =
  | "M"
  | "m"
  | "L"
  | "l"
  | "H"
  | "h"
  | "V"
  | "v"
  | "C"
  | "c"
  | "S"
  | "s"
  | "Q"
  | "q"
  | "T"
  | "t"
  | "Z"
  | "z";

interface ParsedCommand {
  type: PathCommandType;
  values: number[];
}

interface Subpath {
  points: Point[];
  closed: boolean;
}

const COMMAND_LENGTH: Record<string, number> = {
  M: 2,
  m: 2,
  L: 2,
  l: 2,
  H: 1,
  h: 1,
  V: 1,
  v: 1,
  C: 6,
  c: 6,
  S: 4,
  s: 4,
  Q: 4,
  q: 4,
  T: 2,
  t: 2,
  Z: 0,
  z: 0,
};

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cubicPoint(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const ab = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  const bc = { x: lerp(b.x, c.x, t), y: lerp(b.y, c.y, t) };
  const cd = { x: lerp(c.x, d.x, t), y: lerp(c.y, d.y, t) };
  const abbc = { x: lerp(ab.x, bc.x, t), y: lerp(ab.y, bc.y, t) };
  const bccd = { x: lerp(bc.x, cd.x, t), y: lerp(bc.y, cd.y, t) };
  return { x: lerp(abbc.x, bccd.x, t), y: lerp(abbc.y, bccd.y, t) };
}

function quadraticPoint(a: Point, b: Point, c: Point, t: number): Point {
  const ab = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  const bc = { x: lerp(b.x, c.x, t), y: lerp(b.y, c.y, t) };
  return { x: lerp(ab.x, bc.x, t), y: lerp(ab.y, bc.y, t) };
}

function sampleCurve(
  sampler: (t: number) => Point,
  estimate: number,
): Point[] {
  const segments = Math.max(6, Math.ceil(estimate / 4));
  const points: Point[] = [];
  for (let index = 1; index <= segments; index += 1) {
    points.push(sampler(index / segments));
  }
  return points;
}

function tokenizePathData(pathData: string): string[] {
  return pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
}

function parsePathData(pathData: string): ParsedCommand[] {
  const tokens = tokenizePathData(pathData);
  const commands: ParsedCommand[] = [];
  let index = 0;
  let currentType: PathCommandType | null = null;

  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[a-zA-Z]$/.test(token)) {
      currentType = token as PathCommandType;
      index += 1;
      if (COMMAND_LENGTH[currentType] === 0) {
        commands.push({ type: currentType, values: [] });
      }
      continue;
    }

    if (!currentType) {
      throw new Error("Invalid SVG path data.");
    }

    const expected = COMMAND_LENGTH[currentType];
    if (expected === 0) {
      continue;
    }

    const values = tokens.slice(index, index + expected).map(Number);
    if (values.length < expected || values.some(Number.isNaN)) {
      break;
    }
    commands.push({ type: currentType, values });
    index += expected;

    if (currentType === "M") {
      currentType = "L";
    } else if (currentType === "m") {
      currentType = "l";
    }
  }

  return commands;
}

function pushUnique(points: Point[], point: Point) {
  const last = points[points.length - 1];
  if (!last || Math.abs(last.x - point.x) > 1e-6 || Math.abs(last.y - point.y) > 1e-6) {
    points.push(point);
  }
}

export function samplePathData(pathData: string): Subpath[] {
  const commands = parsePathData(pathData);
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  let currentPoint: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let previousControl: Point | null = null;

  const ensureSubpath = () => {
    if (!current) {
      current = { points: [], closed: false };
      subpaths.push(current);
    }
    return current;
  };

  for (const command of commands) {
    const { type, values } = command;
    switch (type) {
      case "M":
      case "m": {
        const destination =
          type === "M"
            ? { x: values[0], y: values[1] }
            : { x: currentPoint.x + values[0], y: currentPoint.y + values[1] };
        current = { points: [], closed: false };
        subpaths.push(current);
        pushUnique(current.points, destination);
        currentPoint = destination;
        subpathStart = destination;
        previousControl = null;
        break;
      }
      case "L":
      case "l": {
        const destination =
          type === "L"
            ? { x: values[0], y: values[1] }
            : { x: currentPoint.x + values[0], y: currentPoint.y + values[1] };
        pushUnique(ensureSubpath().points, destination);
        currentPoint = destination;
        previousControl = null;
        break;
      }
      case "H":
      case "h": {
        const destination =
          type === "H"
            ? { x: values[0], y: currentPoint.y }
            : { x: currentPoint.x + values[0], y: currentPoint.y };
        pushUnique(ensureSubpath().points, destination);
        currentPoint = destination;
        previousControl = null;
        break;
      }
      case "V":
      case "v": {
        const destination =
          type === "V"
            ? { x: currentPoint.x, y: values[0] }
            : { x: currentPoint.x, y: currentPoint.y + values[0] };
        pushUnique(ensureSubpath().points, destination);
        currentPoint = destination;
        previousControl = null;
        break;
      }
      case "C":
      case "c": {
        const control1 =
          type === "C"
            ? { x: values[0], y: values[1] }
            : { x: currentPoint.x + values[0], y: currentPoint.y + values[1] };
        const control2 =
          type === "C"
            ? { x: values[2], y: values[3] }
            : { x: currentPoint.x + values[2], y: currentPoint.y + values[3] };
        const destination =
          type === "C"
            ? { x: values[4], y: values[5] }
            : { x: currentPoint.x + values[4], y: currentPoint.y + values[5] };
        const estimate =
          distance(currentPoint, control1) +
          distance(control1, control2) +
          distance(control2, destination);
        sampleCurve((t) => cubicPoint(currentPoint, control1, control2, destination, t), estimate).forEach((point) =>
          pushUnique(ensureSubpath().points, point),
        );
        currentPoint = destination;
        previousControl = control2;
        break;
      }
      case "S":
      case "s": {
        const control1 = previousControl
          ? { x: currentPoint.x * 2 - previousControl.x, y: currentPoint.y * 2 - previousControl.y }
          : currentPoint;
        const control2 =
          type === "S"
            ? { x: values[0], y: values[1] }
            : { x: currentPoint.x + values[0], y: currentPoint.y + values[1] };
        const destination =
          type === "S"
            ? { x: values[2], y: values[3] }
            : { x: currentPoint.x + values[2], y: currentPoint.y + values[3] };
        const estimate =
          distance(currentPoint, control1) +
          distance(control1, control2) +
          distance(control2, destination);
        sampleCurve((t) => cubicPoint(currentPoint, control1, control2, destination, t), estimate).forEach((point) =>
          pushUnique(ensureSubpath().points, point),
        );
        currentPoint = destination;
        previousControl = control2;
        break;
      }
      case "Q":
      case "q": {
        const control: Point =
          type === "Q"
            ? { x: values[0], y: values[1] }
            : { x: currentPoint.x + values[0], y: currentPoint.y + values[1] };
        const destination =
          type === "Q"
            ? { x: values[2], y: values[3] }
            : { x: currentPoint.x + values[2], y: currentPoint.y + values[3] };
        const estimate = distance(currentPoint, control) + distance(control, destination);
        sampleCurve((t) => quadraticPoint(currentPoint, control, destination, t), estimate).forEach((point) =>
          pushUnique(ensureSubpath().points, point),
        );
        currentPoint = destination;
        previousControl = control;
        break;
      }
      case "T":
      case "t": {
        const control: Point = previousControl
          ? { x: currentPoint.x * 2 - previousControl.x, y: currentPoint.y * 2 - previousControl.y }
          : { ...currentPoint };
        const destination =
          type === "T"
            ? { x: values[0], y: values[1] }
            : { x: currentPoint.x + values[0], y: currentPoint.y + values[1] };
        const estimate = distance(currentPoint, control) + distance(control, destination);
        sampleCurve((t) => quadraticPoint(currentPoint, control, destination, t), estimate).forEach((point) =>
          pushUnique(ensureSubpath().points, point),
        );
        currentPoint = destination;
        previousControl = control;
        break;
      }
      case "Z":
      case "z": {
        const subpath = ensureSubpath();
        subpath.closed = true;
        pushUnique(subpath.points, subpathStart);
        currentPoint = subpathStart;
        previousControl = null;
        break;
      }
      default:
        previousControl = null;
        break;
    }
  }

  return subpaths.filter((subpath) => subpath.points.length >= 2);
}
