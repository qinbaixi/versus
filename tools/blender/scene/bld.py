"""Building parts shared by the town / docks / factory kits (front plane y = 0, -y = street)."""
import math, random
from mathutils import Matrix, Vector
import atlas as A


def window(P, x, z, rng, trim, w=44, h=62, lit=0.45, mull=True, frame='steel_dk'):
    """framed window centred on x, bottom at z"""
    P.box((x - w / 2 - 4, -2.0, z - 4), (x + w / 2 + 4, 0.5, z + h + 4), frame, bevel=0.8)
    reg = rng.choice(A.LIT_WINDOWS) if rng.random() < lit else rng.choice(A.DARK_WINDOWS)
    P.front(x - w / 2, z, x + w / 2, z + h, -2.1, ('reg', reg))
    if mull:
        P.box((x - 0.9, -3.0, z), (x + 0.9, -2.0, z + h), frame)
        P.box((x - w / 2, -3.0, z + h * 0.68), (x + w / 2, -2.0, z + h * 0.68 + 1.8), frame)
    P.box((x - w / 2 - 7, -6, z - 8), (x + w / 2 + 7, 0, z - 3), trim, bevel=1.0)       # sill
    P.box((x - w / 2 - 6, -3.5, z + h + 4), (x + w / 2 + 6, 0, z + h + 10), trim, bevel=0.8)  # lintel
    return reg in A.LIT_WINDOWS


def ac_unit(P, x, z, rng):
    P.box((x - 16, -20, z), (x + 16, -1, z + 18), 'ac', bevel=1)
    P.front(x - 1, z + 2, x + 14, z + 16, -20.05, ('reg', 'acgrille'))
    for xx in (x - 12, x + 12):
        P.beam((xx, -1, z - 8), (xx, -17, z), 1.6, 1.6, 'steel_dk')
    if rng.random() < 0.5:   # drip pipe
        P.rod((x - 10, -6, z), (x - 10, -6, z - 40 - rng.random() * 30), 0.7, 'ac_dk', seg=4)


def drainpipe(P, x, z0, z1, sw='ac_dk', y=-4):
    P.rod((x, y, z0 + 8), (x, y, z1), 2.4, sw, seg=8)
    P.rod((x, y, z0 + 8), (x, y - 8, z0 + 1), 2.4, sw, seg=8)
    for z in range(int(z0 + 40), int(z1), 90):
        P.box((x - 3.5, y - 1, z), (x + 3.5, 0, z + 3), sw)
    P.box((x - 4, y - 4, z1 - 6), (x + 4, 1, z1 + 2), sw, bevel=0.8)


def railing(P, x0, x1, y, z, h=32, sw='steel_dk', step=10, post=1.2):
    n = max(1, int((x1 - x0) / step))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        P.box((x - post / 2, y - post / 2, z), (x + post / 2, y + post / 2, z + h), sw)
    P.box((x0 - 1, y - 1.6, z + h), (x1 + 1, y + 1.6, z + h + 2.4), sw)
    P.box((x0, y - 0.8, z + 4), (x1, y + 0.8, z + 5.6), sw)


def fire_escape(P, fx0, fx1, floors, gf, fh, rng):
    """zig-zag fire escape in front of the facade (platforms at each upper floor)"""
    sw = 'steel_dk'
    dep = 38
    for f in range(floors):
        zp = gf + f * fh + 12
        P.box((fx0, -dep, zp - 2.4), (fx1, -2, zp), sw, sides={'+z': ('reg', 'grate')})
        railing(P, fx0, fx1, -dep + 1, zp, h=30, sw=sw, step=12)
        for x in (fx0, fx1):   # side rails
            P.box((x - 0.8, -dep, zp + 30), (x + 0.8, -2, zp + 32.4), sw)
            P.box((x - 0.6, -dep, zp + 15), (x + 0.6, -2, zp + 16.2), sw)
        for x in (fx0 + 8, fx1 - 8):   # brackets
            P.beam((x, -1, zp - 26), (x, -dep + 4, zp - 2), 2, 2, sw)
        if f < floors - 1:     # stair to next platform
            a = (fx0 + 10, -dep + 18, zp)
            b = (fx1 - 14, -dep + 18, zp + fh)
            for yy in (-dep + 8, -dep + 28):
                P.beam((a[0], yy, a[2]), (b[0], yy, b[2]), 1.6, 3.2, sw)
            n = 11
            for i in range(1, n):
                t = i / n
                x = a[0] + (b[0] - a[0]) * t
                z = a[2] + (b[2] - a[2]) * t
                P.box((x - 3.5, -dep + 8, z - 1), (x + 3.5, -dep + 28, z), sw)
            P.beam((a[0], -dep + 6, a[2] + 30), (b[0], -dep + 6, b[2] + 30), 1.2, 2, sw)
    # drop ladder from the lowest platform
    zp = gf + 12
    lx = fx1 - 18
    for x in (lx - 8, lx + 8):
        P.box((x - 0.8, -dep + 2, zp - 90), (x + 0.8, -dep + 4, zp), sw)
    for z in range(int(zp - 86), int(zp), 9):
        P.box((lx - 8, -dep + 2.4, z), (lx + 8, -dep + 3.6, z + 1.2), sw)


def water_tank(P, x, y, z, rng):
    for dx in (-18, 18):
        for dy in (-18, 18):
            P.box((x + dx - 1.6, y + dy - 1.6, z), (x + dx + 1.6, y + dy + 1.6, z + 40), 'steel_dk')
    P.beam((x - 18, y - 18, z + 4), (x + 18, y - 18, z + 36), 1.2, 1.2, 'steel_dk')
    P.box((x - 26, y - 26, z + 40), (x + 26, y + 26, z + 44), 'steel_dk')
    P.cyl((x, y, z + 44), 27, 58, 'tank_wood', seg=14)
    for zz in (z + 52, z + 70, z + 90):
        P.cyl((x, y, zz), 27.7, 2.2, 'band', seg=14)
    P.cyl((x, y, z + 102), 29, 18, 'd_roof', seg=14, r2=3)
    P.beam((x - 10, y - 27.5, z + 44), (x - 10, y - 27.5, z + 102), 1, 1, 'steel_dk')
    P.beam((x - 4, y - 27.5, z + 44), (x - 4, y - 27.5, z + 102), 1, 1, 'steel_dk')


def antenna(P, x, y, z, h=130):
    P.rod((x, y, z), (x, y, z + h), 1.4, 'steel', seg=6)
    for k, zz in enumerate(range(int(z + h * 0.5), int(z + h), 16)):
        L = 22 - k * 3
        P.rod((x - L, y, zz), (x + L, y, zz), 0.6, 'steel', seg=4)
    P.box((x - 2, y - 2, z + h), (x + 2, y + 2, z + h + 4), 'led_red')
    P.anchor('blink', (x, y - 3, z + h + 2), col='#ff2020')


def dish(P, x, y, z):
    P.rod((x, y, z), (x, y, z + 18), 1.4, 'steel', seg=6)
    M = Matrix.Translation((x, y - 2, z + 22)) @ Matrix.Rotation(math.radians(-60), 4, 'X')
    P.cyl((0, 0, 0), 16, 6, 'white', seg=14, r2=4, M=M)
    P.rod((x, y - 6, z + 26), (x, y - 16, z + 36), 0.6, 'steel', seg=4)


def billboard(P, x, y, z, w=160, h=80):
    for xx in (x - w * 0.35, x + w * 0.35):
        P.box((xx - 2, y - 2, z), (xx + 2, y + 2, z + 34), 'steel_dk')
        P.beam((xx, y + 2, z), (xx, y + 26, z + 30), 1.6, 1.6, 'steel_dk')
    P.box((x - w / 2 - 4, y - 2, z + 30), (x + w / 2 + 4, y + 6, z + 34 + h + 4), 'steel_dk', bevel=1, sides={'-y': 'sign_back'})
    P.box((x - w / 2 - 6, y - 14, z + 26), (x + w / 2 + 6, y - 2, z + 29), 'steel_dk', sides={'+z': ('reg', 'grate')})
    for xx in (x - w * 0.3, x + w * 0.3):   # spot lamps on arms
        P.beam((xx, y - 2, z + 30), (xx, y - 22, z + 22), 1.2, 1.2, 'steel_dk')
        P.box((xx - 4, y - 26, z + 18), (xx + 4, y - 18, z + 24), 'steel', bevel=0.6)
        P.box((xx - 3, y - 18.2, z + 19), (xx + 3, y - 17.6, z + 23), 'lamp_warm')
    P.anchor('billboard', (x, y - 2.6, z + 34 + h / 2 + 2), w=w, h=h)


def roof_box(P, x, y, z, w=34, d=24, h=20, sw='ac'):
    P.box((x - w / 2, y - d / 2, z), (x + w / 2, y + d / 2, z + h), sw, bevel=1, sides={'-y': ('reg', 'grate')})


def stair_hut(P, x, y, z, wall):
    P.box((x - 28, y - 22, z), (x + 28, y + 22, z + 52), wall, bevel=1)
    P.box((x - 31, y - 25, z + 52), (x + 31, y + 25, z + 56), 'd_roof', bevel=1)
    P.box((x - 10, y - 22.6, z), (x + 10, y - 22, z + 40), 'steel_dk')
    P.box((x - 3, y - 26, z + 44), (x + 3, y - 22, z + 48), 'lamp_warm')


def tiled(P, x0, z0, x1, z1, y, reg, tile=96):
    """cover a front rectangle with repeated region tiles (for bricks / panels)"""
    nx, nz = max(1, round((x1 - x0) / tile)), max(1, round((z1 - z0) / tile))
    for i in range(nx):
        for j in range(nz):
            P.front(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz, x0 + (x1 - x0) * (i + 1) / nx, z0 + (z1 - z0) * (j + 1) / nz, y, ('reg', reg))


def wall_lamp(P, x, z, col='lamp_warm'):
    P.box((x - 5, -8, z), (x + 5, 0, z + 6), 'steel_dk', bevel=0.8)
    P.box((x - 4, -8.6, z + 1), (x + 4, -8, z + 5), col)
    P.anchor('walllight', (x, -10, z), col={'lamp_warm': '#ffd8a0', 'lamp_cool': '#bff4ff', 'lamp_amber': '#ffb060', 'warn_lamp': '#ffa020'}.get(col, '#ffd8a0'))
