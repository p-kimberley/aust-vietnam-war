"""Builds the vintage style from the ww2 base package.

Usage: python build.py <base style-local.json> <out dir>
Writes <out>/style-local.json (TileServer GL placeholders, the deliverable) and <out>/style.json (placeholders resolved to
the dev tile server plus a local sprite URL, for previewing).

Palette: a 1960s military topographic sheet, tuned so the site's contact colours (khaki -> yellow -> orange -> red)
stand out over it. Paper, ink, brass and contact red come from the design tokens in web/src/styles.scss.
"""
import copy
import json
import sys

base_path, out_dir = sys.argv[1], sys.argv[2]
base = json.load(open(base_path, encoding="utf-8"))
by_id = {layer["id"]: layer for layer in base["layers"]}

# ---- palette ---------------------------------------------------------------------------------------------------
PAPER = "#e9dfbc"        # the sheet
PAPER_LIGHT = "#f1e9cc"  # halos, fills that should read lighter than the sheet
INK = "#2b261b"
INK_SOFT = "#4d4230"
WATER = "#a6c4cc"
WATER_LINE = "#88aab6"
WATER_TEXT = "#3c6577"
FOREST = "#bcc78d"
SCRUB = "#cfd3a0"
GRASS = "#dadeae"
FARM = "#e5dfae"
WETLAND = "#c3d4b3"
SAND = "#ecdcab"
BUILT = "#d9c49b"
BUILDING = "#c8b285"
BUILDING_LINE = "#a89468"
CONTOUR = "#a7794a"
CONTOUR_INDEX = "#875c33"
ROAD_MAJOR = "#a9503b"      # trunk and primary: the red of the period's road sheets
ROAD_MAJOR_CASE = "#5e3122"
ROAD_MID = "#cf9a55"        # secondary and tertiary
ROAD_MID_CASE = "#735535"
ROAD_MINOR = "#7d6a4f"
RAIL = "#4a4136"
BOUNDARY = "#8a4a3a"
PROVINCE = "#8a5a3c"

# Names are "<family> <style>", as TileServer GL derives them from the font files (see ../fonts). Each stack ends with a
# Noto Sans face that is already on the server, so scripts these fonts do not cover (Khmer on the Cambodian side of the
# map, for example) still draw.
SERIF = ["Noto Serif Regular", "Noto Sans Regular"]
SERIF_BOLD = ["Noto Serif Bold", "Noto Sans Bold"]
SERIF_ITALIC = ["Noto Serif Italic", "Noto Sans Italic"]
MONO = ["IBM Plex Mono Regular", "Noto Sans Regular"]
MONO_BOLD = ["IBM Plex Mono Bold", "Noto Sans Bold"]
MONO_ITALIC = ["IBM Plex Mono Italic", "Noto Sans Italic"]
STENCIL = ["Saira Stencil One Regular", "Noto Sans Bold"]

# Which face each label layer uses: serifs for names, a typewriter face for roads and contours (the period's sheets
# were typeset, and a slab mono reads as such), and a stencil for provinces and countries.
FONT_BY_LAYER = {
    "water_name": SERIF_ITALIC,
    "contour_label": MONO_ITALIC,
    "highway_name_other": MONO,
    "highway_name_motorway": MONO_BOLD,
    "place_other": SERIF_ITALIC,
    "place_suburb": SERIF_ITALIC,
    "place_village": SERIF,
    "place_town": SERIF,
    "place_city": SERIF_BOLD,
    "place_city_large": SERIF_BOLD,
    "place_state": STENCIL,
    "place_country_other": STENCIL,
    "place_country_minor": STENCIL,
    "place_country_major": STENCIL,
}


def stops(*pairs, base_=None):
    out = {"stops": [list(p) for p in pairs]}
    if base_ is not None:
        out["base"] = base_
    return out


def clone(layer_id, **changes):
    """A copy of a base layer with paint/layout merged and other keys replaced."""
    layer = copy.deepcopy(by_id[layer_id])
    for key in ("paint", "layout"):
        if key in changes:
            merged = layer.get(key, {})
            merged.update(changes.pop(key))
            layer[key] = merged
    layer.update(changes)
    return layer


def new(layer_id, type_, **rest):
    return {"id": layer_id, "type": type_, **rest}


SRC = "openmaptiles"
HALO = {"text-halo-color": PAPER_LIGHT, "text-halo-width": 1.3, "text-halo-blur": 0.4}
layers = []

# ---- ground -----------------------------------------------------------------------------------------------------
layers.append(new("background", "background", paint={"background-color": PAPER}))

layers.append(clone("landcover_ice_shelf", paint={"fill-color": "#f4f0df", "fill-opacity": 0.8}))
layers.append(clone("landcover_glacier", paint={"fill-color": "#f4f0df", "fill-opacity": stops((0, 1), (8, 0.6))}))
layers.append(new("landcover_sand", "fill", source=SRC, **{"source-layer": "landcover"},
                  filter=["all", ["==", "$type", "Polygon"], ["==", "class", "sand"]],
                  paint={"fill-color": SAND, "fill-opacity": 0.9}))
layers.append(new("landcover_farmland", "fill", source=SRC, **{"source-layer": "landcover"},
                  filter=["all", ["==", "$type", "Polygon"], ["==", "class", "farmland"]],
                  paint={"fill-color": FARM, "fill-opacity": stops((6, 0.5), (10, 0.9))}))
layers.append(new("landcover_grass", "fill", source=SRC, **{"source-layer": "landcover"},
                  filter=["all", ["==", "$type", "Polygon"], ["==", "class", "grass"]],
                  paint={"fill-color": GRASS, "fill-opacity": stops((6, 0.5), (10, 0.9))}))
layers.append(new("landcover_wetland", "fill", source=SRC, **{"source-layer": "landcover"},
                  filter=["all", ["==", "$type", "Polygon"], ["==", "class", "wetland"]],
                  paint={"fill-color": WETLAND, "fill-opacity": 0.85}))
layers.append(new("landcover_wood", "fill", source=SRC, **{"source-layer": "landcover"},
                  filter=["all", ["==", "$type", "Polygon"], ["==", "class", "wood"]],
                  paint={"fill-color": FOREST, "fill-opacity": stops((5, 0.55), (9, 0.85), (13, 0.7))}))
layers.append(clone("landuse_residential", maxzoom=24, paint={"fill-color": BUILT, "fill-opacity": stops((6, 0.55), (12, 0.75))}))
layers.append(clone("landuse_park", paint={"fill-color": SCRUB, "fill-opacity": 0.9}))

# ---- relief ----------------------------------------------------------------------------------------------------
layers.append(new("hillshading", "raster", source="hillshading",
                  paint={"raster-opacity": stops((5, 0), (7, 0.2), (12, 0.34), (15, 0.2)),
                         "raster-contrast": 0.1, "raster-fade-duration": 300}))

# ---- water ------------------------------------------------------------------------------------------------------
layers.append(clone("water", paint={"fill-antialias": True, "fill-color": WATER}))
layers.append(clone("waterway", paint={
    "line-color": WATER_LINE,
    "line-width": stops((8, 0.4), (12, 0.9), (14, 1.6), (18, 5), base_=1.4),
}))

# ---- contours (1:50,000 sheets are dominated by them) ----------------------------------------------------------
layers.append(new("contour", "line", source="contours", **{"source-layer": "contour"}, minzoom=11,
                  filter=["all", ["!in", "nth_line", 10, 5], [">", "height", 0]],
                  layout={"line-join": "round"},
                  paint={"line-color": CONTOUR, "line-opacity": stops((11, 0.25), (14, 0.6)),
                         "line-width": stops((11, 0.3), (15, 0.7))}))
layers.append(new("contour_index", "line", source="contours", **{"source-layer": "contour"}, minzoom=10,
                  filter=["all", [">", "height", 0], ["in", "nth_line", 10, 5]],
                  layout={"line-join": "round"},
                  paint={"line-color": CONTOUR_INDEX, "line-opacity": stops((10, 0.3), (14, 0.75)),
                         "line-width": stops((10, 0.4), (15, 1.15))}))

# ---- buildings and airfields ----------------------------------------------------------------------------------
layers.append(clone("building", paint={"fill-color": BUILDING, "fill-outline-color": BUILDING_LINE}))
layers.append(clone("aeroway-area", paint={"fill-color": "#cbbd98", "fill-opacity": 1}))
layers.append(clone("aeroway-taxiway", paint={"line-color": "#a99b7e"}))
layers.append(clone("aeroway-runway-casing", paint={"line-color": "#6f6350"}))
layers.append(clone("aeroway-runway", paint={"line-color": "#b7ab8f"}))
layers.append(clone("road_area_pier", paint={"fill-color": "#b9ab8a"}))
layers.append(clone("road_pier", paint={"line-color": "#b9ab8a"}))

# ---- roads: a hierarchy of colour and width, as on the period's sheets ------------------------------------------
layers.append(clone("highway_path", paint={"line-color": INK_SOFT, "line-opacity": 0.7,
                                             "line-dasharray": [2, 2],
                                             "line-width": stops((13, 0.5), (17, 1.4), (20, 5))}))
layers.append(clone("highway_minor", filter=["all", ["==", "$type", "LineString"], ["in", "class", "minor", "service", "track", "tertiary"]], paint={"line-color": ROAD_MINOR, "line-opacity": 0.95,
                                              "line-width": stops((8, 0.3), (12, 0.7), (14, 1.3), (17, 4), (20, 14), base_=1.4)}))

mid = ["all", ["==", "$type", "LineString"], ["==", "class", "secondary"]]
major = ["all", ["==", "$type", "LineString"], ["in", "class", "primary", "trunk"]]
layers.append(clone("highway_major_casing", id="highway_mid_casing", filter=mid, minzoom=10,
                    paint={"line-color": ROAD_MID_CASE, "line-opacity": 0.85,
                           "line-width": stops((10, 1.6), (12, 2.2), (14, 3), (20, 20), base_=1.3)}))
layers.append(clone("highway_major_inner", id="highway_mid_inner", filter=mid, minzoom=10,
                    paint={"line-color": ROAD_MID, "line-width": stops((10, 0.8), (12, 1.2), (14, 1.9), (20, 16), base_=1.3)}))
layers.append(clone("highway_major_casing", id="highway_major_casing", filter=major, minzoom=9,
                    paint={"line-color": ROAD_MAJOR_CASE, "line-opacity": 0.9,
                           "line-width": stops((9, 1.6), (12, 2.8), (14, 3.8), (20, 24), base_=1.3)}))
layers.append(clone("highway_major_inner", id="highway_major_inner", filter=major, minzoom=9,
                    paint={"line-color": ROAD_MAJOR, "line-width": stops((9, 0.9), (12, 1.6), (14, 2.4), (20, 19), base_=1.3)}))
layers.append(clone("highway_major_subtle", minzoom=5, maxzoom=9,
                    filter=["all", ["==", "$type", "LineString"], ["in", "class", "trunk", "primary"]],
                    paint={"line-color": ROAD_MAJOR, "line-opacity": 0.75,
                           "line-width": stops((5, 0.4), (7, 0.8), (9, 1.2))}))
layers.append(clone("highway_motorway_casing", paint={"line-color": ROAD_MAJOR_CASE, "line-opacity": 0.9}))
layers.append(clone("highway_motorway_inner", paint={"line-color": "#9c3b2b"}))
layers.append(clone("highway_motorway_subtle", paint={"line-color": "#9c3b2b"}))
layers.append(clone("road_oneway", paint={"icon-opacity": 0.35}))
layers.append(clone("road_oneway_opposite", paint={"icon-opacity": 0.35}))

# railways: black line with paper ticks
for rid in ("railway_transit", "railway_minor", "railway"):
    layers.append(clone(rid, paint={"line-color": RAIL}))
for rid in ("railway_transit_dashline", "railway_minor_dashline", "railway_dashline"):
    layers.append(clone(rid, paint={"line-color": PAPER_LIGHT}))

# ---- boundaries -------------------------------------------------------------------------------------------------
layers.append(clone("boundary_state", paint={"line-color": PROVINCE, "line-opacity": 0.8, "line-blur": 0,
                                             "line-dasharray": [4, 2.5], "line-width": stops((4, 0.6), (10, 1.2), (14, 2))}))
for bid in ("boundary_country_z0-4", "boundary_country_z5-"):
    layers.append(clone(bid, paint={"line-color": BOUNDARY, "line-opacity": 0.9, "line-blur": 0,
                                    "line-dasharray": [5, 2, 1, 2], "line-width": stops((3, 0.8), (10, 1.6), (14, 2.4))}))

# ---- labels ----------------------------------------------------------------------------------------------------
NAME = "{name:latin}\n{name:nonlatin}"
layers.append(clone("water_name", layout={"text-size": 12, "text-letter-spacing": 0.08},
                    paint={"text-color": WATER_TEXT, "text-halo-color": WATER, "text-halo-width": 1.2}))
layers.append(new("contour_label", "symbol", source="contours", **{"source-layer": "contour"}, minzoom=13,
                  filter=["all", ["==", "$type", "LineString"], ["in", "nth_line", 10, 5], [">", "height", 0]],
                  layout={"symbol-placement": "line", "text-field": "{height}",
                          "text-size": stops((13, 8.5), (17, 11)), "text-padding": 10, "text-rotation-alignment": "map",
                          "symbol-avoid-edges": True},
                  paint={"text-color": CONTOUR_INDEX, **HALO}))
layers.append(clone("highway_name_other", layout={"text-size": 9.5, "text-letter-spacing": 0.1},
                    paint={"text-color": INK_SOFT, **HALO}))
layers.append(clone("highway_name_motorway", layout={"text-size": 10},
                    paint={"text-color": ROAD_MAJOR_CASE, **HALO}))

place_common = {"text-color": INK, **HALO}
layers.append(clone("place_other", layout={"text-size": 9.5, "text-letter-spacing": 0.06, "text-transform": "none"},
                    paint={"text-color": INK_SOFT, **HALO}))
layers.append(clone("place_suburb", layout={"text-size": 10, "text-letter-spacing": 0.06, "text-transform": "none"},
                    paint={"text-color": INK_SOFT, **HALO}))
layers.append(clone("place_village", layout={"text-size": stops((8, 9), (13, 11)), "text-letter-spacing": 0.08},
                    paint={"icon-opacity": 0.85, **place_common}))
layers.append(clone("place_town", layout={"text-size": stops((8, 10), (13, 12.5)), "text-letter-spacing": 0.14},
                    paint={"icon-opacity": 0.9, **place_common}))
layers.append(clone("place_city", layout={"text-size": stops((6, 11), (12, 15)), "text-letter-spacing": 0.14},
                    paint={"icon-opacity": 0.9, **place_common}))
layers.append(clone("place_city_large", layout={"text-size": stops((4, 12), (10, 18)), "text-letter-spacing": 0.16},
                    paint={"icon-opacity": 0.95, **place_common}))
layers.append(clone("place_state", layout={"text-size": 11, "text-letter-spacing": 0.3},
                    paint={"text-color": PROVINCE, **HALO}))
for cid in ("place_country_other", "place_country_minor", "place_country_major"):
    layers.append(clone(cid, layout={"text-letter-spacing": 0.24},
                        paint={"text-color": BOUNDARY, "text-halo-color": PAPER_LIGHT, "text-halo-width": 1.6}))

for layer in layers:
    if layer["id"] in FONT_BY_LAYER:
        layer["layout"]["text-font"] = FONT_BY_LAYER[layer["id"]]
unassigned = [l["id"] for l in layers if l["type"] == "symbol" and "text-font" in l.get("layout", {}) and l["id"] not in FONT_BY_LAYER]
assert not unassigned, unassigned

# every layer that was in the base must still be here, unless it was deliberately replaced
kept = {layer["id"] for layer in layers}
replaced = {"highway_major_casing", "highway_major_inner"}  # split into mid/major by class, ids reused for the major class
missing = [i for i in by_id if i not in kept and i not in replaced]
assert not missing, missing
assert len(kept) == len(layers), "duplicate layer ids"

style = {
    "version": 8,
    "name": "Vintage",
    "metadata": {"mapbox:autocomposite": False, "mapbox:type": "template",
                 "description": "A 1960s military topographic sheet: paper, contour brown, red road classes, forest and water tints."},
    "sources": {
        SRC: {"type": "vector", "url": "mbtiles://{v3}"},
        "hillshading": {"type": "raster", "url": "mbtiles://{hillshading}", "tileSize": 256},
        "contours": {"type": "vector", "url": "mbtiles://{contours}"},
    },
    "sprite": "{styleJsonFolder}/sprite",
    "glyphs": "{fontstack}/{range}.pbf",
    "layers": layers,
}

import os
os.makedirs(out_dir, exist_ok=True)
json.dump(style, open(os.path.join(out_dir, "style-local.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)

# preview variant: resolve placeholders against the dev tile server, sprite from the local preview server
T = "https://tiles.hosting.gradata.com.au"
preview = copy.deepcopy(style)
preview["sources"][SRC]["url"] = f"{T}/data/v3.json"
preview["sources"]["hillshading"]["url"] = f"{T}/data/hillshading.json"
preview["sources"]["contours"]["url"] = f"{T}/data/contours.json"
# The generated glyphs are served by the preview server next to the style, and stacks are cut to their first face because
# that server does not merge stacks the way TileServer GL does.
preview["glyphs"] = "http://localhost:5190/fonts/{fontstack}/{range}.pbf"
for layer in preview["layers"]:
    if "text-font" in layer.get("layout", {}):
        layer["layout"]["text-font"] = layer["layout"]["text-font"][:1]
preview["sprite"] = "http://localhost:5190/sprite"
json.dump(preview, open(os.path.join(out_dir, "style.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(len(layers), "layers")
