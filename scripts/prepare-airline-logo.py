"""Trace a cropped raster airline mark into the local catalogue's SVG format."""

import argparse
from html import escape
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree import ElementTree

from PIL import Image, ImageColor
import vtracer


def prepare(source, output, name, crop, white_background, colors=()):
    with Image.open(source) as original:
        mark = original.convert("RGBA")
    if crop:
        mark = mark.crop(crop)
    if white_background:
        pixels = [(r, g, b, 0 if min(r, g, b) >= 245 else a) for r, g, b, a in mark.get_flattened_data()]
        mark.putdata(pixels)
    if not mark.getbbox():
        raise ValueError("No visible mark in the selected area")

    mark = mark.crop(mark.getbbox())
    trace_scale = 192 / max(mark.size)
    mark = mark.resize(tuple(max(1, round(size * trace_scale)) for size in mark.size), Image.Resampling.LANCZOS)
    mark.putalpha(mark.getchannel("A").point(lambda value: 255 if value >= 112 else 0))
    bounds = mark.getbbox()
    if not bounds:
        raise ValueError("No opaque artwork to trace")
    mark = mark.crop(bounds)
    if colors:
        palette = [ImageColor.getrgb(color) for color in colors]

        def snap(r, g, b, alpha):
            if not alpha:
                return 0, 0, 0, 0
            nearest = min(palette, key=lambda color: (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2)
            return (*nearest, alpha)

        mark.putdata([snap(*pixel) for pixel in mark.get_flattened_data()])
    with TemporaryDirectory() as folder:
        raster = Path(folder) / "mark.png"
        vector = Path(folder) / "mark.svg"
        mark.save(raster)
        vtracer.convert_image_to_svg_py(
            str(raster), str(vector), colormode="color", hierarchical="stacked", mode="spline",
            filter_speckle=12, color_precision=6 if colors else 4, layer_difference=45, path_precision=2,
        )
        paths = []
        for path in ElementTree.parse(vector).getroot():
            path.tag = path.tag.rsplit("}", 1)[-1]
            paths.append(ElementTree.tostring(path, encoding="unicode", short_empty_elements=True).strip())
        if not paths:
            raise ValueError("No vector paths traced from the selected area")

    width, height = mark.size
    scale = 24 / max(width, height)
    x, y = (24 - width * scale) / 2, (24 - height * scale) / 2
    output.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img"><title>{escape(name)}</title>'
        f'<g transform="translate({x:.3f} {y:.3f}) scale({scale:.6f})">{"".join(paths)}</g></svg>\n',
        encoding="utf-8",
        newline="\n",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--crop", type=int, nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"))
    parser.add_argument("--white-background", action="store_true")
    parser.add_argument("--colors", nargs="+", default=(), metavar="HEX")
    args = parser.parse_args()
    prepare(args.source, args.output, args.name, args.crop, args.white_background, args.colors)


if __name__ == "__main__":
    main()
