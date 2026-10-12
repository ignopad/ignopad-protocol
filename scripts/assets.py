"""One-off asset pass. Reads brand/ and reference/, writes src/assets/*.
Run: python scripts/assets.py   (needs Pillow, numpy, scikit-image)
"""
import json, os, sys
import numpy as np
from PIL import Image
from skimage import measure

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, 'brand'); R = os.path.join(ROOT, 'reference'); O = os.path.join(ROOT, 'src', 'assets')
os.makedirs(O, exist_ok=True)

alpha_png = Image.open(os.path.join(B, 'LOGO IGNOPAD PNG...png')).convert('RGBA')
a = np.array(alpha_png)
print('transparent px RGB uniques:', np.unique(a[a[..., 3] == 0][:, :3], axis=0).tolist())  # [[0,0,0]] -> premultiply

def premul_resize(im, size):
    """Resize in premultiplied space so pure-black transparent texels cannot bleed into edges."""
    arr = np.array(im.convert('RGBA')).astype(np.float64) / 255.0
    arr[..., :3] *= arr[..., 3:4]
    pm = Image.fromarray((arr * 255).round().astype(np.uint8), 'RGBA')
    ch = [pm.getchannel(i).resize(size, Image.LANCZOS) for i in range(4)]
    out = np.stack([np.array(c) for c in ch], -1).astype(np.float64) / 255.0
    al = out[..., 3:4]
    rgb = np.where(al > 0, out[..., :3] / np.maximum(al, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), al], -1)
    return Image.fromarray((out * 255).round().astype(np.uint8), 'RGBA')

# ---- trace the mark from the alpha channel (real pixel grid) ----
mask = (a[..., 3] >= 128).astype(np.uint8)
ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print('mark bbox', x0, y0, x1, y1)
cs = measure.find_contours(np.pad(mask, 1), 0.5)
polys = []
for c in cs:
    if len(c) < 40: continue
    p = measure.approximate_polygon(c, tolerance=2.2)[:-1]
    polys.append([(float(q[1]) - 1, float(q[0]) - 1) for q in p])
print('contours', len(polys), [len(p) for p in polys])

def path(polys, tx, ty, s):
    d = ''
    for p in polys:
        d += 'M' + ' '.join('%.2f %.2f' % ((x - tx) * s, (y - ty) * s) for x, y in p) + 'Z'
    return d

# tight mark for inline use
w, h = x1 - x0 + 1, y1 - y0 + 1
s = 100.0 / w
json.dump({'viewBox': '0 0 100 %.2f' % (h * s), 'd': path(polys, x0, y0, s)}, open(os.path.join(O, 'mark.json'), 'w'))

# favicon: 32x32 crop centred on the mark
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
side = max(w, h) * 1.45
fs = 32.0 / side
d = path(polys, cx - side / 2, cy - side / 2, fs)
open(os.path.join(O, 'favicon.svg.tpl'), 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
    '<rect width="32" height="32" rx="6" fill="{{bg}}"/><path fill="{{fg}}" fill-rule="evenodd" d="%s"/></svg>' % d)

# ---- raster outputs (premultiplied resize) ----
sq = int(side)
crop = alpha_png.crop((int(cx - sq / 2), int(cy - sq / 2), int(cx - sq / 2) + sq, int(cy - sq / 2) + sq))
mk = premul_resize(crop, (180, 180))
bg = Image.new('RGBA', (180, 180), (26, 26, 26, 255))   # snapped: brand JPG (0,0)
bg.alpha_composite(mk)
bg.convert('RGB').save(os.path.join(O, 'apple-touch-icon.png'), optimize=True)

ban = Image.open(os.path.join(R, 'SAMPUL IGNOPAD JPG.jpg.jpeg')).convert('RGB')
og = Image.new('RGB', (1200, 630), ban.getpixel((0, 0)))  # snapped paper at banner (0,0)
bw = ban.resize((1200, 400), Image.LANCZOS)
og.paste(bw, (0, 115))
og.save(os.path.join(O, 'og.jpg'), quality=88, optimize=True)
print('ok')
