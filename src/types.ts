export type StitchCommand = "stitch" | "jump" | "trim" | "color_change";

export interface StitchPoint {
  x?: number;
  y?: number;
  cmd: StitchCommand;
  color?: number;
}

export type RegionKind = "fill" | "satin" | "run";

export interface Point {
  x: number;
  y: number;
}

export interface RegionParams {
  spacing: number;
  angle: number;
  satinWidth: number;
  maxSatinWidth: number;
}

export interface SvgRegion {
  id: string;
  name: string;
  designId?: string;
  designName?: string;
  sourceType: "path" | "polygon" | "polyline";
  points: Point[];
  contours: Point[][];
  closed: boolean;
  stitchType: RegionKind;
  color: string;
  params: RegionParams;
}

export interface ThreadInfo {
  hex: string;
  name: string;
}
