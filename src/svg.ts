import type { Point, SvgRegion } from "./types";
import { samplePathData } from "./path-data";

const PX_TO_MM = 25.4 / 96;
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function parseNumber(value: string | null | undefined, fallback = 0): number {
  if (!value) {
    return fallback;
  }
  const match = value.trim().match(/-?\d*\.?\d+/);
  return match ? Number(match[0]) : fallback;
}

function convertLengthToMm(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const trimmed = value.trim();
  const numeric = parseNumber(trimmed, 0);
  if (trimmed.endsWith("mm")) {
    return numeric;
  }
  if (trimmed.endsWith("cm")) {
    return numeric * 10;
  }
  if (trimmed.endsWith("in")) {
    return numeric * 25.4;
  }
  return numeric * PX_TO_MM;
}

function parsePointsAttribute(value: string): Point[] {
  return value
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(","))
    .filter((pair) => pair.length === 2)
    .map(([x, y]) => ({ x: parseFloat(x), y: parseFloat(y) }));
}

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function applyMatrix(point: Point, matrix: Matrix): Point {
  return {
    x: point.x * matrix[0] + point.y * matrix[2] + matrix[4],
    y: point.x * matrix[1] + point.y * matrix[3] + matrix[5],
  };
}

function parseTransform(transform: string | null): Matrix {
  if (!transform) {
    return IDENTITY;
  }

  const commands = Array.from(transform.matchAll(/([a-zA-Z]+)\(([^)]+)\)/g));
  return commands.reduce<Matrix>((current, [, command, rawValues]) => {
    const values = rawValues
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number);

    switch (command) {
      case "translate":
        return multiplyMatrix(current, [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0]);
      case "scale":
        return multiplyMatrix(current, [values[0] ?? 1, 0, 0, values[1] ?? values[0] ?? 1, 0, 0]);
      case "matrix":
        if (values.length === 6) {
          return multiplyMatrix(current, values as Matrix);
        }
        return current;
      default:
        return current;
    }
  }, IDENTITY);
}

function elementTransform(element: Element): Matrix {
  let current: Element | null = element;
  let matrix = IDENTITY;
  while (current && current.tagName !== "svg") {
    matrix = multiplyMatrix(parseTransform(current.getAttribute("transform")), matrix);
    current = current.parentElement;
  }
  return matrix;
}

export function parseSvgDocument(svgText: string): SvgRegion[] {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgText, "image/svg+xml");
  const svg = documentNode.querySelector("svg");
  if (!svg) {
    throw new Error("No SVG root element found.");
  }

  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  const widthMm = convertLengthToMm(svg.getAttribute("width"));
  const heightMm = convertLengthToMm(svg.getAttribute("height"));
  const vbWidth = viewBox?.[2] ?? (widthMm > 0 ? widthMm / PX_TO_MM : 100);
  const vbHeight = viewBox?.[3] ?? (heightMm > 0 ? heightMm / PX_TO_MM : 100);
  const scaleX = widthMm > 0 ? widthMm / vbWidth : PX_TO_MM;
  const scaleY = heightMm > 0 ? heightMm / vbHeight : PX_TO_MM;

  const scalePoint = (point: Point): Point => ({ x: point.x * scaleX, y: point.y * scaleY });

  const elements = Array.from(documentNode.querySelectorAll("path, polygon, polyline"));
  return elements.map((element, index) => {
    let contours: Point[][] = [];
    let closed = false;
    const transform = elementTransform(element);

    if (element.tagName === "path") {
      const subpaths = samplePathData(element.getAttribute("d") ?? "");
      contours = subpaths.map((subpath) => subpath.points.map((point) => scalePoint(applyMatrix(point, transform))));
      closed = subpaths.some((subpath) => subpath.closed);
    } else {
      contours = [parsePointsAttribute(element.getAttribute("points") ?? "").map((point) => scalePoint(applyMatrix(point, transform)))];
      closed = element.tagName === "polygon";
    }

    const points = contours[0] ?? [];

    return {
      id: `region-${index + 1}`,
      name: element.getAttribute("id") || `${element.tagName}-${index + 1}`,
      sourceType: element.tagName as SvgRegion["sourceType"],
      points,
      contours,
      closed,
      stitchType: (closed ? "fill" : "run") as SvgRegion["stitchType"],
      color: element.getAttribute("fill") || element.getAttribute("stroke") || "#1f6feb",
      params: {
        spacing: 0.8,
        angle: 45,
        runWidth: 1.2,
        satinWidth: 3,
        maxSatinWidth: 8,
      },
    };
  }).filter((region) => region.contours.some((contour) => contour.length >= 2));
}
