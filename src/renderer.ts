import type { StitchPoint, SvgRegion, ThreadInfo } from "./types";

export interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function colorForRegion(region: SvgRegion): string {
  return region.color.startsWith("#") ? region.color : "#1f6feb";
}

export function renderPreview(
  canvas: HTMLCanvasElement,
  regions: SvgRegion[],
  stitches: StitchPoint[],
  threads: ThreadInfo[],
  selectedRegionId: string | null,
  viewport: ViewportState,
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.scale, viewport.scale);

  context.lineCap = "round";
  context.lineJoin = "round";

  for (const region of regions) {
    context.strokeStyle = colorForRegion(region);
    context.fillStyle = selectedRegionId === region.id ? `${colorForRegion(region)}10` : "transparent";
    context.lineWidth = selectedRegionId === region.id ? 0.5 : 0.25;
    for (const contour of region.contours) {
      context.beginPath();
      contour.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      if (region.closed) {
        context.closePath();
        if (selectedRegionId === region.id) {
          context.fill();
        }
      }
      context.stroke();
    }
  }

  context.lineWidth = 0.2;
  for (let i = 1; i < stitches.length; i += 1) {
    const previous = stitches[i - 1];
    const current = stitches[i];
    if (
      previous.x === undefined ||
      previous.y === undefined ||
      current.x === undefined ||
      current.y === undefined ||
      current.cmd === "color_change"
    ) {
      continue;
    }
    const threadColor = typeof current.color === "number" ? threads[current.color]?.hex : undefined;
    context.strokeStyle = current.cmd === "jump" ? "#f59e0b" : threadColor || "#111827";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(current.x, current.y);
    context.stroke();
  }

  stitches.forEach((stitch, index) => {
    if (stitch.x === undefined || stitch.y === undefined) {
      return;
    }
    const threadColor = typeof stitch.color === "number" ? threads[stitch.color]?.hex : undefined;
    context.fillStyle = stitch.cmd === "jump" ? "#f59e0b" : threadColor || "#111827";
    context.beginPath();
    context.arc(stitch.x, stitch.y, 0.35, 0, Math.PI * 2);
    context.fill();
    if (index % 12 === 0) {
      context.fillStyle = "#b91c1c";
      context.font = "1.6px monospace";
      context.fillText(String(index), stitch.x + 0.4, stitch.y - 0.4);
    }
  });

  context.restore();
}
