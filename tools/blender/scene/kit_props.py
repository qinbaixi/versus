"""Street props kit -> priv/www/assets/scene/props.glb
Origin of every prop: bottom centre of its footprint.  Front faces -y (towards the street).
"""
import math, random
from mathutils import Matrix, Vector
from nklib import Part


def lamp(name, style):
    P = Part(name)
    head = Vector((0, -56, 200))
    if style == 'town':
        P.cyl((0, 0, 0), 7, 6, 'steel_dk', seg=12)
        P.cyl((0, 0, 6), 5, 10, 'steel', seg=12, r2=3.6)
        P.cyl((0, 0, 16), 2.8, 180, 'steel_dk', seg=10, r2=2.2)
        P.cyl((0, 0, 60), 3.6, 4, 'steel', seg=10)
        P.cyl((0, 0, 194), 3.2, 4, 'steel', seg=10)
        pts = [(0, 0, 192), (0, -6, 202), (0, -16, 208), (0, -30, 210), (0, -44, 208), (0, -54, 204)]
        for a, b in zip(pts, pts[1:]):
            P.rod(a, b, 1.9, 'steel_dk', seg=6)
        P.box((-11, -66, 198), (11, -46, 205), 'steel', bevel=1.5)
        P.box((-8.5, -63, 197), (8.5, -49, 198.2), 'lamp_warm')
        # banner flag (decor)
        P.rod((0, 0, 168), (0, -20, 168), 0.8, 'steel', seg=5)
        P.rod((0, 0, 118), (0, -20, 118), 0.8, 'steel', seg=5)
        P.box((-0.6, -19, 120), (0.6, -2, 166), 'flag_pink', sides={'-x': ('reg', 'poster1'), '+x': ('reg', 'poster1')})
        P.anchor('light', head + Vector((0, 0, -4)), col='#ffd8a0')
    elif style == 'dock':
        P.box((-7, -7, 0), (7, 7, 8), 'concrete_dk', bevel=1)
        P.cyl((0, 0, 8), 3.4, 196, 'steel', seg=8, r2=2.6)
        P.beam((0, 0, 196), (0, -58, 206), 4, 3, 'steel')
        P.beam((0, 0, 176), (0, -30, 200), 2.4, 2, 'steel')
        P.box((-12, -68, 200), (12, -48, 208), 'steel_lt', bevel=2)
        P.box((-9, -65, 199), (9, -51, 200.2), 'lamp_cool')
        P.cyl((0, 0, 204), 3.6, 6, 'steel_lt', seg=8, r2=1)
        P.anchor('light', head + Vector((0, -2, -2)), col='#bff4ff')
    else:  # factory: lattice-ish industrial pole with cage lamp
        P.box((-8, -8, 0), (8, 8, 6), 'concrete_dk', bevel=1)
        for sx in (-2.5, 2.5):
            for sy in (-2.5, 2.5):
                P.box((sx - 1.2, sy - 1.2, 6), (sx + 1.2, sy + 1.2, 206), 'rust_dk')
        for z in range(20, 200, 24):
            P.box((-3.5, -3.5, z), (3.5, 3.5, z + 1.5), 'rust_dk')
        P.beam((0, 0, 202), (0, -58, 202), 3, 3, 'rust_dk')
        P.box((-10, -66, 194), (10, -50, 202), 'steel_dk', bevel=1.5)
        P.box((-7.5, -64, 193), (7.5, -52, 194.2), 'lamp_amber')
        for x in (-7, 0, 7):
            P.box((x - 0.5, -65, 188), (x + 0.5, -51, 193), 'steel_dk')
        P.box((-7, -65, 187.5), (7, -51, 188.5), 'steel_dk')
        P.box((-6, -6, 150), (6, 3, 170), 'warn_lamp' if False else 'steel', bevel=1)
        P.cyl((0, -6.5, 160), 2.4, 2, 'warn_lamp', axis='y', seg=8)
        P.anchor('light', head + Vector((0, 0, -10)), col='#ffb060')
    return P


def sign_frame_h():
    """unit horizontal sign box 100 x 40 (scaled in game to the text); text plane anchor at front"""
    P = Part('signframe_h')
    P.box((-50, -8, -20), (50, 0, 20), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    for x in (-36, 36):
        P.box((x - 2, -1, -24), (x + 2, 6, -20), 'steel_dk')
        P.box((x - 2, -1, 20), (x + 2, 6, 24), 'steel_dk')
    P.anchor('text', (0, -8.6, 0))
    return P


def sign_frame_v():
    P = Part('signframe_v')
    P.box((-20, -8, -50), (20, 0, 50), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    for z in (-38, 38):
        P.beam((-20, -4, z), (-30, 10, z), 3, 3, 'steel_dk')
    P.anchor('text', (0, -8.6, 0))
    return P


def vending(kind):
    P = Part('vend_' + kind)
    body = 'vend_red' if kind == 'red' else 'vend_blue'
    P.box((-17, -13, 0), (17, 13, 4), 'black')
    P.box((-18, -14, 4), (18, 14, 78), body, bevel=1.5, sides={'-y': ('reg', 'vend_' + kind)})
    P.box((-18.5, -14.5, 78), (18.5, 14.5, 81), 'vend_white', bevel=0.8)
    P.box((-15, -15.2, 72), (15, -14, 77), 'neon_cyan' if kind == 'blue' else 'neon_yel')
    P.anchor('glow', (0, -16, 50), col='#9ff0ff' if kind == 'blue' else '#ffe6a0', w=30, h=46)
    return P


def trash_bin():
    P = Part('bin')
    P.cyl((0, 0, 0), 10, 2, 'steel_dk', seg=14)
    P.cyl((0, 0, 2), 10.5, 32, 'bin', seg=14, r2=11.5)
    for z in (5, 26):
        P.cyl((0, 0, z), 11.6 + z * 0.03, 2.5, 'steel', seg=14)
    P.cyl((0, 0, 34), 12.4, 3, 'steel_dk', seg=14)
    P.cyl((0, 0, 37), 11, 5, 'steel', seg=14, r2=6)
    P.cyl((0, 0, 42), 6, 1, 'black', seg=14)
    return P


def dumpster(col):
    P = Part('dumpster_' + col[-1])
    sw = 'dumpster_' + col[-1]
    P.extrude([(-17, 3), (19, 3), (21, 44), (-19, 42)], -38, 38, sw)          # tapered body
    P.box((-39, -19, 36), (39, -16, 40), 'steel_dk', bevel=0.8)               # front lip
    for x in (-37, 37):
        P.box((x - 1.5, -19, 8), (x + 1.5, 20, 12), 'steel_dk')
    # lids (one slightly open)
    P.box((-38, -20, 43), (-1, 22, 45.5), 'dark2', bevel=0.8, M=Matrix.Rotation(math.radians(2.5), 4, 'X'))
    P.box((1, -20, 42), (38, 22, 44.5), 'dark2', bevel=0.8, M=Matrix.Translation((0, 6, 2)) @ Matrix.Rotation(math.radians(-14), 4, 'X'))
    for x in (-30, 30):
        for y in (-12, 12):
            P.cyl((x, y, 0), 3.6, 3, 'rubber', axis='x', seg=8, M=Matrix.Translation((-1.5, 0, 3.6)))
    P.box((-24, -18.2, 16), (-8, -17.6, 26), ('reg', 'poster5'))
    return P


def boxes(variant):
    P = Part('boxes' + str(variant))
    rng = random.Random(variant * 7 + 1)
    stacks = [((-14, 0, 0), (26, 22, 18)), ((12, 2, 0), (22, 20, 20)), ((-6, 1, 18), (20, 18, 16))] if variant == 1 else \
             [((-10, 0, 0), (30, 24, 22)), ((18, 4, 0), (18, 16, 14)), ((-14, 2, 22), (18, 16, 13)), ((6, -2, 22), (14, 14, 10))]
    for (x, y, z), (w, d, h) in stacks:
        a = math.radians(rng.uniform(-10, 10))
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(a, 4, 'Z')
        P.box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'card', bevel=0.6, M=M)
        P.box((-w / 2 - 0.1, -2, h - 0.2), (w / 2 + 0.1, 2, h + 0.4), 'tape', M=M)
        P.box((-w / 2 + 2, -d / 2 - 0.3, h * 0.4), (-w / 2 + 8, -d / 2, h * 0.7), 'card_dk', M=M)
    return P


def hydrant():
    P = Part('hydrant')
    P.cyl((0, 0, 0), 7, 3, 'hydrant', seg=12)
    P.cyl((0, 0, 3), 5.2, 20, 'hydrant', seg=12)
    P.cyl((0, 0, 21), 6.2, 3, 'hydrant', seg=12)
    P.cyl((0, 0, 24), 5.4, 5, 'hydrant', seg=12, r2=2.6)
    P.cyl((0, 0, 29), 1.6, 3, 'chrome', seg=6)
    P.cyl((-8, 0, 15), 2.6, 16, 'hydrant', axis='x', seg=8)
    P.cyl((-9, 0, 15), 3.2, 1.6, 'chrome', axis='x', seg=8)
    P.cyl((7.4, 0, 15), 3.2, 1.6, 'chrome', axis='x', seg=8)
    P.cyl((0, -9, 13), 3.4, 6, 'hydrant', axis='y', seg=8)
    P.cyl((0, -9.5, 13), 3.8, 1.5, 'chrome', axis='y', seg=8)
    return P


def cone():
    P = Part('cone')
    P.box((-9, -9, 0), (9, 9, 1.8), 'rubber', bevel=0.6)
    P.cyl((0, 0, 1.8), 7, 22, 'cone', seg=12, r2=1.4)
    P.cyl((0, 0, 9.5), 5.15, 5, 'cone_band', seg=12, r2=3.95)
    return P


def barrier():
    P = Part('barrier')
    for x in (-34, 34):
        P.beam((x, -8, 0), (x, 0, 40), 2.4, 2.4, 'steel_dk')
        P.beam((x, 8, 0), (x, 0, 40), 2.4, 2.4, 'steel_dk')
    P.box((-40, -5.5, 26), (40, -3.5, 36), 'barrier_w', sides={'-y': ('reg', 'stripe_rw'), '+y': ('reg', 'stripe_rw')})
    P.box((-40, -2.5, 12), (40, -0.5, 20), 'barrier_w', sides={'-y': ('reg', 'stripe_rw', (0, 0, 0.6, 1)), '+y': ('reg', 'stripe_rw')})
    P.cyl((-34, -6, 40), 2.6, 3, 'warn_lamp', seg=8)
    return P


def jersey(kind):
    P = Part('jersey_' + kind)
    prof = [(-15, 0), (15, 0), (15, 6), (7, 14), (5, 40), (-5, 40), (-7, 14), (-15, 6)]
    if kind == 'stripe':
        hz = ('reg', 'hazard')
        sides = [None, None, hz, hz, None, hz, hz, None]
        P.extrude(prof, -60, 60, 'concrete', sides=sides)
    else:
        P.extrude(prof, -60, 60, 'concrete')
        P.box((-50, -5.6, 30), (-38, -4.6, 34), 'neon_red')
        P.box((38, -5.6, 30), (50, -4.6, 34), 'neon_red')
    return P


def bench():
    P = Part('bench')
    for x in (-38, 38):
        P.box((x - 2, -10, 0), (x + 2, 8, 2), 'steel_dk')
        P.beam((x, -8, 0), (x, -6, 20), 3, 3, 'steel_dk')
        P.beam((x, 6, 0), (x, 6, 46), 3, 3, 'steel_dk')
        P.box((x - 1.5, -10, 26), (x + 1.5, 6, 29), 'steel_dk')
    for k, y in enumerate((-9, -4, 1)):
        P.box((-46, y, 20), (46, y + 4.4, 22.4), 'bench', bevel=0.7)
    for k, z in enumerate((30, 38)):
        P.box((-46, 6, z), (46, 8, z + 5), 'bench', bevel=0.7, M=Matrix.Translation((0, 0, 0)))
    return P


def phone_booth():
    P = Part('booth')
    P.box((-22, -22, 0), (22, 22, 4), 'concrete_dk', bevel=1)
    for x in (-20, 20):
        for y in (-20, 20):
            P.box((x - 2, y - 2, 4), (x + 2, y + 2, 112), 'booth_frame')
    P.box((-23, -23, 112), (23, 23, 124), 'booth_red', bevel=1.5)
    P.box((-18, -23.6, 114), (18, -22.8, 122), 'neon_cyan')
    P.box((-24, -24, 124), (24, 24, 127), 'booth_frame', bevel=1)
    # glass (dark reflective + a lit interior band)
    P.front(-18, 8, 18, 110, -19.5, ('reg', 'win11'))
    P.quad((-19.5, 18, 8), (-19.5, -18, 8), (-19.5, -18, 110), (-19.5, 18, 110), ('reg', 'win8'))
    P.quad((19.5, -18, 8), (19.5, 18, 8), (19.5, 18, 110), (19.5, -18, 110), ('reg', 'win9'))
    P.box((-20, 18, 4), (20, 20, 112), 'booth_red')
    P.box((-7, 13, 60), (7, 18, 84), 'steel_dk', bevel=1)
    P.box((-4, 12.5, 74), (4, 13, 80), 'screen')
    P.box((-18, -21, 40), (18, -19, 44), 'booth_frame')
    P.anchor('glow', (0, -25, 118), col='#22f3ff', w=50, h=14)
    return P


def manhole():
    P = Part('manhole')
    P.cyl((0, 0, 0), 17, 0.5, 'steel_dk', seg=20, cap=('reg', 'manhole'))
    return P


def drain():
    P = Part('drain')
    P.box((-18, -6, 0), (18, 6, 0.4), 'gutter', sides={'+z': ('reg', 'grate')})
    return P


def puddle(i):
    P = Part('puddle' + str(i))
    rng = random.Random(40 + i)
    n = 14
    pts = []
    for k in range(n):
        a = k / n * 2 * math.pi
        rr = rng.uniform(0.7, 1.0) * (1 + 0.25 * math.sin(a * (2 + i) + i))
        pts.append((math.cos(a) * 50 * rr, math.sin(a) * 22 * rr))
    P.poly_floor(pts, 0, ('puddle', 'puddle'))
    return P


def zebra():
    P = Part('zebra')
    for k in range(9):
        x = k * 30
        P.floor(x - 9, -150, x + 9, 150, 0, ('reg', 'paint'), uv=((0, 0), (1, 0), (1, 1), (0, 1)))
    return P


def lane_dash():
    P = Part('dash')
    P.floor(-30, -2, 30, 2, 0, ('reg', 'paint'))
    return P


def drum(c):
    P = Part('drum_' + c)
    sw = 'drum_' + c
    P.cyl((0, 0, 0), 10.5, 33, sw, seg=14, cap='steel_dk')
    for z in (0, 10.5, 21.5, 32):
        P.cyl((0, 0, z), 11, 1.5, sw, seg=14)
    P.cyl((4, 3, 33), 1.8, 1, 'steel', seg=6)
    return P


def pallet():
    P = Part('pallet')
    for x in (-24, 0, 24):
        P.box((x - 3, -20, 0), (x + 3, 20, 4), 'wood_dk')
    for y in range(-18, 20, 9):
        P.box((-28, y - 3, 4), (28, y + 3, 6), 'wood', bevel=0.4)
    return P


def crate(s):
    P = Part('crate' + str(s))
    P.box((-s / 2, -s / 2, 0), (s / 2, s / 2, s), 'wood', bevel=0.8,
          sides={k: ('reg', 'crate') for k in ('-y', '+y', '-x', '+x', '+z')})
    return P


def bollard():
    P = Part('bollard')
    P.cyl((0, 0, 0), 10, 3, 'steel_dk', seg=12)
    P.cyl((0, 0, 3), 6, 14, 'steel_dk', seg=12, r2=7)
    P.cyl((0, 0, 17), 10, 4, 'steel_dk', seg=12, r2=9)
    P.cyl((0, 0, 21), 6, 1.5, 'steel', seg=12)
    return P


def elecbox():
    P = Part('elecbox')
    P.box((-22, -10, 0), (22, 10, 4), 'concrete_dk')
    P.box((-20, -9, 4), (20, 9, 62), 'pipe_green', bevel=1.2)
    P.box((-0.5, -9.4, 8), (0.5, -9, 58), 'black')
    P.box((-12, -9.6, 40), (-4, -9.0, 48), ('reg', 'hazard', (0, 0, 0.25, 1)))
    P.box((-20.5, -10, 62), (20.5, 10, 64.5), 'steel', bevel=0.8)
    P.box((10, -9.6, 52), (14, -9.2, 55), 'led_green')
    return P


def ac_unit():
    P = Part('ac')
    P.box((-16, -20, 0), (16, 0, 18), 'ac', bevel=1)
    P.front(-1, 2, 14, 16, -20.05, ('reg', 'acgrille'))
    for x in (-13, 13):
        P.beam((x, 0, -8), (x, -18, 0), 1.6, 1.6, 'steel_dk')
    return P


def tree():
    P = Part('tree')
    P.box((-20, -20, 0), (20, 20, 14), 'concrete', bevel=1.5)
    P.box((-17, -17, 14), (17, 17, 14.5), 'soil')
    P.cyl((0, 0, 14), 3, 70, 'wood_dk', seg=7, r2=2)
    P.rod((0, 0, 60), (12, -4, 84), 1.4, 'wood_dk', seg=5)
    P.rod((0, 0, 70), (-10, 3, 92), 1.4, 'wood_dk', seg=5)
    blobs = [((0, 0, 104), 26, 'leaf'), ((-16, 4, 92), 18, 'leaf_dk'), ((15, -4, 94), 19, 'leaf'),
             ((4, -8, 118), 16, 'leaf_lt'), ((-6, 8, 120), 15, 'leaf_dk')]
    for i, (c, r, sw) in enumerate(blobs):
        P.ico(c, r, sw, sub=1, sc=(1, 0.9, 0.85), seed=i, jitter=0.12)
    return P


def tire():
    P = Part('tire')
    P.cyl((0, 0, 0), 13, 7, 'tire', axis='y', seg=12, cap='black')
    P.rod((0, 3.5, 12), (0, 3.5, 30), 0.8, 'rope', seg=4)
    return P


def build():
    parts = [lamp('lamp_town', 'town'), lamp('lamp_dock', 'dock'), lamp('lamp_fact', 'fact'),
             sign_frame_h(), sign_frame_v(), vending('red'), vending('blue'), trash_bin(), dumpster('g'), dumpster('b'),
             boxes(1), boxes(2), hydrant(), cone(), barrier(), jersey('stripe'), jersey('plain'), bench(), phone_booth(),
             manhole(), drain(), puddle(0), puddle(1), puddle(2), zebra(), lane_dash(),
             drum('r'), drum('y'), drum('b'), pallet(), crate(26), crate(34), bollard(), elecbox(), ac_unit(), tree(), tire()]
    return parts
