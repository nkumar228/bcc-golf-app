"""Builds gps/greens-dem.json: a 1-metre ground-elevation grid around each green, for the GPS tab's slope map.

Source: USGS 3DEP 1 m lidar DEM (free, public domain). For Avon Fields that is the Ohio statewide lidar,
flown 2020-2023. Run again whenever a green's middle spot is moved:

    python3 tools/green_slopes.py greens.json      # greens.json = {"1": [[lat,lon] front, [lat,lon] middle, [lat,lon] back], ...}

Needs network access to elevation.nationalmap.gov, plus numpy and pillow.
"""
import io, json, math, sys, time, urllib.request
import numpy as np
from PIL import Image

R = 25  # metres each side of the green's middle spot -> a 51 x 51 grid
SVC = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

def merc(lat, lon):
    return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137

def grid(lat, lon):
    x, y = merc(lat, lon)
    h = (R + 0.5) / math.cos(lat * math.pi / 180)  # ground metres -> web-mercator metres
    n = 2 * R + 1
    url = (f"{SVC}?bbox={x-h},{y-h},{x+h},{y+h}&bboxSR=3857&imageSR=3857&size={n},{n}"
           "&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image")
    for attempt in range(8):
        try:
            data = urllib.request.urlopen(url, timeout=90).read()
            a = np.array(Image.open(io.BytesIO(data)), dtype=np.float64)
            if a.shape == (n, n) and np.isfinite(a).all() and a.min() > -1000:
                return a
        except Exception as e:  # the service sometimes answers 502; try again
            print("  retry:", e)
        time.sleep(3 * (attempt + 1))
    raise SystemExit(f"no elevation for {lat},{lon}")

def main(path):
    greens = json.load(open(path))
    out = {"source": "USGS 3DEP 1 m lidar DEM (Ohio statewide lidar 2020-2023)", "spacing_m": 1, "half_m": R,
           "built": time.strftime("%Y-%m-%d"), "holes": {}}
    try:  # keep greens already built whose middle spot hasn't moved (the service is slow and sometimes fails)
        old = json.load(open("gps/greens-dem.json"))["holes"]
    except (OSError, ValueError, KeyError):
        old = {}
    for hole in sorted(greens, key=int):
        f, m, b = greens[hole]
        if hole in old and old[hole]["c"] == m:
            out["holes"][hole] = old[hole]
            continue
        print("hole", hole)
        a = grid(*m)
        base = float(a.min())
        out["holes"][hole] = {"c": m, "base_m": round(base, 2),
                              "z": [int(round((v - base) * 100)) for v in a.ravel()]}  # centimetres above base, row 0 = north
        json.dump(out, open("gps/greens-dem.json", "w"), separators=(",", ":"))  # save as we go
    json.dump(out, open("gps/greens-dem.json", "w"), separators=(",", ":"))
    print("wrote gps/greens-dem.json")

if __name__ == "__main__":
    main(sys.argv[1])
