"""Neon Knuckles scene atlas — pure Python (no numpy / PIL needed).

Paints two 1024x1024 PNGs used by every scene kit:
  atlas.png    base colour (RGBA; alpha only matters for the chain-link fence)
  atlas_e.png  emissive (RGB; black = not glowing)
plus a tileable asphalt texture (asphalt.png, 256x256).

Layout
  * top 8 rows: 16px flat colour swatches (SWATCHES).  A face that uses a swatch
    has all of its UVs on the swatch centre, so mip-mapping never bleeds.
  * below: texture regions (REGIONS) packed into shelves with a 4px gutter.
Everything is seeded, so the output is byte-for-byte deterministic.
"""
import math, os, random, struct, zlib

SIZE = 1024
CELL = 16
GUT = 4

# ---------------------------------------------------------------- swatches
# name: (base colour, emissive colour or None)
SWATCHES = {
    # neutral / dark
    'black': ('#0c0a12', None), 'dark': ('#1a1724', None), 'dark2': ('#24202f', None),
    'steel': ('#5a5f70', None), 'steel_lt': ('#8a90a2', None), 'steel_dk': ('#383b48', None),
    'alu': ('#a9aebb', None), 'white': ('#e6e4ee', None), 'offwhite': ('#c8c2b8', None),
    'rubber': ('#18161c', None), 'chrome': ('#c4ccd8', None),
    'concrete': ('#8a8794', None), 'concrete_lt': ('#a6a3ae', None), 'concrete_dk': ('#5e5b68', None),
    'curb': ('#7a7290', None), 'curb_top': ('#908aa6', None), 'asphalt': ('#2a2630', None), 'gutter': ('#1c1922', None),
    # downtown walls / trims
    'd_wall1': ('#4a3466', None), 'd_wall2': ('#3c2c5a', None), 'd_wall3': ('#5a3a5e', None), 'd_wall4': ('#2f3a5c', None),
    'd_wall5': ('#6a4a52', None), 'd_wall6': ('#3a4a5a', None),
    'd_trim1': ('#6c5490', None), 'd_trim2': ('#7a5a7e', None), 'd_trim3': ('#4e5c82', None), 'd_trim4': ('#8a6a6a', None),
    'd_side': ('#2a2040', None), 'd_roof': ('#3a3448', None), 'd_brick': ('#7a4a4a', None),
    # docks
    'k_wall1': ('#3a5262', None), 'k_wall2': ('#4a6270', None), 'k_wall3': ('#2e4654', None), 'k_wall4': ('#5a6a70', None),
    'k_trim': ('#6a8290', None), 'k_roof': ('#2c3a44', None), 'k_quay': ('#6a6e74', None), 'k_quay_edge': ('#8a8c90', None),
    'tire': ('#141418', None), 'rope': ('#b8a070', None),
    'ct_red': ('#a8402e', None), 'ct_blue': ('#2e5c9a', None), 'ct_yellow': ('#c49a2a', None), 'ct_green': ('#3a7a58', None),
    'ct_white': ('#b8b8b0', None), 'ct_orange': ('#c86a2a', None),
    'crane_yel': ('#d0a020', None), 'crane_red': ('#b03a2a', None),
    # factory
    'f_wall1': ('#5a3c34', None), 'f_wall2': ('#4a3430', None), 'f_wall3': ('#6a4a3a', None), 'f_conc': ('#6e665e', None),
    'f_trim': ('#7a5644', None), 'f_roof': ('#3a2e2a', None), 'rust': ('#8a4a2a', None), 'rust_dk': ('#5a2e1c', None),
    'pipe_grey': ('#6a6a70', None), 'pipe_red': ('#9a3a2e', None), 'pipe_green': ('#4a6a4a', None), 'pipe_yel': ('#b89a3a', None),
    'tank': ('#9a968e', None), 'tank_dk': ('#6a665e', None),
    'hazard_y': ('#e0b028', None),
    # street props
    'hydrant': ('#c8202e', None), 'cone': ('#f06a1a', None), 'cone_band': ('#e8e8e8', None),
    'dumpster_g': ('#2f6b4a', None), 'dumpster_b': ('#2e4f8a', None), 'bin': ('#3a4a5a', None),
    'card': ('#a07a4a', None), 'card_dk': ('#7a5a36', None), 'tape': ('#c8b080', None),
    'wood': ('#8a6440', None), 'wood_dk': ('#5a3e28', None),
    'vend_red': ('#c0283a', None), 'vend_blue': ('#2a5cc0', None), 'vend_white': ('#d8dce8', None),
    'booth_red': ('#a82838', None), 'booth_frame': ('#2a2a36', None),
    'bench': ('#7a5034', None), 'barrier_w': ('#e0e0e8', None), 'barrier_r': ('#c8303a', None),
    'aw_red': ('#b02a3a', None), 'aw_teal': ('#1f7a80', None), 'aw_purple': ('#6a2a8a', None), 'aw_navy': ('#24305a', None),
    'ac': ('#b4b6be', None), 'ac_dk': ('#7a7c86', None),
    'tank_wood': ('#7a5236', None), 'band': ('#3a3036', None),
    'sign_back': ('#14101e', None), 'sign_box': ('#2a2238', None),
    'paint': ('#d8d0e4', None), 'paint_y': ('#d0a43a', None),
    'water_dk': ('#0a1420', None),
    'leaf': ('#2f7a5a', None), 'leaf_dk': ('#1f5240', None), 'leaf_lt': ('#4a9a6a', None), 'soil': ('#3a2a22', None),
    'drum_b': ('#2a4a8a', None), 'drum_r': ('#a8342a', None), 'drum_y': ('#c8a030', None),
    'flag_pink': ('#c03a9a', None), 'flag_cyan': ('#2a9ab0', None),
    # emissive
    'lamp_warm': ('#ffe2b0', '#ffd8a0'), 'lamp_cool': ('#d8f6ff', '#bff4ff'), 'lamp_amber': ('#ffc070', '#ffb060'),
    'neon_pink': ('#ff4ad8', '#ff2bd6'), 'neon_cyan': ('#4af6ff', '#22f3ff'), 'neon_yel': ('#ffe86a', '#ffe45c'),
    'neon_orange': ('#ff7a3a', '#ff5a1a'), 'neon_purple': ('#b07aff', '#9d5cff'), 'neon_green': ('#6aff9a', '#4dff9a'),
    'neon_red': ('#ff4a5a', '#ff2a4a'),
    'led_red': ('#ff3a3a', '#ff2020'), 'led_green': ('#5aff7a', '#30ff60'), 'led_blue': ('#5ab4ff', '#3a9aff'),
    'screen': ('#7adcff', '#5ac8ff'), 'furnace': ('#ff8a2a', '#ff6a10'), 'warn_lamp': ('#ffb020', '#ff9a10'),
    'glass_dk': ('#1a2236', None), 'glass_lit': ('#ffd88a', '#c89a50'),
}

# ---------------------------------------------------------------- tiny PNG io

def write_png(path, w, h, buf, channels):
    raw = bytearray()
    stride = w * channels
    for y in range(h):
        raw.append(0)
        raw += buf[y * stride:(y + 1) * stride]
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ctype = 6 if channels == 4 else 2
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def hexrgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def mix(a, b, t):
    return [int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)]


def scale(c, k):
    return [max(0, min(255, int(round(v * k)))) for v in c]


class Canvas:
    def __init__(self, w, h, ch, fill=(0, 0, 0, 255)):
        self.w, self.h, self.ch = w, h, ch
        self.buf = bytearray(bytes(fill[:ch]) * (w * h))

    def px(self, x, y, c, a=1.0):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = (y * self.w + x) * self.ch
        if a >= 1.0:
            self.buf[i:i + 3] = bytes(c[:3])
            if self.ch == 4:
                self.buf[i + 3] = c[3] if len(c) > 3 else 255
        else:
            for k in range(3):
                self.buf[i + k] = int(self.buf[i + k] * (1 - a) + c[k] * a)

    def mul(self, x, y, w, h, k):
        for yy in range(int(y), int(y + h)):
            i0 = (yy * self.w + int(x)) * self.ch
            for i in range(i0, i0 + int(w) * self.ch, self.ch):
                for c in range(3):
                    self.buf[i + c] = min(255, int(self.buf[i + c] * k))

    def get(self, x, y):
        i = (y * self.w + x) * self.ch
        return list(self.buf[i:i + 3])

    def rect(self, x, y, w, h, c, a=1.0):
        x0, y0, x1, y1 = max(0, int(x)), max(0, int(y)), min(self.w, int(x + w)), min(self.h, int(y + h))
        if x1 <= x0 or y1 <= y0:
            return
        if a >= 1.0:
            cc = list(c[:3]) + ([c[3] if len(c) > 3 else 255] if self.ch == 4 else [])
            row = bytes(cc) * (x1 - x0)
            for yy in range(y0, y1):
                i = (yy * self.w + x0) * self.ch
                self.buf[i:i + len(row)] = row
        else:
            for yy in range(y0, y1):
                for xx in range(x0, x1):
                    self.px(xx, yy, c, a)

    def vgrad(self, x, y, w, h, c0, c1):
        for k in range(int(h)):
            self.rect(x, y + k, w, 1, mix(c0, c1, k / max(1, h - 1)))

    def hgrad(self, x, y, w, h, c0, c1):
        for k in range(int(w)):
            self.rect(x + k, y, 1, h, mix(c0, c1, k / max(1, w - 1)))

    def disc(self, cx, cy, r, c, a=1.0):
        for yy in range(int(cy - r - 1), int(cy + r + 2)):
            for xx in range(int(cx - r - 1), int(cx + r + 2)):
                d = math.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
                if d <= r:
                    self.px(xx, yy, c, a * min(1.0, r - d + 0.5))

    def ring(self, cx, cy, r0, r1, c, a=1.0):
        for yy in range(int(cy - r1 - 1), int(cy + r1 + 2)):
            for xx in range(int(cx - r1 - 1), int(cx + r1 + 2)):
                d = math.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
                if r0 <= d <= r1:
                    self.px(xx, yy, c, a)

    def speckle(self, x, y, w, h, n, rng, lo, hi, a=1.0):
        for _ in range(n):
            xx = x + int(rng.random() * w)
            yy = y + int(rng.random() * h)
            base = self.get(xx, yy)
            self.px(xx, yy, scale(base, rng.uniform(lo, hi)), a)

    def line(self, x0, y0, x1, y1, c, a=1.0, wid=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for k in range(n + 1):
            t = k / max(1, n)
            xx, yy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            for dx in range(wid):
                self.px(int(xx) + dx, int(yy), c, a)


# ---------------------------------------------------------------- region painters
# each painter(B, E, x, y, w, h, rng) paints base canvas B and emissive canvas E

def p_window(kind, col):
    col = hexrgb(col)

    def f(B, E, x, y, w, h, r):
        if kind == 'dark':
            B.vgrad(x, y, w, h, [26, 34, 58], [14, 16, 30])
            for t in range(h):
                xx = x + int(w * 0.25 + t * 0.6)
                B.rect(xx, y + t, 6, 1, [70, 80, 120], 0.5)
                B.rect(xx + 10, y + t, 3, 1, [60, 70, 110], 0.35)
            if col != [0, 0, 0]:   # faint neon reflection
                B.rect(x, y + h * 0.6, w, h * 0.4, col, 0.18)
                E.rect(x, y + h * 0.6, w, h * 0.4, scale(col, 0.12))
            return
        # lit room
        wall = mix(col, [255, 255, 255], 0.25)
        B.vgrad(x, y, w, h, mix(wall, [255, 255, 255], 0.35), scale(wall, 0.6))
        E.vgrad(x, y, w, h, scale(wall, 0.75), scale(wall, 0.35))
        if kind == 'curtain':
            cc = [r.randint(90, 200), r.randint(40, 120), r.randint(60, 160)]
            for side in (0, 1):
                cw = int(w * r.uniform(0.18, 0.3))
                cx = x if side == 0 else x + w - cw
                B.rect(cx, y, cw, h, cc)
                E.rect(cx, y, cw, h, scale(cc, 0.25))
                for k in range(0, cw, 4):
                    B.rect(cx + k, y, 1, h, scale(cc, 0.7))
        elif kind == 'blinds':
            drop = int(h * r.uniform(0.3, 0.8))
            for k in range(0, drop, 4):
                B.rect(x, y + k, w, 3, mix(wall, [255, 255, 255], 0.4))
                B.rect(x, y + k + 3, w, 1, scale(wall, 0.5))
                E.rect(x, y + k + 3, w, 1, scale(wall, 0.2))
        elif kind == 'plant':
            pc = [40, 90, 60]
            B.rect(x + w * 0.6, y + h * 0.78, w * 0.2, h * 0.22, [120, 70, 50])
            for k in range(7):
                B.disc(x + w * 0.7 + r.uniform(-8, 8), y + h * 0.62 + r.uniform(-12, 6), r.uniform(4, 8), pc)
                E.disc(x + w * 0.7 + r.uniform(-8, 8), y + h * 0.62 + r.uniform(-12, 6), r.uniform(4, 8), [10, 20, 14])
        elif kind == 'person':
            sc = [30, 20, 40]
            px_ = x + w * r.uniform(0.3, 0.6)
            B.disc(px_, y + h * 0.42, 6, sc); E.disc(px_, y + h * 0.42, 6, [8, 6, 10])
            B.rect(px_ - 9, y + h * 0.52, 18, h * 0.5, sc); E.rect(px_ - 9, y + h * 0.52, 18, h * 0.5, [8, 6, 10])
        elif kind == 'tv':
            tv = [90, 220, 255]
            B.rect(x, y, w, h, [30, 50, 90], 0.6); E.rect(x, y, w, h, [0, 0, 0], 0.5)
            B.rect(x + w * 0.2, y + h * 0.45, w * 0.5, h * 0.32, tv); E.rect(x + w * 0.2, y + h * 0.45, w * 0.5, h * 0.32, scale(tv, 0.9))
            E.rect(x, y, w, h, scale(tv, 0.25), 0.5)
        # ceiling lamp
        B.rect(x + w * 0.4, y, w * 0.2, 3, [255, 250, 230]); E.rect(x + w * 0.4, y, w * 0.2, 3, [255, 240, 210])
        B.speckle(x, y, w, h, 60, r, 0.9, 1.05)
    return f


def p_shop(kind):
    dim = {'mart': (0.72, 0.5), 'laundry': (0.72, 0.5), 'ramen': (0.9, 0.75), 'arcade': (1.0, 0.85)}[kind]

    def f(B, E, x, y, w, h, r):
        g(B, E, x, y, w, h, r)
        B.mul(x, y, w, h, dim[0])
        E.mul(x, y, w, h, dim[1])

    def g(B, E, x, y, w, h, r):
        if kind == 'mart':
            B.vgrad(x, y, w, h, [235, 245, 255], [170, 190, 210]); E.vgrad(x, y, w, h, [210, 225, 240], [110, 125, 140])
            for sy in range(int(h * 0.22), h - 10, 22):        # shelves with goods
                B.rect(x + 6, y + sy + 16, w - 12, 3, [90, 100, 120]); E.rect(x + 6, y + sy + 16, w - 12, 3, [30, 34, 40])
                xx = x + 8
                while xx < x + w - 14:
                    gw = r.randint(5, 10)
                    gc = [r.randint(60, 255), r.randint(60, 255), r.randint(60, 255)]
                    gh = r.randint(8, 15)
                    B.rect(xx, y + sy + 16 - gh, gw, gh, gc); E.rect(xx, y + sy + 16 - gh, gw, gh, scale(gc, 0.55))
                    xx += gw + 2
            for lx in range(x + 10, x + w - 20, 48):
                B.rect(lx, y + 2, 30, 4, [255, 255, 255]); E.rect(lx, y + 2, 30, 4, [255, 255, 255])
        elif kind == 'ramen':
            B.vgrad(x, y, w, h, [255, 200, 130], [150, 80, 50]); E.vgrad(x, y, w, h, [230, 160, 90], [90, 40, 20])
            B.rect(x, y + h * 0.62, w, h * 0.38, [90, 50, 34]); E.rect(x, y + h * 0.62, w, h * 0.38, [26, 12, 8])
            B.rect(x, y + h * 0.6, w, 4, [200, 140, 90]); E.rect(x, y + h * 0.6, w, 4, [90, 60, 30])
            for lx in range(x + 20, x + w - 10, 44):          # paper lanterns
                B.disc(lx, y + 22, 9, [255, 90, 60]); E.disc(lx, y + 22, 9, [255, 80, 40])
                B.rect(lx - 9, y + 21, 18, 1, [140, 40, 30])
            for sx in range(x + 14, x + w - 10, 30):           # stools
                B.rect(sx, y + h * 0.75, 12, 4, [200, 60, 50]); B.rect(sx + 5, y + h * 0.75, 2, h * 0.25, [60, 40, 40])
            for sx in range(x + 10, x + w - 20, 36):           # bowls on counter
                B.rect(sx, y + h * 0.55, 14, 5, [240, 240, 230]); E.rect(sx, y + h * 0.55, 14, 5, [120, 110, 100])
        elif kind == 'arcade':
            B.vgrad(x, y, w, h, [60, 20, 90], [20, 8, 40]); E.vgrad(x, y, w, h, [40, 10, 60], [10, 4, 20])
            for ax in range(x + 6, x + w - 30, 40):            # cabinets
                cc = [[255, 60, 200], [60, 240, 255], [255, 220, 80], [140, 90, 255]][(ax // 40) % 4]
                B.rect(ax, y + h * 0.18, 30, h * 0.82, [24, 18, 40])
                B.rect(ax + 4, y + h * 0.28, 22, 18, cc); E.rect(ax + 4, y + h * 0.28, 22, 18, cc)
                B.rect(ax, y + h * 0.18, 30, 6, cc); E.rect(ax, y + h * 0.18, 30, 6, scale(cc, 0.8))
                B.rect(ax + 4, y + h * 0.58, 22, 4, [80, 80, 100])
            for k in range(30):
                cx, cy = x + r.random() * w, y + r.random() * h * 0.2
                c = [[255, 60, 200], [60, 240, 255]][k % 2]
                B.disc(cx, cy, 1.5, c); E.disc(cx, cy, 1.5, c)
        elif kind == 'laundry':
            B.vgrad(x, y, w, h, [200, 240, 230], [120, 160, 160]); E.vgrad(x, y, w, h, [150, 190, 180], [60, 90, 90])
            for ax in range(x + 6, x + w - 30, 36):
                B.rect(ax, y + h * 0.4, 32, h * 0.6, [230, 232, 236]); E.rect(ax, y + h * 0.4, 32, h * 0.6, [90, 92, 96])
                B.disc(ax + 16, y + h * 0.66, 10, [60, 80, 110]); B.disc(ax + 16, y + h * 0.66, 7, [120, 170, 220])
                E.disc(ax + 16, y + h * 0.66, 7, [40, 70, 110])
    return f


def p_shutter(gcol):
    def f(B, E, x, y, w, h, r):
        B.vgrad(x, y, w, h, [150, 150, 165], [100, 100, 115])
        for k in range(0, h, 5):
            B.rect(x, y + k, w, 1, [180, 180, 195]); B.rect(x, y + k + 3, w, 2, [80, 80, 95])
        if gcol is None:
            B.speckle(x, y, w, h, 300, r, 0.8, 1.1)
            B.rect(x, y + h - 8, w, 8, [60, 60, 70])
            return
        g = hexrgb(gcol)
        # abstract graffiti: blobby loops
        cx, cy = x + w * 0.5, y + h * 0.55
        for k in range(16):
            a = k / 16 * math.pi * 2
            B.disc(cx + math.cos(a) * w * 0.28 + r.uniform(-4, 4), cy + math.sin(a * 2) * h * 0.18, r.uniform(3, 6), scale(g, 0.75), 0.55)
        for k in range(10):
            B.disc(x + w * 0.2 + k * w * 0.06, y + h * 0.3 + math.sin(k) * 6, 2.5, [200, 200, 210], 0.45)
        B.speckle(x, y, w, h, 400, r, 0.75, 1.1)
        B.rect(x, y + h - 8, w, 8, [60, 60, 70])
    return f


def p_awning(c0, c1):
    a, b = hexrgb(c0), hexrgb(c1)

    def f(B, E, x, y, w, h, r):
        for k in range(0, w, 16):
            B.rect(x + k, y, 8, h, a); B.rect(x + k + 8, y, 8, h, b)
        for k in range(h):
            B.rect(x, y + k, w, 1, [0, 0, 0], 0.35 * (k / h))
    return f


def p_vend(kind):
    def f(B, E, x, y, w, h, r):
        body = [200, 40, 58] if kind == 'red' else [40, 90, 200]
        B.rect(x, y, w, h, body)
        win = (x + 5, y + 6, w - 22, int(h * 0.58))
        B.rect(*win, [220, 240, 255]); E.rect(*win, [170, 200, 230])
        for row in range(5):
            for col in range(5):
                cc = [r.randint(40, 255), r.randint(40, 255), r.randint(40, 255)]
                cx = win[0] + 4 + col * (win[2] - 8) / 5
                cy = win[1] + 4 + row * (win[3] - 6) / 5
                B.rect(cx, cy, (win[2] - 8) / 5 - 3, (win[3] - 6) / 5 - 5, cc)
                E.rect(cx, cy, (win[2] - 8) / 5 - 3, (win[3] - 6) / 5 - 5, scale(cc, 0.75))
                B.rect(cx, cy + (win[3] - 6) / 5 - 4, (win[2] - 8) / 5, 2, [40, 40, 50])
        B.rect(x + w - 15, y + 10, 10, 30, [30, 30, 40]); B.rect(x + w - 13, y + 14, 6, 6, [255, 60, 60]); E.rect(x + w - 13, y + 14, 6, 6, [255, 40, 40])
        B.rect(x + 5, y + h * 0.72, w - 22, 14, [24, 24, 30])
        B.rect(x + 5, y + h * 0.66, w - 22, 4, [255, 255, 255]); E.rect(x + 5, y + h * 0.66, w - 22, 4, [200, 200, 200])
    return f


def p_poster(seed):
    def f(B, E, x, y, w, h, r):
        rr = random.Random(seed)
        bg = rr.choice([[30, 20, 60], [240, 200, 60], [20, 60, 80], [200, 40, 80], [240, 240, 230]])
        B.rect(x, y, w, h, bg)
        fg = rr.choice([[255, 60, 200], [40, 230, 255], [255, 120, 40], [20, 20, 30], [120, 255, 140]])
        k = seed % 4
        if k == 0:
            B.disc(x + w / 2, y + h * 0.4, w * 0.32, fg)
        elif k == 1:
            for i in range(5):
                B.rect(x, y + h * (0.15 + i * 0.12), w, h * 0.06, fg)
        elif k == 2:
            for i in range(int(h * 0.6)):
                B.rect(x + w / 2 - i * 0.4, y + h * 0.1 + i, i * 0.8, 1, fg)
        else:
            B.ring(x + w / 2, y + h * 0.42, w * 0.18, w * 0.34, fg)
        for i in range(3):
            B.rect(x + 4, y + h * 0.78 + i * 4, w * rr.uniform(0.4, 0.85), 2, scale(fg, 0.8) if bg[0] < 100 else [20, 20, 30])
        B.speckle(x, y, w, h, 40, r, 0.7, 1.0)
    return f


def p_hazard2(B, E, x, y, w, h, r):
    """clean diagonal stripes, tile-able horizontally inside the region"""
    for yy in range(h):
        for xx in range(w):
            on = ((xx + yy) // 12) % 2 == 0
            B.px(x + xx, y + yy, [228, 180, 40] if on else [26, 24, 28])
    B.speckle(x, y, w, h, 250, r, 0.75, 1.05)


def p_diag(c0, c1):
    a, b = hexrgb(c0), hexrgb(c1)

    def f(B, E, x, y, w, h, r):
        for yy in range(h):
            for xx in range(w):
                B.px(x + xx, y + yy, a if ((xx + yy) // 10) % 2 == 0 else b)
        B.speckle(x, y, w, h, 200, r, 0.8, 1.05)
    return f


def p_wood(B, E, x, y, w, h, r):
    for k in range(0, h, 12):
        c = [r.randint(130, 160), r.randint(92, 108), r.randint(58, 70)]
        B.rect(x, y + k, w, 11, c)
        B.rect(x, y + k + 11, w, 1, [70, 48, 30])
        for g in range(6):
            B.rect(x + r.randint(0, w - 20), y + k + r.randint(2, 8), r.randint(10, 30), 1, scale(c, 0.85))
    B.rect(x, y, 3, h, [70, 48, 30]); B.rect(x + w - 3, y, 3, h, [70, 48, 30])


def p_crate(B, E, x, y, w, h, r):
    p_wood(B, E, x, y, w, h, r)
    d = [92, 64, 40]
    B.rect(x, y, w, 6, d); B.rect(x, y + h - 6, w, 6, d); B.rect(x, y, 6, h, d); B.rect(x + w - 6, y, 6, h, d)
    B.line(x + 4, y + 4, x + w - 6, y + h - 6, d, 1.0, 5)


def p_fence(B, E, x, y, w, h, r):
    for yy in range(h):
        for xx in range(w):
            B.px(x + xx, y + yy, [0, 0, 0, 0])
    c = [150, 156, 168, 255]
    for k in range(-h, w + h, 16):
        for t in range(h):
            for o in (k + t, k + h - t):
                if 0 <= o < w:
                    B.px(x + o, y + t, c)
                    if o + 1 < w:
                        B.px(x + o + 1, y + t, [110, 116, 128, 255])


def p_puddle(B, E, x, y, w, h, r):
    B.vgrad(x, y, w, h, [26, 30, 52], [12, 14, 26])
    cols = [[255, 60, 200], [40, 230, 255], [255, 220, 90], [255, 150, 80]]
    for k in range(9):
        c = cols[k % 4]
        sx = x + r.randint(2, w - 8)
        sw = r.randint(2, 6)
        top = y + r.randint(0, h // 3)
        for yy in range(top, y + h):
            a = 0.85 * (1 - (yy - top) / (y + h - top)) ** 1.5
            B.rect(sx + math.sin(yy * 0.4) * 1.2, yy, sw, 1, c, a * 0.7)
            E.rect(sx + math.sin(yy * 0.4) * 1.2, yy, sw, 1, scale(c, a * 0.6))
    B.speckle(x, y, w, h, 80, r, 0.8, 1.3)


def p_paint(B, E, x, y, w, h, r):
    B.rect(x, y, w, h, [214, 208, 226])
    for k in range(int(w * h * 0.12)):
        xx, yy = x + r.randrange(w), y + r.randrange(h)
        B.px(xx, yy, [80, 76, 90], 0.55)


def p_slab(base):
    bc = hexrgb(base)

    def f(B, E, x, y, w, h, r):
        B.rect(x, y, w, h, bc)
        B.speckle(x, y, w, h, 700, r, 0.82, 1.1)
        for k in range(3):
            B.rect(x + k, y + k, w - 2 * k, 1, scale(bc, 1.18)); B.rect(x + k, y + h - 1 - k, w - 2 * k, 1, scale(bc, 0.75))
        B.line(x + r.randint(5, 20), y + r.randint(5, 20), x + r.randint(30, 60), y + r.randint(30, 60), scale(bc, 0.7), 0.6)
    return f


def p_manhole(B, E, x, y, w, h, r):
    B.rect(x, y, w, h, [46, 42, 52])
    cx, cy, R = x + w / 2, y + h / 2, w / 2 - 1
    B.disc(cx, cy, R, [70, 66, 78]); B.ring(cx, cy, R - 4, R - 2, [40, 38, 46])
    for k in range(-int(R), int(R), 6):
        for t in range(-int(R) + 6, int(R) - 6):
            if math.hypot(k, t) < R - 7:
                B.px(int(cx + k), int(cy + t), [96, 92, 104])
                B.px(int(cx + t), int(cy + k), [96, 92, 104])
    B.disc(cx, cy, 7, [60, 56, 66]); B.speckle(x, y, w, h, 200, r, 0.7, 1.1)


def p_grate(B, E, x, y, w, h, r):
    B.rect(x, y, w, h, [60, 58, 66])
    for k in range(4, w - 3, 6):
        B.rect(x + k, y + 3, 3, h - 6, [14, 12, 18])
    B.speckle(x, y, w, h, 100, r, 0.7, 1.1)


def p_acgrille(B, E, x, y, w, h, r):
    B.rect(x, y, w, h, [170, 172, 182])
    cx, cy, R = x + w / 2, y + h / 2, min(w, h) / 2 - 3
    B.disc(cx, cy, R, [40, 42, 50])
    for rr_ in range(3, int(R), 3):
        B.ring(cx, cy, rr_, rr_ + 1, [120, 122, 132])
    B.disc(cx, cy, 4, [150, 152, 160])


def p_brick(base):
    bc = hexrgb(base)

    def f(B, E, x, y, w, h, r):
        B.rect(x, y, w, h, scale(bc, 0.55))
        for row, yy in enumerate(range(0, h, 8)):
            off = 8 if row % 2 else 0
            for xx in range(-off, w, 16):
                c = scale(bc, r.uniform(0.85, 1.12))
                B.rect(x + max(0, xx) + 1, y + yy + 1, min(15, w - max(0, xx)) - 1 if xx >= 0 else 15 + xx - 1, 6, c)
        B.speckle(x, y, w, h, 300, r, 0.8, 1.1)
    return f


def p_panel(base):
    bc = hexrgb(base)

    def f(B, E, x, y, w, h, r):
        B.vgrad(x, y, w, h, scale(bc, 1.08), scale(bc, 0.82))
        B.rect(x, y, w, 2, scale(bc, 1.25)); B.rect(x, y + h - 2, w, 2, scale(bc, 0.6))
        B.rect(x, y, 2, h, scale(bc, 1.15)); B.rect(x + w - 2, y, 2, h, scale(bc, 0.65))
        for k in range(3):   # rust streaks / grime
            sx = x + r.randint(4, w - 6)
            for yy in range(r.randint(4, h // 3), h):
                B.px(sx, y + yy, scale(bc, 0.7), 0.5)
        B.speckle(x, y, w, h, 260, r, 0.85, 1.1)
    return f


def p_hiwin(col):
    c = hexrgb(col)

    def f(B, E, x, y, w, h, r):
        B.rect(x, y, w, h, [30, 26, 34])
        for k in range(0, w, 16):
            lit = r.random() < 0.75
            cc = scale(c, r.uniform(0.7, 1.0)) if lit else [40, 40, 56]
            B.rect(x + k + 2, y + 2, 12, h - 4, cc)
            if lit:
                E.rect(x + k + 2, y + 2, 12, h - 4, scale(cc, 0.8))
            B.rect(x + k + 2, y + h // 2, 12, 1, [30, 26, 34])
    return f


def p_screen(B, E, x, y, w, h, r):
    """boss gate status screen: abstract bars"""
    B.rect(x, y, w, h, [10, 6, 20])
    for k in range(6):
        bw = r.randint(w // 4, w - 10)
        c = [255, 40, 90] if k % 2 else [255, 120, 220]
        B.rect(x + 5, y + 5 + k * (h - 10) / 6, bw, (h - 10) / 6 - 3, c)
        E.rect(x + 5, y + 5 + k * (h - 10) / 6, bw, (h - 10) / 6 - 3, c)


def p_water(B, E, x, y, w, h, r):
    B.vgrad(x, y, w, h, [16, 40, 60], [6, 16, 28])


def p_ctdoor(base):
    bc = hexrgb(base)

    def f(B, E, x, y, w, h, r):
        B.rect(x, y, w, h, bc)
        for k in range(0, w, 6):
            B.rect(x + k, y, 2, h, scale(bc, 0.75))
        B.rect(x + w // 2 - 1, y, 2, h, scale(bc, 0.4))
        for bx in (w * 0.2, w * 0.38, w * 0.62, w * 0.8):
            B.rect(x + bx, y + 4, 2, h - 8, [60, 60, 66])
        B.speckle(x, y, w, h, 180, r, 0.7, 1.05)
    return f


REGIONS = [
    # name, w, h, painter
    ('shop_mart', 256, 128, p_shop('mart')),
    ('shop_ramen', 256, 128, p_shop('ramen')),
    ('shop_arcade', 256, 128, p_shop('arcade')),
    ('shop_laundry', 256, 128, p_shop('laundry')),
    ('shutter_a', 128, 128, p_shutter('#ff3ac8')),
    ('shutter_b', 128, 128, p_shutter('#3ae8ff')), ('shutter_plain', 128, 128, p_shutter(None)),
    ('vend_red', 64, 128, p_vend('red')),
    ('vend_blue', 64, 128, p_vend('blue')),
    ('brick_red', 128, 128, p_brick('#8a4a3a')),
    ('brick_purple', 128, 128, p_brick('#6a4a72')),
    ('panel_rust', 128, 128, p_panel('#7a4a34')),
    ('panel_conc', 128, 128, p_panel('#7a746c')),
    ('panel_blue', 128, 128, p_panel('#4a6272')),
    ('wood', 64, 64, p_wood), ('crate', 64, 64, p_crate),
    ('fence', 64, 64, p_fence), ('puddle', 64, 64, p_puddle),
    ('slab', 64, 64, p_slab('#706a80')), ('slab_dock', 64, 64, p_slab('#5e6670')), ('slab_fact', 64, 64, p_slab('#6a605a')), ('manhole', 64, 64, p_manhole),
    ('ct_door_red', 64, 64, p_ctdoor('#a8402e')), ('ct_door_blue', 64, 64, p_ctdoor('#2e5c9a')),
    ('ct_door_yellow', 64, 64, p_ctdoor('#c49a2a')), ('ct_door_green', 64, 64, p_ctdoor('#3a7a58')),
    ('aw_red', 64, 32, p_awning('#c02a3a', '#ece6e6')), ('aw_teal', 64, 32, p_awning('#1f8a90', '#ece6e6')),
    ('aw_purple', 64, 32, p_awning('#7a2a9a', '#f0a0e0')), ('aw_navy', 64, 32, p_awning('#24305a', '#e8c040')),
    ('hazard', 128, 32, p_hazard2), ('stripe_rw', 128, 32, p_diag('#c8303a', '#e8e4ec')),
    ('hazard_v', 32, 128, p_hazard2),
    ('hiwin_amber', 128, 32, p_hiwin('#ffb050')), ('hiwin_cyan', 128, 32, p_hiwin('#a8f0ff')),
    ('screen', 64, 32, p_screen),
    ('grate', 32, 32, p_grate), ('acgrille', 32, 32, p_acgrille), ('paint', 32, 32, p_paint),
]
WIN_KINDS = [('curtain', '#ffd27a'), ('blinds', '#ffd9a0'), ('plant', '#ffe0a0'), ('person', '#ffc890'),
             ('curtain', '#ff9de6'), ('tv', '#8ff0ff'), ('blinds', '#a8f0ff'), ('blinds', '#ffb070'),
             ('dark', '#000000'), ('dark', '#ff2bd6'), ('dark', '#22f3ff'), ('dark', '#000000')]
for i, (k, c) in enumerate(WIN_KINDS):
    REGIONS.append((f'win{i}', 48, 64, p_window(k, c)))
for i in range(8):
    REGIONS.append((f'poster{i}', 32, 48, p_poster(i + 3)))

LIT_WINDOWS = [f'win{i}' for i, (k, _) in enumerate(WIN_KINDS) if k != 'dark']
DARK_WINDOWS = [f'win{i}' for i, (k, _) in enumerate(WIN_KINDS) if k == 'dark']

# ---------------------------------------------------------------- layout

def _layout():
    sw = {}
    for i, name in enumerate(SWATCHES):
        cx, cy = i % (SIZE // CELL), i // (SIZE // CELL)
        sw[name] = (cx * CELL, cy * CELL)
    rows = (len(SWATCHES) + SIZE // CELL - 1) // (SIZE // CELL)
    y0 = rows * CELL + GUT
    regs = {}
    items = sorted(REGIONS, key=lambda t: (-t[2], -t[1], t[0]))
    x, y, shelf = GUT, y0, 0
    for name, w, h, painter in items:
        if x + w + GUT > SIZE:
            x, y, shelf = GUT, y + shelf + 2 * GUT, 0
        regs[name] = (x, y, w, h, painter)
        x += w + 2 * GUT
        shelf = max(shelf, h)
    assert y + shelf <= SIZE, 'atlas overflow'
    return sw, regs


SW_POS, REG_POS = _layout()


def swatch_uv(name):
    x, y = SW_POS[name]
    return ((x + CELL / 2) / SIZE, 1 - (y + CELL / 2) / SIZE)


def region_uv(name, inset=0.5):
    """(u0, v0, u1, v1) with v pointing up (Blender convention)"""
    x, y, w, h, _ = REG_POS[name]
    return ((x + inset) / SIZE, 1 - (y + h - inset) / SIZE, (x + w - inset) / SIZE, 1 - (y + inset) / SIZE)


def signature():
    """hash of the atlas layout: kits must be rebuilt whenever this changes"""
    import hashlib
    h = hashlib.sha1(repr(sorted((k, v[:4]) for k, v in REG_POS.items())).encode() + repr(sorted(SW_POS.items())).encode())
    return h.hexdigest()[:12]


def build(outdir):
    B = Canvas(SIZE, SIZE, 4, (0, 0, 0, 255))
    E = Canvas(SIZE, SIZE, 3, (0, 0, 0))
    for name, (x, y) in SW_POS.items():
        b, e = SWATCHES[name]
        B.rect(x, y, CELL, CELL, hexrgb(b))
        if e:
            E.rect(x, y, CELL, CELL, hexrgb(e))
    for i, (name, (x, y, w, h, painter)) in enumerate(sorted(REG_POS.items())):
        rng = random.Random(1000 + i)
        painter(B, E, x, y, w, h, rng)
        # gutters: replicate border pixels outward
        for cv in (B, E):
            for yy in range(y, y + h):
                l, rr = cv.get(x, yy), cv.get(x + w - 1, yy)
                la = cv.buf[(yy * cv.w + x) * cv.ch + 3] if cv.ch == 4 else 255
                ra = cv.buf[(yy * cv.w + x + w - 1) * cv.ch + 3] if cv.ch == 4 else 255
                cv.rect(x - GUT, yy, GUT, 1, l + [la]); cv.rect(x + w, yy, GUT, 1, rr + [ra])
            for k in range(GUT):
                i0 = ((y) * cv.w + x - GUT) * cv.ch
                i1 = ((y + h - 1) * cv.w + x - GUT) * cv.ch
                n = (w + 2 * GUT) * cv.ch
                top, bot = bytes(cv.buf[i0:i0 + n]), bytes(cv.buf[i1:i1 + n])
                j0 = ((y - 1 - k) * cv.w + x - GUT) * cv.ch
                j1 = ((y + h + k) * cv.w + x - GUT) * cv.ch
                cv.buf[j0:j0 + n] = top
                cv.buf[j1:j1 + n] = bot
    os.makedirs(outdir, exist_ok=True)
    write_png(os.path.join(outdir, 'atlas.png'), SIZE, SIZE, B.buf, 4)
    write_png(os.path.join(outdir, 'atlas_e.png'), SIZE, SIZE, E.buf, 3)
    build_asphalt(outdir)


def build_asphalt(outdir, n=256):
    """tile-able asphalt (grey; tinted per zone in the game)"""
    r = random.Random(77)
    A = Canvas(n, n, 3, (128, 128, 128))
    # value noise via a few octaves of wrapped random grids
    for oct_, amp in ((8, 10), (16, 7), (64, 6)):
        g = [[r.uniform(-1, 1) for _ in range(oct_)] for _ in range(oct_)]
        s = n / oct_
        for y in range(n):
            for x in range(n):
                fx, fy = x / s, y / s
                x0, y0 = int(fx) % oct_, int(fy) % oct_
                x1, y1 = (x0 + 1) % oct_, (y0 + 1) % oct_
                tx, ty = fx - int(fx), fy - int(fy)
                tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
                v = (g[y0][x0] * (1 - tx) + g[y0][x1] * tx) * (1 - ty) + (g[y1][x0] * (1 - tx) + g[y1][x1] * tx) * ty
                i = (y * n + x) * 3
                c = A.buf[i] + v * amp
                A.buf[i:i + 3] = bytes([max(0, min(255, int(c)))] * 3)
    for _ in range(5000):   # aggregate
        x, y = r.randrange(n), r.randrange(n)
        v = r.choice([90, 100, 160, 175])
        A.px(x, y, [v, v, v])
    for _ in range(6):      # cracks (wrapped)
        x, y = r.uniform(0, n), r.uniform(0, n)
        for k in range(40):
            x += r.uniform(-2.5, 2.5); y += r.uniform(-2.5, 2.5)
            A.px(int(x) % n, int(y) % n, [70, 70, 72], 0.8)
    for _ in range(3):      # tar patches
        x, y, R = r.uniform(0, n), r.uniform(0, n), r.uniform(10, 22)
        for yy in range(int(y - R), int(y + R)):
            for xx in range(int(x - R * 1.6), int(x + R * 1.6)):
                if ((xx - x) / 1.6) ** 2 + (yy - y) ** 2 < R * R:
                    A.px(xx % n, yy % n, [100, 100, 104], 0.35)
    write_png(os.path.join(outdir, 'asphalt.png'), n, n, A.buf, 3)


if __name__ == '__main__':
    import sys
    build(sys.argv[1] if len(sys.argv) > 1 else '.')
