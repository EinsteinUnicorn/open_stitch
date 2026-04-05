from __future__ import annotations

import json
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from pyembroidery import COLOR_CHANGE, JUMP, STITCH, TRIM, EmbPattern, write_pes


def mm_to_tenths_mm(value: float) -> int:
    return int(round(value * 10))


def normalize_stitches_to_origin(stitches: list[dict]) -> list[dict]:
    positioned = [stitch for stitch in stitches if "x" in stitch and "y" in stitch]
    if not positioned:
        return stitches

    min_x = min(float(stitch["x"]) for stitch in positioned)
    min_y = min(float(stitch["y"]) for stitch in positioned)

    normalized: list[dict] = []
    for stitch in stitches:
      if "x" in stitch and "y" in stitch:
          normalized.append(
              {
                  **stitch,
                  "x": float(stitch["x"]) - min_x,
                  "y": float(stitch["y"]) - min_y,
              }
          )
      else:
          normalized.append(stitch)
    return normalized


def build_pattern(payload: dict) -> EmbPattern:
    pattern = EmbPattern()
    for thread in payload.get("threads", []):
        pattern.add_thread(
            {
                "name": thread.get("name", "thread"),
                "hex": thread.get("hex", "#000000"),
            }
        )

    for stitch in normalize_stitches_to_origin(payload.get("stitches", [])):
        cmd = stitch.get("cmd")
        x = mm_to_tenths_mm(float(stitch.get("x", 0)))
        y = mm_to_tenths_mm(float(stitch.get("y", 0)))
        if cmd == "stitch":
            pattern.add_stitch_absolute(STITCH, x, y)
        elif cmd == "jump":
            pattern.add_stitch_absolute(JUMP, x, y)
        elif cmd == "trim":
            pattern.add_stitch_absolute(TRIM, x, y)
        elif cmd == "color_change":
            pattern.add_command(COLOR_CHANGE)
    return pattern


class PesHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/export/pes":
            self.send_error(404, "Not found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(content_length) or b"{}")
        pattern = build_pattern(payload)

        with tempfile.NamedTemporaryFile(suffix=".pes", delete=False) as handle:
            tmp_path = Path(handle.name)

        write_pes(pattern, str(tmp_path))
        binary = tmp_path.read_bytes()
        tmp_path.unlink(missing_ok=True)

        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", 'attachment; filename="pattern.pes"')
        self.send_header("Content-Length", str(len(binary)))
        self.end_headers()
        self.wfile.write(binary)

    def log_message(self, format: str, *args) -> None:
        return


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), PesHandler)
    print("PES exporter listening on http://localhost:8000")
    server.serve_forever()
