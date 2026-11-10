#!/usr/bin/env python3
"""Pack rendered VFX frames into premultiplied-alpha WebP sprite sheets + the vfx.json manifest.

    python3 tools/blender/vfx/pack.py NAME [NAME ...]      # (system python: numpy + Pillow)

Reads $VFX_WORK/NAME/meta.json and the frames the fx_NAME.py Blender script rendered
($VFX_WORK/NAME/[vK/]f_####.png), writes priv/www/assets/vfx/NAME.webp, merges the NAME entry into
priv/www/assets/vfx/vfx.json and drops a contact sheet into $VFX_PREVIEW (default
/mnt/project-files/neon-knuckles-v7/vfx) composited over the game's dark street colour.

meta.json keys (written by vfxlib.render):
  mode       'additive' (opaque black render; alpha := brightest channel) | 'normal' (transparent film)
  cols, rows, frames, variants, fps, loop, size, pivot, billboard   -> manifest
  take       [start, count]      frames of the source range to use (default all)
  xfade      N                   make the take loop seamlessly by cross-fading N extra tail frames
  out        [w, h]              downscale each frame (render supersampled)
  gain       float               multiply colour (and alpha for 'normal')
  smooth     gaussian radius (px) to de-grain motion-blur noise
  edge       fraction of the frame over which the border is faded to 0 (default 0.04)
  quality    WebP quality (default 90)
Sheet pixels are PREMULTIPLIED alpha, sRGB-encoded (load with NoColorSpace / premultiplyAlpha false).
Frame k (0-based, variant v: k = v*frames + f) sits at col k % cols, row k // cols, row 0 = top.
"""
import json, os, sys, glob
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORK = os.environ.get('VFX_WORK', '/tmp/nk_vfx')
OUT = os.path.join(REPO, 'priv', 'www', 'assets', 'vfx')
PREV = os.environ.get('VFX_PREVIEW', '/mnt/project-files/neon-knuckles-v7/vfx')
BG = np.array([0x1c, 0x0b, 0x2e], np.float32) / 255


def load(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255.0
    if a.ndim == 2:
        a = np.dstack([a, a, a, np.ones_like(a)])
    if a.shape[2] == 3:
        a = np.dstack([a, np.ones(a.shape[:2], np.float32)])
    return a


def frames_of(d):
    vs = sorted(glob.glob(os.path.join(d, 'v*')))
    if vs:
        return [sorted(glob.glob(os.path.join(v, 'f_*.png'))) for v in vs]
    return [sorted(glob.glob(os.path.join(d, 'f_*.png')))]


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def grade(lum, gr):
    """toon gradient map: intensity -> colour bands. gr = {'stops': [[pos, '#hex'], ...], 'soft': width}
    Between stops the colour steps (smoothstep over 'soft') -> cel-shaded flame / energy bands."""
    stops = gr['stops']
    soft = gr.get('soft', 0.03)
    out = np.zeros(lum.shape + (3,), np.float32)
    out[:] = hexrgb(stops[0][1])
    for pos, col in stops[1:]:
        t = np.clip((lum - pos + soft) / (2 * soft), 0, 1)
        t = t * t * (3 - 2 * t)
        out = out * (1 - t[..., None]) + hexrgb(col) * t[..., None]
    # fade the lowest band into black so edges stay soft
    lo = gr.get('floor', stops[1][0] if len(stops) > 1 else 0.1)
    k = np.clip(lum / max(lo, 1e-3), 0, 1)
    return out * (k * k)[..., None] if gr.get('fade_floor', True) else out


def prep(fr, meta):
    """frame -> premultiplied RGBA float"""
    mode = meta.get('mode', 'additive')
    g = meta.get('gain', 1.0)
    if mode == 'additive':
        rgb = np.clip(fr[..., :3] * g, 0, 1)
        if meta.get('grade'):
            rgb = grade(rgb.max(axis=2), meta['grade'])
        a = rgb.max(axis=2)
    else:
        a = np.clip(fr[..., 3] * meta.get('alpha_gain', 1.0), 0, 1)
        rgb = np.clip(fr[..., :3] * g, 0, 1)
        if meta.get('grade_normal'):
            lum = rgb @ np.array([0.3, 0.55, 0.15], np.float32)
            rgb = grade(np.clip(lum * meta.get('lum_gain', 1.0), 0, 1), dict(meta['grade_normal'], fade_floor=False))
        if meta.get('alpha_curve'):
            lo, hi = meta['alpha_curve']
            t = np.clip((a - lo) / (hi - lo), 0, 1)
            a = t * t * (3 - 2 * t)
        rgb = rgb * a[..., None]
    out = np.dstack([rgb, a])
    o = meta.get('out')
    if o and (o[0] != out.shape[1] or o[1] != out.shape[0]):
        chans = [Image.fromarray(out[..., c].astype(np.float32), 'F').resize(tuple(o), Image.LANCZOS) for c in range(4)]
        out = np.clip(np.dstack([np.asarray(c) for c in chans]), 0, 1)
    if meta.get('smooth'):            # light de-grain of motion-blur sampling noise
        r = meta['smooth']
        k = np.exp(-0.5 * (np.arange(-3, 4) / r) ** 2)
        k /= k.sum()
        for ax in (0, 1):
            out = sum(np.roll(out, i - 3, axis=ax) * k[i] for i in range(7))
    e = meta.get('edge', 0.04)
    if e > 0:
        h, w = out.shape[:2]
        yy = np.linspace(0, 1, h)[:, None]
        xx = np.linspace(0, 1, w)[None, :]
        ex = np.clip(np.minimum(xx, 1 - xx) / e, 0, 1)
        ey = np.clip(np.minimum(yy, 1 - yy) / e, 0, 1)
        m = (ex * ey)
        m = m * m * (3 - 2 * m)
        out = out * m[..., None]
    return out


def sequence(files, meta):
    take = meta.get('take')
    xf = meta.get('xfade', 0)
    s0, n = (take if take else (0, len(files) - xf))
    raw = [prep(load(f), meta) for f in files]
    seq = raw[s0:s0 + n]
    for i in range(xf):
        w = (i + 0.5) / xf
        seq[i] = raw[s0 + n + i] * (1 - w) + seq[i] * w
    return seq


def pack(name):
    d = os.path.join(WORK, name)
    meta = json.load(open(os.path.join(d, 'meta.json')))
    groups = [sequence(fs, meta) for fs in frames_of(d)]
    frames = len(groups[0])
    allf = [f for g in groups for f in g]
    fh, fw = allf[0].shape[:2]
    cols = meta.get('cols') or int(np.ceil(np.sqrt(len(allf))))
    rows = meta.get('rows') or int(np.ceil(len(allf) / cols))
    sheet = np.zeros((rows * fh, cols * fw, 4), np.float32)
    for k, f in enumerate(allf):
        r, c = divmod(k, cols)
        sheet[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = f
    os.makedirs(OUT, exist_ok=True)
    img = Image.fromarray((np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    fn = f'{name}.webp'
    img.save(os.path.join(OUT, fn), 'WEBP', quality=meta.get('quality', 90), alpha_quality=100, method=6, exact=True)
    # manifest
    mf = os.path.join(OUT, 'vfx.json')
    man = json.load(open(mf)) if os.path.exists(mf) else {}
    man.setdefault('_format', {
        'alpha': 'premultiplied', 'colorSpace': 'sRGB (sample raw, composite in display space)',
        'layout': 'frame k = variant*frames + f at col k%cols, row floor(k/cols), row 0 = top of image',
        'generator': 'tools/blender/vfx (Blender 4.0 Mantaflow / particles / Cycles) + pack.py'})
    ent = {'file': fn, 'cols': cols, 'rows': rows, 'frames': frames, 'variants': len(groups),
           'fps': meta.get('fps', 24), 'blending': meta.get('blending', meta.get('mode', 'additive')),
           'loop': bool(meta.get('loop', False)), 'size': meta.get('size', 100),
           'aspect': round(fw / fh, 4), 'pivot': meta.get('pivot', [0.5, 0.5]),
           'billboard': meta.get('billboard', True)}
    for k in ('use', 'hold'):
        if k in meta:
            ent[k] = meta[k]
    man[name] = ent
    with open(mf, 'w') as f:
        json.dump(dict(sorted(man.items())), f, indent=1, ensure_ascii=False)
    # preview: contact sheet over the street colour
    os.makedirs(PREV, exist_ok=True)
    rgb, a = sheet[..., :3], sheet[..., 3:4]
    if ent['blending'] == 'additive':
        comp = BG + rgb
    else:
        comp = BG * (1 - a) + rgb
    Image.fromarray((np.clip(comp, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(PREV, f'{name}.png'))
    kb = os.path.getsize(os.path.join(OUT, fn)) / 1024
    print(f'packed {name}: {len(allf)} frames {fw}x{fh} -> {cols}x{rows} sheet {img.size[0]}x{img.size[1]}  {kb:.0f} KB')
    return kb


if __name__ == '__main__':
    for n in sys.argv[1:]:
        pack(n)
