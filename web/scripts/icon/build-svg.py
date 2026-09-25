"""
Draws the site icon: the outline of Vietnam with a poppy over Phuoc Tuy province, where the Australian Task Force was based at
Nui Dat. Writes public/icon.svg (the full icon) and scripts/icon/small.svg (bolder, for 16 to 48 pixels).

    python web/scripts/icon/build-svg.py

The border is Natural Earth's 1:50m country outline (public domain), kept here as vietnam-ne50m.json; only the mainland is drawn.
"""

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parents[1]

# The site's palette (styles.css).
OLIVE_900 = '#1f2314'
OLIVE_700 = '#353d22'
KHAKI = '#e6ddb8'
BRASS = '#c99a3b'
POPPY = '#c23a26'
POPPY_DARK = '#8f2818'
INK = '#15170e'

NUI_DAT = (107.19, 10.62)  # lon, lat


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker: drops points that lie within `tolerance` of the line through their neighbours."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1e-9
    far, at = 0.0, 0
    for i, (x, y) in enumerate(points[1:-1], 1):
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length
        if d > far:
            far, at = d, i
    if far <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: at + 1], tolerance)[:-1] + simplify(points[at:], tolerance)


def outline(size: float, margin: float, tolerance: float, shift_x: float):
    """The mainland, projected (longitude scaled for the latitude) and fitted into the icon, and where Nui Dat falls on it."""
    geometry = json.loads((HERE / 'vietnam-ne50m.json').read_text())
    rings = [p[0] for p in geometry['coordinates']]
    ring = max(rings, key=len)
    k = math.cos(math.radians(16))
    xs = [lon * k for lon, _ in ring]
    ys = [-lat for _, lat in ring]
    scale = (size - 2 * margin) / (max(ys) - min(ys))
    width = (max(xs) - min(xs)) * scale
    left = (size - width) / 2 + shift_x
    to_icon = lambda lon, lat: (left + (lon * k - min(xs)) * scale, margin + (-lat - min(ys)) * scale)
    projected = [to_icon(lon, lat) for lon, lat in ring]
    # A ring ends where it starts, which leaves the line to measure from with no length: split it at the point farthest from the
    # start and simplify the two halves.
    far = max(range(len(projected)), key=lambda i: math.dist(projected[0], projected[i]))
    points = simplify(projected[: far + 1], tolerance)[:-1] + simplify(projected[far:], tolerance)
    path = 'M' + ' '.join(f'{x:.2f} {y:.2f}' for x, y in points) + 'Z'
    return path, to_icon(*NUI_DAT)


def poppy(cx: float, cy: float, r: float) -> str:
    """Four overlapping petals, the two behind a shade darker, round a black centre: the remembrance poppy, flat."""
    o = r * 0.42
    back = ''.join(f'<circle cx="{cx + dx:.2f}" cy="{cy + dy:.2f}" r="{r * 0.62:.2f}"/>' for dx, dy in ((-o, -o), (o, o)))
    front = ''.join(f'<circle cx="{cx + dx:.2f}" cy="{cy + dy:.2f}" r="{r * 0.62:.2f}"/>' for dx, dy in ((o, -o), (-o, o)))
    return (
        f'<g fill="{POPPY_DARK}">{back}</g>'
        f'<g fill="{POPPY}">{front}</g>'
        f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r * 0.26:.2f}" fill="{INK}"/>'
    )


def icon(size: float, margin: float, tolerance: float, stroke: float, poppy_r: float, shift_x: float, poppy_dx: float, frame: bool) -> str:
    path, (px, py) = outline(size, margin, tolerance, shift_x)
    # The poppy sits on Nui Dat, a little out over the coast so the Mekong Delta still shows, and in from the edge of the tile.
    px += poppy_dx
    px = min(px, size - poppy_r - 3)
    py = min(py, size - poppy_r - 3)
    border = f'<rect x="2.5" y="2.5" width="{size - 5}" height="{size - 5}" rx="10" fill="none" stroke="{BRASS}" stroke-width="2"/>' if frame else ''
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size:g} {size:g}">\n'
        f"  <!-- Australia's Vietnam War: Vietnam, with a poppy over Phuoc Tuy (Nui Dat). Made by web/scripts/icon/build-svg.py. -->\n"
        f'  <rect width="{size:g}" height="{size:g}" rx="12" fill="{OLIVE_900}"/>\n'
        f'  {border}\n'
        f'  <path d="{path}" fill="{OLIVE_700}" stroke="{KHAKI}" stroke-width="{stroke}" stroke-linejoin="round"/>\n'
        f'  {poppy(px, py, poppy_r)}\n'
        f'</svg>\n'
    )


if __name__ == '__main__':
    (WEB / 'public' / 'icon.svg').write_text(icon(64, 7, 0.2, 1.1, 6.5, -4, 5, True))
    (HERE / 'small.svg').write_text(icon(64, 3, 0.8, 2.6, 12.5, -6, 4, False))
    print('public/icon.svg, scripts/icon/small.svg')
