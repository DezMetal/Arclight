"""Generate the Arclight application icon set.

Draws the mark from scratch in the DSS visual language: a chamfered slab
(the `--dss-cut-size` clip-path silhouette) carrying a glowing arc, rendered
at high resolution and downsampled so the small sizes stay crisp.

Usage:
    python tools/generate_icons.py

Writes into src-tauri/icons/:
    32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# --- DSS palette -----------------------------------------------------------
BACKDROP = (10, 12, 16, 255)          # --dss-bg
ACCENT = (127, 233, 255, 255)         # --dss-accent-ink, bright enough for a taskbar
ACCENT_HOT = (190, 250, 255, 255)     # near-white core so the arc survives downsampling
BORDER = (139, 148, 158, 110)         # --dss-color-border-primary

# Supersample factor. The mark is drawn this many times larger than the
# biggest export, then reduced with LANCZOS, which keeps the thin arc and the
# chamfer edges from aliasing at 32px.
SS = 4
CANVAS = 256 * SS

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
PNG_EXPORTS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}


def chamfered_slab(size: int, cut: int) -> list[tuple[int, int]]:
    """The DSS clip-path silhouette: top-left and bottom-right corners cut."""
    return [
        (0, cut),
        (cut, 0),
        (size, 0),
        (size, size - cut),
        (size - cut, size),
        (0, size),
    ]


def draw_glow(layer: Image.Image, draw_fn, passes: list[tuple[int, int, int]]) -> None:
    """Composite a glow by drawing progressively wider, fainter, blurrier copies."""
    for width, alpha, blur in passes:
        scratch = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(scratch), width, alpha)
        if blur:
            scratch = scratch.filter(ImageFilter.GaussianBlur(blur))
        layer.alpha_composite(scratch)


def build_mark() -> Image.Image:
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    inset = 10 * SS
    body = CANVAS - inset * 2
    cut = int(body * 0.20)

    # --- slab body ---------------------------------------------------------
    slab = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    poly = [(x + inset, y + inset) for x, y in chamfered_slab(body, cut)]
    ImageDraw.Draw(slab).polygon(poly, fill=BACKDROP)
    img.alpha_composite(slab)

    # --- outer edge glow ---------------------------------------------------
    def edge(d: ImageDraw.ImageDraw, width: int, alpha: int) -> None:
        d.line(poly + [poly[0]], fill=ACCENT[:3] + (alpha,), width=width, joint="curve")

    draw_glow(
        img,
        edge,
        [
            (int(9 * SS), 40, int(9 * SS)),
            (int(5 * SS), 70, int(4 * SS)),
            (int(1.6 * SS), 235, 0),
        ],
    )

    # --- the arc -----------------------------------------------------------
    # An arc light: a struck electrical arc between two electrodes. Drawn as a
    # broken ring, open at the lower right where the chamfer cuts in.
    cx = cy = CANVAS // 2
    radius = int(body * 0.29)
    box = (cx - radius, cy - radius, cx + radius, cy + radius)
    start, end = 143, 42  # degrees, wrapping through the top

    def arc(d: ImageDraw.ImageDraw, width: int, alpha: int) -> None:
        d.arc(box, start=start, end=end, fill=ACCENT[:3] + (alpha,), width=width)

    draw_glow(
        img,
        arc,
        [
            (int(20 * SS), 80, int(11 * SS)),
            (int(13 * SS), 140, int(5 * SS)),
            (int(8 * SS), 255, 0),
        ],
    )

    # Hot core along the arc, slightly thinner and in the base cyan.
    def arc_core(d: ImageDraw.ImageDraw, width: int, alpha: int) -> None:
        d.arc(box, start=start, end=end, fill=ACCENT_HOT[:3] + (alpha,), width=width)

    draw_glow(img, arc_core, [(int(3.4 * SS), 255, 0)])

    # --- electrode terminals ----------------------------------------------
    # Two dots capping the arc, where the discharge strikes. Angles follow
    # PIL's convention (clockwise from 3 o'clock, y increasing downward) so
    # they land exactly on the arc's endpoints.
    for deg in (start, end):
        rad = math.radians(deg)
        px = cx + radius * math.cos(rad)
        py = cy + radius * math.sin(rad)
        r = 7.5 * SS

        def terminal(d: ImageDraw.ImageDraw, width: int, alpha: int, _p=(px, py), _r=r) -> None:
            d.ellipse(
                (_p[0] - _r, _p[1] - _r, _p[0] + _r, _p[1] + _r),
                fill=ACCENT_HOT[:3] + (alpha,),
            )

        draw_glow(img, terminal, [(0, 70, int(7 * SS)), (0, 255, 0)])

    # --- interior hairline -------------------------------------------------
    # A faint inner border echoing DSS's 1.4px module edge.
    inner_inset = inset + int(7 * SS)
    inner_body = CANVAS - inner_inset * 2
    inner_cut = int(inner_body * 0.20)
    inner_poly = [(x + inner_inset, y + inner_inset) for x, y in chamfered_slab(inner_body, inner_cut)]
    hair = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(hair).line(
        inner_poly + [inner_poly[0]], fill=BORDER, width=max(1, int(0.9 * SS)), joint="curve"
    )
    img.alpha_composite(hair)

    return img


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    mark = build_mark()

    for name, size in PNG_EXPORTS.items():
        mark.resize((size, size), Image.LANCZOS).save(out_dir / name)
        print(f"  {name:<16} {size}x{size}")

    ico_frames = [mark.resize((s, s), Image.LANCZOS) for s in ICO_SIZES]
    ico_frames[-1].save(
        out_dir / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico_frames[:-1],
    )
    print(f"  {'icon.ico':<16} {', '.join(f'{s}x{s}' for s in ICO_SIZES)}")
    print(f"\nWrote {len(PNG_EXPORTS) + 1} files to {out_dir}")


if __name__ == "__main__":
    main()
