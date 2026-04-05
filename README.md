# Embroidery Digitizer MVP

Minimal embroidery digitizing app that loads SVG regions, assigns fill/satin/run stitch types, previews stitch order on canvas, exports DST natively in TypeScript, and exports PES through a tiny Python service using `pyembroidery`.

## Stack

- Frontend: TypeScript + Vite + Canvas
- Geometry/Stitch engine: modular TypeScript
- PES backend: Python `http.server` + `pyembroidery`

## Run

```bash
npm install
npm run dev
```

In a second terminal:

```bash
python3 -m pip install -r backend/requirements.txt
npm run backend
```

Open the Vite app, load an SVG, assign stitch types, tune spacing/angle/satin width, then export `.dst` or `.pes`.

## Architecture

- `src/svg.ts`: SVG import and normalization to millimeters
- `src/geometry.ts`: reusable geometry helpers
- `src/stitch-generators.ts`: fill, satin, run generators and nearest-neighbor ordering
- `src/renderer.ts`: canvas preview with zoom/pan and stitch indices
- `src/dst.ts`: native DST exporter
- `backend/server.py`: pluggable PES export endpoint

## API Contract

`POST /export/pes`

```json
{
  "stitches": [
    { "x": 0.0, "y": 0.0, "cmd": "stitch", "color": 0 },
    { "cmd": "color_change" }
  ],
  "threads": [
    { "hex": "#f97316", "name": "petal-left-1" }
  ]
}
```

The stitch model remains file-format independent and measured in millimeters.
