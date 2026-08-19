#!/usr/bin/env python3
"""Render the app icon set. No third-party dependencies — shapes are defined as
signed distance fields, supersampled for anti-aliasing, and written as PNG with
nothing but zlib and struct.

Run with:  npm run icons
"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
SAMPLES = 3  # per axis, so 9 samples per pixel

# Two overlapping speech bubbles: deliberately a generic chat mark rather than
# an imitation of the WhatsApp logo, which is a registered trademark.
BG_TOP = (0x2D, 0xE8, 0x76)
BG_BOTTOM = (0x0E, 0x8C, 0x6E)


def rounded_rect(px, py, cx, cy, half_w, half_h, radius):
    """Signed distance to a rounded rectangle. Negative means inside."""
    dx = abs(px - cx) - (half_w - radius)
    dy = abs(py - cy) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def circle(px, py, cx, cy, radius):
    return math.hypot(px - cx, py - cy) - radius


def triangle(px, py, a, b, c):
    """Signed-ish distance to a triangle: negative inside, positive outside."""
    def edge(p, q):
        return (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0])

    d1, d2, d3 = edge(a, b), edge(b, c), edge(c, a)
    has_neg = min(d1, d2, d3) < 0
    has_pos = max(d1, d2, d3) > 0
    return -1.0 if not (has_neg and has_pos) else 1.0


def over(dst, src, alpha):
    """Composite src over dst with the given alpha."""
    return tuple(int(round(s * alpha + d * (1 - alpha))) for s, d in zip(src, dst))


def coverage(distance, scale):
    """Convert a signed distance into 0..1 coverage across roughly one pixel."""
    return max(0.0, min(1.0, 0.5 - distance * scale))


def sample(u, v):
    """Colour and alpha at normalised coordinates (0..1). Returns (rgb, alpha)."""
    # Background plate.
    d_bg = rounded_rect(u, v, 0.5, 0.5, 0.5, 0.5, 0.225)
    a_bg = coverage(d_bg, 64.0)
    if a_bg <= 0.0:
        return (0, 0, 0), 0.0

    rgb = tuple(
        int(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * v)) for i in range(3)
    )

    # Back bubble — the "second account".
    d_back = rounded_rect(u, v, 0.605, 0.395, 0.215, 0.170, 0.085)
    a_back = coverage(d_back, 64.0)
    if a_back > 0.0:
        rgb = over(rgb, (0xFF, 0xFF, 0xFF), a_back * 0.42)

    # Front bubble body plus its tail.
    d_front = rounded_rect(u, v, 0.430, 0.545, 0.245, 0.195, 0.095)
    a_front = coverage(d_front, 64.0)
    tail = triangle(u, v, (0.245, 0.665), (0.400, 0.700), (0.250, 0.845))
    a_tail = coverage(tail, 64.0)
    a_shape = max(a_front, a_tail)
    if a_shape > 0.0:
        rgb = over(rgb, (0xFF, 0xFF, 0xFF), a_shape)

        # Three dots, only once the bubble is actually opaque under them.
        for dot_x in (0.330, 0.430, 0.530):
            d_dot = circle(u, v, dot_x, 0.545, 0.032)
            a_dot = coverage(d_dot, 64.0) * a_shape
            if a_dot > 0.0:
                rgb = over(rgb, (0x11, 0x8C, 0x6E), a_dot)

    return rgb, a_bg


def render(size):
    rows = []
    step = 1.0 / (size * SAMPLES)
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc_r = acc_g = acc_b = acc_a = 0.0
            for sy in range(SAMPLES):
                v = (y + (sy + 0.5) / SAMPLES) / size
                for sx in range(SAMPLES):
                    u = (x + (sx + 0.5) / SAMPLES) / size
                    (r, g, b), a = sample(u, v)
                    acc_r += r * a
                    acc_g += g * a
                    acc_b += b * a
                    acc_a += a
            n = SAMPLES * SAMPLES
            alpha = acc_a / n
            if alpha > 0:
                row += bytes(
                    (
                        int(round(acc_r / acc_a)),
                        int(round(acc_g / acc_a)),
                        int(round(acc_b / acc_a)),
                        int(round(alpha * 255)),
                    )
                )
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    icons_dir = os.path.join(OUT_DIR, "icons")
    # electron-builder treats build/ as buildResources and does NOT copy it into
    # the packaged app, so anything needed at runtime is written under src/.
    assets_dir = os.path.join(os.path.dirname(OUT_DIR), "src", "assets")
    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)

    for size in SIZES:
        rows = render(size)
        write_png(os.path.join(icons_dir, f"{size}x{size}.png"), size, rows)
        if size == 512:
            write_png(os.path.join(OUT_DIR, "icon.png"), size, rows)
            write_png(os.path.join(assets_dir, "icon.png"), size, rows)
        if size == 32:
            write_png(os.path.join(assets_dir, "tray.png"), size, rows)
        print(f"  {size}x{size}")

    print("icons written to build/icons/, build/icon.png, src/assets/")


if __name__ == "__main__":
    main()
