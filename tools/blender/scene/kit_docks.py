"""Docks kit -> priv/www/assets/scene/docks.glb
Warehouses (front plane y=0), an open quay module (concrete apron behind the facade line that
ends at the water), shipping containers, a jib crane, a fish stall, a moored boat, sidewalk.
"""
import math, random
from mathutils import Matrix, Vector
from nklib import Part
import bld
from kit_town import sidewalk


def corrugated(P, x0, x1, z0, z1, sw, pitch=12, y=0.0):
    x = x0 + pitch / 2
    while x < x1 - 2:
        P.box((x - 2.5, y - 1.6, z0), (x + 2.5, y, z1), sw)
        x += pitch


def gable(P, x0, x1, d, H, rise, sw, over=6):
    P.extrude([(-over, H), (d + over, H), (d / 2, H + rise)], x0 - over, x1 + over, sw)
    P.box((x0 - over - 1, -over - 2, H - 4), (x1 + over + 1, -over + 2, H + 1), 'steel_dk')   # gutter


def roll_door(P, x0, x1, h, reg='shutter_plain'):
    P.box((x0, -3, 0), (x1, 0, h), 'steel', sides={'-y': ('reg', reg)})
    P.box((x0 - 6, -12, h), (x1 + 6, 0, h + 14), 'steel', bevel=2)
    for x in (x0 - 8, x1):
        P.box((x, -7, 0), (x + 8, 0, h), 'steel', sides={'-y': ('reg', 'hazard_v')})
    P.box((x0 - 10, -26, 0), (x0 - 2, -6, 14), 'rubber', bevel=1)
    P.box((x1 + 2, -26, 0), (x1 + 10, -6, 14), 'rubber', bevel=1)


def warehouse_a():
    P = Part('wh_a')
    w, d, H = 440, 200, 210
    hw = w / 2
    P.box((-hw, 0, 0), (hw, d, H), 'k_wall1', sides={'-x': 'k_wall3', '+x': 'k_wall3'})
    corrugated(P, -hw + 8, hw - 8, 22, H - 6, 'k_wall2')
    P.box((-hw, -4, 0), (hw, 0, 22), 'concrete_dk', bevel=1.2)
    for x in (-hw, hw - 10):
        P.box((x, -6, 0), (x + 10, 0, H), 'k_trim', bevel=1)
    gable(P, -hw, hw, d, H, 46, 'k_roof')
    roll_door(P, -150, -30, 150)
    P.box((-170, -10, 168), (-10, 0, 196), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    P.anchor('sign_h', (-90, -10.6, 182), w=150, h=24)
    # personnel door + lamp
    P.box((40, -3, 0), (80, 0, 104), 'steel_dk', bevel=0.8)
    P.front(44, 4, 76, 98, -3.1, ('reg', 'win8'))
    bld.wall_lamp(P, 60, 112, 'lamp_cool')
    # high window strip
    for x0 in range(100, int(hw) - 40, 64):
        P.box((x0 - 2, -3, 150), (x0 + 58, 0, 182), 'steel_dk')
        P.front(x0, 152, x0 + 56, 180, -3.1, ('reg', 'hiwin_cyan', (0, 0, 0.5, 1)))
    bld.drainpipe(P, hw - 22, 0, H, 'steel_dk')
    bld.drainpipe(P, -hw + 22, 0, H, 'steel_dk')
    P.box((100, -14, 0), (190, 0, 12), 'concrete', bevel=1)            # loading step
    bld.wall_lamp(P, -90, 210 - 10, 'lamp_cool')
    P.props = dict(w=float(w), kind='facade', zone='docks', h=float(H + 46))
    return P


def warehouse_b():
    P = Part('wh_b')
    w, d, H = 360, 180, 230
    hw = w / 2
    P.box((-hw, 0, 0), (hw, d, H), 'k_wall2', sides={'+z': 'k_roof', '-x': 'k_wall3', '+x': 'k_wall3'})
    bld.tiled(P, -hw + 10, 0, hw - 10, 110, -0.2, 'brick_red', tile=88)
    corrugated(P, -hw + 10, hw - 10, 118, H - 16, 'k_wall4', pitch=10)
    P.box((-hw, -6, 108), (hw, 0, 118), 'k_trim', bevel=1.5)
    P.box((-hw - 3, -8, H - 16), (hw + 3, 0, H), 'k_trim', bevel=1.5)
    for x in (-hw, hw - 10):
        P.box((x, -6, 0), (x + 10, 0, H - 16), 'k_trim', bevel=1)
    roll_door(P, -140, -50, 96, 'shutter_b')
    roll_door(P, 20, 110, 96, 'shutter_plain')
    # canopy over the doors
    P.box((-160, -40, 120), (130, 0, 125), 'steel_dk', bevel=1, sides={'+z': ('reg', 'grate')})
    for x in (-150, -10, 120):
        P.beam((x, -1, 150), (x, -38, 125), 2, 2, 'steel_dk')
    P.box((-150, -41, 118), (120, -39.6, 120), 'lamp_cool')
    P.anchor('walllight', (-15, -40, 118), col='#bff4ff')
    P.box((-120, -10, 160), (80, 0, 196), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    P.anchor('sign_h', (-20, -10.6, 178), w=190, h=28)
    for x in (130, 160):
        P.box((x - 10, -3, 150), (x + 10, 0, 190), 'steel', sides={'-y': ('reg', 'grate')})
    for x in (-120, 0, 120):   # roof vents
        P.cyl((x, 60, H), 9, 22, 'steel', seg=10)
        P.cyl((x, 60, H + 22), 13, 6, 'steel_dk', seg=10, r2=4)
    P.props = dict(w=float(w), kind='facade', zone='docks', h=float(H + 28))
    return P


def quay(w=400, d=220):
    """open apron behind the facade line; the water starts at y = d"""
    P = Part('quay')
    hw = w / 2
    P.box((-hw, 0, -40), (hw, d, 3.0), 'k_quay')
    bld_tiles = 4
    for i in range(bld_tiles):
        for j in range(2):
            x0 = -hw + w * i / bld_tiles
            y0 = d * j / 2
            P.floor(x0 + 1, y0 + 1, x0 + w / bld_tiles - 1, y0 + d / 2 - 1, 3.05, ('reg', 'panel_conc'))
    P.box((-hw, d - 12, 3), (hw, d, 7), 'k_quay_edge', bevel=1)
    P.floor(-hw, d - 22, hw, d - 18, 3.1, 'paint_y')
    for x in (-hw + 60, hw - 60):
        P.extend(_bollard(), Matrix.Translation((x, d - 30, 3)))
    P.props = dict(w=float(w), kind='quay', zone='docks', h=0.0, water=float(d))
    return P


def _bollard():
    P = Part('b')
    P.cyl((0, 0, 0), 10, 3, 'steel_dk', seg=12)
    P.cyl((0, 0, 3), 6, 14, 'steel_dk', seg=12, r2=7)
    P.cyl((0, 0, 17), 10, 4, 'steel_dk', seg=12, r2=9)
    return P


def container(col):
    P = Part('ct_' + col)
    L, D, H = 150, 60, 64
    sw = 'ct_' + col
    P.box((-L / 2, -D / 2, 0), (L / 2, D / 2, H), sw, sides={'+x': ('reg', 'ct_door_' + col), '-x': ('reg', 'ct_door_' + col)})
    x = -L / 2 + 8
    while x < L / 2 - 6:
        P.box((x - 2, -D / 2 - 1.2, 4), (x + 2, -D / 2, H - 4), sw)
        P.box((x - 2, D / 2, 4), (x + 2, D / 2 + 1.2, H - 4), sw)
        x += 8
    for xx in (-L / 2, L / 2 - 4):   # corner posts
        for yy in (-D / 2 - 1.5, D / 2 - 2.5):
            P.box((xx, yy, 0), (xx + 4, yy + 4, H), 'steel_dk')
    for zz in (0, H - 4):
        P.box((-L / 2, -D / 2 - 1.6, zz), (L / 2, -D / 2 + 1, zz + 4), sw, bevel=0.5)
    P.box((-L / 2 + 10, -D / 2 - 1.5, H - 18), (-L / 2 + 40, -D / 2 - 1.2, H - 10), 'white')   # label plate
    P.props = dict(w=float(L), kind='container', zone='docks', h=float(H))
    return P


def crane():
    P = Part('crane')
    sw, sw2 = 'crane_yel', 'steel_dk'
    # portal legs
    for x in (-60, 60):
        for y in (-40, 40):
            P.beam((x, y, 0), (x * 0.8, y * 0.7, 230), 8, 8, sw)
        P.beam((x, -40, 40), (x, 40, 40), 5, 5, sw)
        P.box((x - 14, -50, 0), (x + 14, 50, 10), sw2, bevel=1)
    P.beam((-60, -40, 120), (60, -40, 120), 5, 5, sw)
    P.box((-56, -32, 228), (56, 32, 244), sw, bevel=1.5)
    # turret + cabin
    P.cyl((0, 0, 244), 22, 16, sw2, seg=14)
    P.box((-30, -28, 260), (50, 28, 300), sw, bevel=2)
    P.box((-30, -29, 272), (10, -28, 294), 'glass_lit')
    P.box((50, -18, 260), (80, 18, 296), 'steel_dk', bevel=1.5)            # counterweight
    P.box((-28, -18, 300), (20, 18, 340), sw, bevel=1)                      # A-frame base
    # lattice jib (towards -x, rising)
    a = math.radians(24)
    L = 330
    base = Vector((-28, 0, 300))
    tip = base + Vector((-L * math.cos(a), 0, L * math.sin(a)))
    for yy in (-10, 10):
        P.beam(base + Vector((0, yy, 0)), tip + Vector((0, yy * 0.4, 0)), 3.2, 3.2, sw)
        P.beam(base + Vector((0, yy, 22)), tip + Vector((0, yy * 0.4, 6)), 2.4, 2.4, sw)
    n = 12
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        p0 = base.lerp(tip, t0)
        p1 = base.lerp(tip, t1)
        P.beam(p0 + Vector((0, -10 * (1 - 0.6 * t0), 0)), p1 + Vector((0, -10 * (1 - 0.6 * t1), 22 - 16 * t1)), 1.6, 1.6, sw)
        P.beam(p0 + Vector((0, 10 * (1 - 0.6 * t0), 22 - 16 * t0)), p1 + Vector((0, 10 * (1 - 0.6 * t1), 0)), 1.6, 1.6, sw)
    P.rod((-4, 0, 340), tip + Vector((0, 0, 6)), 0.8, 'steel', seg=4)
    P.rod((-4, 0, 340), (60, 0, 296), 0.8, 'steel', seg=4)
    hook = tip + Vector((12, 0, 0))
    P.rod(hook, hook - Vector((0, 0, 170)), 0.5, 'black', seg=4)
    P.box(hook - Vector((5, 4, 186)), hook - Vector((-5, -4, 170)), 'crane_red', bevel=1)
    P.box(tip - Vector((2, 2, -6)), tip + Vector((2, 2, 10)), 'led_red')
    P.anchor('blink', tuple(tip + Vector((0, -3, 9))), col='#ff2020')
    P.anchor('blink', (0, -30, 344), col='#ff2020')
    P.props = dict(w=240.0, kind='crane', zone='docks', h=float(tip.z))
    return P


def fish_stall():
    P = Part('stall')
    P.box((-70, -34, 0), (70, 0, 40), 'wood', bevel=1, sides={'-y': ('reg', 'wood')})
    P.box((-72, -36, 40), (72, 2, 44), 'wood_dk', bevel=0.8)
    for i, x in enumerate(range(-60, 61, 30)):
        P.box((x - 13, -32, 44), (x + 13, -6, 52), 'white', bevel=1)
        P.box((x - 11, -30, 51), (x + 11, -8, 52.4), ['led_blue', 'concrete_lt', 'neon_orange', 'led_blue', 'concrete_lt'][i % 5]
              if i % 2 == 0 else 'steel_lt')
    for x in (-70, 70):
        P.box((x - 2, -38, 0), (x + 2, -34, 120), 'steel_dk')
        P.box((x - 2, -2, 0), (x + 2, 2, 132), 'steel_dk')
    M = Matrix.Translation((0, 0, 134)) @ Matrix.Rotation(math.radians(12), 4, 'X')
    P.box((-80, -50, -2), (80, 4, 0), 'aw_navy', M=M, sides={'+z': ('reg', 'aw_navy'), '-z': 'dark'})
    for x in (-40, 40):
        P.rod((x, -40, 116), (x, -40, 108), 0.4, 'black', seg=3)
        P.ico((x, -40, 101), 7, 'neon_orange', sub=1, sc=(1, 1, 1.25))
        P.anchor('walllight', (x, -44, 96), col='#ff8a40')
    P.box((-50, -4, 130), (50, 2, 152), 'sign_box', bevel=1, sides={'-y': 'sign_back'})
    P.anchor('sign_h', (0, -4.6, 141), w=96, h=18)
    for i, x in enumerate((-90, -82, 84)):
        P.box((x - 13, -26, 0 + (i == 1) * 26), (x + 13, 0, 26 + (i == 1) * 26), 'wood', bevel=0.6,
              sides={'-y': ('reg', 'crate'), '+z': ('reg', 'crate')})
    P.props = dict(w=200.0, kind='stall', zone='docks', h=152.0)
    return P


def boat():
    P = Part('boat')
    prof = [(-26, 6), (26, 6), (34, 38), (-34, 38)]
    P.extrude(prof, -110, 90, 'white', sides=[None, 'ct_blue', 'white', 'ct_blue'])
    P.extrude([(-26, 6), (0, -4), (26, 6), (34, 38), (-34, 38)], 90, 130, 'white')
    P.box((-110, -36, 38), (130, 36, 42), 'wood_dk')
    P.box((-60, -22, 42), (20, 22, 80), 'white', bevel=2)
    for x in range(-54, 14, 18):
        P.box((x, -22.6, 56), (x + 12, -22, 72), 'glass_lit')
    P.box((-64, -26, 80), (24, 26, 84), 'ct_blue', bevel=1)
    P.rod((-20, 0, 84), (-20, 0, 190), 1.6, 'steel', seg=6)
    P.rod((-20, 0, 170), (110, 0, 46), 0.4, 'steel', seg=3)
    P.rod((-20, 0, 170), (-100, 0, 44), 0.4, 'steel', seg=3)
    P.box((-23, -3, 188), (-17, 3, 194), 'lamp_warm')
    P.anchor('walllight', (-20, -6, 190), col='#ffe0a0')
    P.props = dict(w=240.0, kind='boat', zone='docks', h=190.0)
    return P


def light_mast():
    P = Part('mast')
    P.box((-10, -10, 0), (10, 10, 8), 'concrete_dk', bevel=1)
    P.cyl((0, 0, 8), 5, 330, 'steel', seg=8, r2=3)
    P.box((-30, -6, 330), (30, 6, 336), 'steel_dk')
    for x in (-24, -8, 8, 24):
        M = Matrix.Translation((x, -6, 340)) @ Matrix.Rotation(math.radians(-35), 4, 'X')
        P.box((-6, -4, -6), (6, 4, 6), 'steel_lt', bevel=1, M=M)
        P.box((-5, -4.6, -5), (5, -4, 5), 'lamp_cool', M=M)
    P.anchor('flood', (0, -12, 336), col='#d8f6ff')
    P.props = dict(w=60.0, kind='mast', zone='docks', h=346.0)
    return P


def build():
    return [warehouse_a(), warehouse_b(), quay(), container('red'), container('blue'), container('yellow'),
            container('green'), crane(), fish_stall(), boat(), light_mast(), sidewalk('walk_dock', 100, 86, 'slab_dock')]
