"""Gate helper: proves palette tokens and the favicon against the real source pixels.
Prints one JSON object. Run with: python -I scripts/verify_assets.py
"""
import json, os, re
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {'palette': [], 'favicon': {}}

tokens = json.load(open(os.path.join(ROOT, 'src', 'tokens.json'), encoding='utf8'))
for name, t in tokens['colors'].items():
    im = Image.open(os.path.join(ROOT, t['file'])).convert('RGB')
    px = im.getpixel((t['x'], t['y']))
    got = '#%02x%02x%02x' % px
    out['palette'].append({'name': name, 'hex': t['hex'], 'pixel': got, 'ok': got == t['hex'].lower()})

# favicon: rasterise the svg polygons back onto the source grid and compare with the alpha mask
src = Image.open(os.path.join(ROOT, 'brand', 'LOGO IGNOPAD PNG...png')).convert('RGBA')
a = np.array(src)[..., 3] >= 128
ys, xs = np.where(a)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
w, h = x1 - x0 + 1, y1 - y0 + 1
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
side = max(w, h) * 1.45
fs = 32.0 / side
svg = open(os.path.join(ROOT, 'dist', 'favicon.svg'), encoding='utf8').read()
d = re.search(r' d="([^"]+)"', svg).group(1)
canvas = Image.new('L', a.shape[::-1], 0)
dr = ImageDraw.Draw(canvas)
for sub in [s for s in d.split('Z') if s.strip()]:
    nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', sub)]
    pts = [((nums[i] / fs) + cx - side / 2, (nums[i + 1] / fs) + cy - side / 2) for i in range(0, len(nums), 2)]
    dr.polygon(pts, fill=255)
m = np.array(canvas) > 0
inter = np.logical_and(m, a).sum(); union = np.logical_or(m, a).sum()
out['favicon'] = {'iou': float(inter) / float(union), 'subpaths': len([s for s in d.split('Z') if s.strip()])}
print(json.dumps(out))
