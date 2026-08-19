#!/usr/bin/env python3
"""Derive the full icon set from build/icon-source.png.

No third-party dependencies: the PNG is decoded and re-encoded with zlib, and
resampled with a separable triangle filter. Alpha is premultiplied before
resampling and divided out afterwards, which is what stops semi-transparent
edges from picking up a dark or white halo.

Run with:  npm run icons
"""

import os
import struct
import sys
import zlib

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(OUT_DIR, "icon-source.png")
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
TRAY_SIZE = 32


# --------------------------------------------------------------- PNG decode

def read_png(path):
    """Decode an 8-bit RGB/RGBA PNG into (width, height, RGBA bytearray)."""
    with open(path, "rb") as handle:
        data = handle.read()

    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path}: not a PNG")

    pos = 8
    width = height = None
    channels = 0
    idat = bytearray()

    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length

        if tag == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", body
            )
            if depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise SystemExit(
                    f"{path}: need a non-interlaced 8-bit RGB or RGBA PNG "
                    f"(got depth={depth}, colour type={color_type}, "
                    f"interlace={interlace})"
                )
            channels = 3 if color_type == 2 else 4
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break

    if width is None:
        raise SystemExit(f"{path}: no IHDR chunk")

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(width * height * 4)
    previous = bytearray(stride)

    offset = 0
    for y in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        unfilter(filter_type, line, previous, channels)

        base = y * width * 4
        if channels == 4:
            out[base:base + stride] = line
        else:
            for x in range(width):
                out[base + x * 4 + 0] = line[x * 3 + 0]
                out[base + x * 4 + 1] = line[x * 3 + 1]
                out[base + x * 4 + 2] = line[x * 3 + 2]
                out[base + x * 4 + 3] = 255
        previous = line

    return width, height, out


def unfilter(filter_type, line, previous, bpp):
    """Reverse one PNG scanline filter, in place."""
    if filter_type == 0:
        return
    if filter_type == 1:
        for i in range(bpp, len(line)):
            line[i] = (line[i] + line[i - bpp]) & 0xFF
    elif filter_type == 2:
        for i in range(len(line)):
            line[i] = (line[i] + previous[i]) & 0xFF
    elif filter_type == 3:
        for i in range(len(line)):
            left = line[i - bpp] if i >= bpp else 0
            line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
    elif filter_type == 4:
        for i in range(len(line)):
            left = line[i - bpp] if i >= bpp else 0
            up = previous[i]
            up_left = previous[i - bpp] if i >= bpp else 0
            line[i] = (line[i] + paeth(left, up, up_left)) & 0xFF
    else:
        raise SystemExit(f"unsupported PNG filter type {filter_type}")


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


# ------------------------------------------------------------- resampling

def filter_weights(src_len, dst_len):
    """Triangle-filter weights per destination index, as (start, [w, ...])."""
    scale = dst_len / src_len
    support = 1.0 if scale >= 1.0 else 1.0 / scale
    rows = []
    for i in range(dst_len):
        centre = (i + 0.5) / scale
        first = max(int(centre - support + 0.5), 0)
        last = min(int(centre + support + 0.5), src_len - 1)
        weights = []
        total = 0.0
        for j in range(first, last + 1):
            distance = abs((j + 0.5) - centre) / support
            weight = 1.0 - distance
            if weight <= 0.0:
                weight = 0.0
            weights.append(weight)
            total += weight
        if total <= 0.0:
            weights = [1.0]
            first = min(max(int(centre), 0), src_len - 1)
            total = 1.0
        rows.append((first, [w / total for w in weights]))
    return rows


def resize(width, height, pixels, size):
    """Resample RGBA `pixels` to size x size, premultiplying alpha first."""
    # Premultiply so colour and alpha stay consistent through the filter.
    premultiplied = [0.0] * (width * height * 4)
    for i in range(width * height):
        alpha = pixels[i * 4 + 3] / 255.0
        premultiplied[i * 4 + 0] = pixels[i * 4 + 0] * alpha
        premultiplied[i * 4 + 1] = pixels[i * 4 + 1] * alpha
        premultiplied[i * 4 + 2] = pixels[i * 4 + 2] * alpha
        premultiplied[i * 4 + 3] = pixels[i * 4 + 3]

    # Horizontal pass.
    columns = filter_weights(width, size)
    horizontal = [0.0] * (size * height * 4)
    for y in range(height):
        row = y * width * 4
        out_row = y * size * 4
        for x, (first, weights) in enumerate(columns):
            r = g = b = a = 0.0
            for k, weight in enumerate(weights):
                p = row + (first + k) * 4
                r += premultiplied[p] * weight
                g += premultiplied[p + 1] * weight
                b += premultiplied[p + 2] * weight
                a += premultiplied[p + 3] * weight
            o = out_row + x * 4
            horizontal[o], horizontal[o + 1] = r, g
            horizontal[o + 2], horizontal[o + 3] = b, a

    # Vertical pass, then un-premultiply back to straight alpha.
    rows = filter_weights(height, size)
    out = bytearray(size * size * 4)
    for y, (first, weights) in enumerate(rows):
        for x in range(size):
            r = g = b = a = 0.0
            for k, weight in enumerate(weights):
                p = ((first + k) * size + x) * 4
                r += horizontal[p] * weight
                g += horizontal[p + 1] * weight
                b += horizontal[p + 2] * weight
                a += horizontal[p + 3] * weight
            o = (y * size + x) * 4
            alpha = min(max(a, 0.0), 255.0)
            if alpha > 0.0:
                scale = 255.0 / alpha
                out[o] = clamp(r * scale)
                out[o + 1] = clamp(g * scale)
                out[o + 2] = clamp(b * scale)
            out[o + 3] = int(alpha + 0.5)
    return out


def clamp(value):
    return 0 if value < 0 else (255 if value > 255 else int(value + 0.5))


# --------------------------------------------------------------- PNG encode

def write_png(path, size, pixels):
    stride = size * 4
    raw = b"".join(
        b"\x00" + bytes(pixels[y * stride:(y + 1) * stride]) for y in range(size)
    )

    def chunk(tag, body):
        payload = tag + body
        return (
            struct.pack(">I", len(body))
            + payload
            + struct.pack(">I", zlib.crc32(payload))
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


# --------------------------------------------------------------------- main

def main():
    if not os.path.exists(SOURCE):
        raise SystemExit(f"missing {SOURCE}")

    width, height, pixels = read_png(SOURCE)
    print(f"source: {os.path.basename(SOURCE)} {width}x{height}")
    if width != height:
        print("  warning: source is not square; output will be distorted")

    icons_dir = os.path.join(OUT_DIR, "icons")
    # build/ is electron-builder's buildResources and is not copied into the
    # packaged app, so runtime icons are written under src/ as well.
    assets_dir = os.path.join(os.path.dirname(OUT_DIR), "src", "assets")
    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)

    for size in SIZES:
        scaled = resize(width, height, pixels, size)
        write_png(os.path.join(icons_dir, f"{size}x{size}.png"), size, scaled)
        if size == max(SIZES):
            write_png(os.path.join(OUT_DIR, "icon.png"), size, scaled)
            write_png(os.path.join(assets_dir, "icon.png"), size, scaled)
        if size == TRAY_SIZE:
            write_png(os.path.join(assets_dir, "tray.png"), size, scaled)
        print(f"  {size}x{size}")
        sys.stdout.flush()

    print("icons written to build/icons/, build/icon.png, src/assets/")


if __name__ == "__main__":
    main()
