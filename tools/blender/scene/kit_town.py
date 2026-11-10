"""Downtown kit -> priv/www/assets/scene/town.glb
Modular facades (front plane y=0, x centred, ground z=0, body extends to +y), an alley gap,
mid-ground towers and a sidewalk segment.  Custom props: w (width), kind, zone.
Anchors (child empties): sign_h / sign_v / billboard (procedural neon text goes there),
shoplight / walllight (light pools), blink (antenna LEDs).
"""
import math, random
from mathutils import Matrix, Vector
from nklib import Part
import bld

GF, FH, PARA, DEPTH = 150, 108, 24, 140
SHOP_COL = {'shop_mart': '#cfe8ff', 'shop_ramen': '#ffb070', 'shop_arcade': '#d070ff', 'shop_laundry': '#9ff0e0'}


def shopfront(P, x0, x1, rng, shop, awning, trim):
    """display window + door + sign board (+ awning) between x0 and x1"""
    door_w = 40
    door_left = rng.random() < 0.5
    dx0, dx1 = (x0, x0 + door_w) if door_left else (x1 - door_w, x1)
    wx0, wx1 = (dx1 + 6, x1) if door_left else (x0, dx0 - 6)
    P.box((wx0 - 3, -4, 0), (wx1 + 3, 0, 14), 'dark2', bevel=1)                   # bulkhead
    P.front(wx0, 14, wx1, 112, -1.2, ('reg', shop))                             # display window
    P.box((wx0 - 3, -4, 112), (wx1 + 3, 0, 116), 'steel_dk')
    n = max(1, round((wx1 - wx0) / 64))
    for i in range(n + 1):
        xm = wx0 + (wx1 - wx0) * i / n
        P.box((xm - 1.6, -3.4, 14), (xm + 1.6, 0, 112), 'steel_dk')
    # door
    P.box((dx0 - 3, -3, 0), (dx1 + 3, 0, 112), 'steel_dk', bevel=0.6)
    P.front(dx0 + 2, 2, dx1 - 2, 106, -3.1, ('reg', 'win1'))
    P.box((dx0 + 2, -4.6, 2), (dx1 - 2, -3.1, 4), 'steel')
    P.box(((dx0 + dx1) / 2 - 1, -5.5, 50), ((dx0 + dx1) / 2 + 1, -3.1, 64), 'chrome')
    # sign board above
    P.box((x0 - 6, -9, 118), (x1 + 6, 0, 146), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    P.anchor('sign_h', ((x0 + x1) / 2, -9.6, 132), w=x1 - x0 + 4, h=24)
    P.anchor('shoplight', ((wx0 + wx1) / 2, -2, 60), w=wx1 - wx0, col=SHOP_COL[shop])
    if awning:
        a = math.radians(20)
        L = 48
        M = Matrix.Translation((0, 0, 117)) @ Matrix.Rotation(a, 4, 'X')
        P.box((wx0 - 6, -L, -3), (wx1 + 6, 0, 0), 'aw_' + awning.split('_')[1], M=M,
              sides={'+z': ('reg', awning), '-z': 'dark'})
        ty, tz = -L * math.cos(a), 117 - L * math.sin(a)
        P.box((wx0 - 6, ty - 1.2, tz - 11), (wx1 + 6, ty + 0.8, tz), 'aw_' + awning.split('_')[1],
              sides={'-y': ('reg', awning, (0, 0, 1, 0.5))})
        for xx in (wx0 - 4, wx1 + 4):
            P.rod((xx, -1, 140), (xx, ty + 2, tz + 1), 0.8, 'steel_dk', seg=4)


def shutterfront(P, x0, x1, rng, reg):
    P.box((x0, -3, 0), (x1, 0, 112), 'steel', sides={'-y': ('reg', reg)})
    P.box((x0 - 5, -11, 112), (x1 + 5, 0, 126), 'steel', bevel=2)
    for x in (x0 - 3, x1 + 3):
        P.box((x - 2.5, -5, 0), (x + 2.5, 0, 112), 'steel_dk')
    P.box((x0 - 6, -9, 126), (x1 + 6, 0, 146), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    P.anchor('sign_h', ((x0 + x1) / 2, -9.6, 136), w=x1 - x0 + 4, h=18)
    bld.wall_lamp(P, (x0 + x1) / 2, 100, 'lamp_cool')


def lobby(P, x0, x1, rng, trim):
    cx = (x0 + x1) / 2
    P.box((x0, -14, 0), (x1, 0, 3), 'concrete_lt', bevel=0.8)                     # step
    P.box((cx - 34, -3, 3), (cx + 34, 0, 118), 'steel_dk', bevel=0.8)
    P.front(cx - 31, 6, cx - 1, 112, -3.1, ('reg', 'win0'))
    P.front(cx + 1, 6, cx + 31, 112, -3.1, ('reg', 'win0'))
    P.box((cx - 46, -26, 120), (cx + 46, 0, 126), trim, bevel=1.5)               # canopy
    P.box((cx - 30, -26.6, 121), (cx + 30, -26, 125), 'neon_purple')
    for x in (cx - 42, cx + 42):
        P.rod((x, -24, 126), (x, -2, 150), 0.8, 'steel_dk', seg=4)
    P.box((cx + 40, -2, 50), (cx + 52, 0, 70), 'steel', bevel=0.5)                # intercom
    P.box((cx + 43, -2.4, 62), (cx + 49, -2, 67), 'screen')
    for i in range(3):                                                           # posters
        px = x0 + 14 + i * 26
        if px + 22 < cx - 40:
            P.front(px, 40, px + 22, 73, -0.3, ('reg', 'poster%d' % ((i * 3 + int(x0)) % 8)))
    P.anchor('walllight', (cx, -20, 118), col='#c8a0ff')
    P.anchor('sign_v', (x1 - 22, -10, 250), w=34, h=100)


def town(name, w, floors, seed, wall, trim, ground, shop=None, awning=None, fire=None, balcony=None,
         brick=None, ac=0.3, pipe=None, roof=(), vsign=None, dentils=False):
    rng = random.Random(seed)
    P = Part(name)
    H = GF + floors * FH
    hw = w / 2
    # body + parapet + cornice
    P.box((-hw, 0, 0), (hw, DEPTH, H), wall, sides={'+z': 'd_roof', '-x': 'd_side', '+x': 'd_side'})
    P.box((-hw, -2, H), (hw, 8, H + PARA), wall, bevel=1)
    for x0 in (-hw, hw - 8):
        P.box((x0, 8, H), (x0 + 8, DEPTH, H + PARA), wall, sides={'-x': 'd_side', '+x': 'd_side'})
    P.box((-hw, DEPTH - 8, H), (hw, DEPTH, H + PARA), wall)
    P.box((-hw - 3, -5, H + PARA), (hw + 3, 10, H + PARA + 4), trim, bevel=1.5)
    P.box((-hw - 5, -10, H - 14), (hw + 5, 0, H - 3), trim, bevel=2)
    if dentils:
        for x in range(int(-hw + 10), int(hw - 8), 16):
            P.box((x, -6, H - 22), (x + 7, 0, H - 14), trim)
    # pilasters + floor band
    for x0 in (-hw, hw - 14):
        P.box((x0, -6, 0), (x0 + 14, 0, H - 14), trim, bevel=1.2)
    P.box((-hw, -7, GF - 2), (hw, 0, GF + 6), trim, bevel=1.5)
    if brick:
        bld.tiled(P, -hw + 14, GF + 6, hw - 14, H - 14, -0.2, brick, tile=90)
    # ground floor
    gx0, gx1 = -hw + 20, hw - 20
    if ground == 'shop':
        shopfront(P, gx0, gx1, rng, shop, awning, trim)
    elif ground == 'double':
        mid = (gx0 + gx1) / 2
        shopfront(P, gx0, mid - 10, rng, shop[0], awning[0], trim)
        P.box((mid - 10, -6, 0), (mid + 10, 0, GF - 2), trim, bevel=1.2)
        shopfront(P, mid + 10, gx1, rng, shop[1], awning[1], trim)
    elif ground == 'shutter':
        shutterfront(P, gx0, gx1 - 50, rng, shop)
        P.box((gx1 - 40, -3, 0), (gx1, 0, 108), 'steel_dk', bevel=0.6)
        P.front(gx1 - 37, 2, gx1 - 3, 104, -3.1, ('reg', 'win3'))
        P.front(gx1 - 38, 112, gx1 - 6, 140, -0.3, ('reg', 'poster2'))
    elif ground == 'lobby':
        lobby(P, gx0, gx1, rng, trim)
    # upper floors
    fx = None
    if fire:
        fx = (-hw + 24, -hw + 150) if fire == 'left' else (hw - 150, hw - 24)
    for f in range(floors):
        zb = GF + f * FH + 26
        n = max(1, int((w - 70 + 28) / (52 + 28)))
        span = n * 52 + (n - 1) * 28
        for i in range(n):
            x = -span / 2 + 26 + i * 80
            bld.window(P, x, zb, rng, trim)
            if rng.random() < ac and not (fx and fx[0] - 20 < x < fx[1] + 20):
                bld.ac_unit(P, x + rng.choice((-8, 8)), zb - 34, rng)
        if balcony and f in balcony:
            bx0, bx1 = -span / 2 - 6, span / 2 + 6
            P.box((bx0, -32, zb - 12), (bx1, 0, zb - 6), 'concrete', bevel=1)
            bld.railing(P, bx0 + 2, bx1 - 2, -30, zb - 6, h=30, sw=trim, step=9)
            for x in (bx0 + 2, bx1 - 2):
                P.box((x - 1, -30, zb + 24), (x + 1, -1, zb + 26.4), trim)
            P.box((bx0 + 20, -26, zb - 6), (bx0 + 34, -16, zb + 10), 'leaf_dk', bevel=2)
    if fire:
        bld.fire_escape(P, fx[0], fx[1], floors, GF, FH, rng)
    if pipe:
        bld.drainpipe(P, -hw + 18 if pipe == 'left' else hw - 18, 0, H + 4)
    if vsign:
        sx = -hw + 34 if vsign == 'left' else hw - 34
        P.anchor('sign_v', (sx, -10, GF + FH * 0.9 + 20), w=34, h=100)
    # roof items
    for item in roof:
        kind, rx = item[0], item[1]
        if kind == 'tank':
            bld.water_tank(P, rx, 70, H, rng)
        elif kind == 'antenna':
            bld.antenna(P, rx, 40, H, item[2] if len(item) > 2 else 130)
        elif kind == 'dish':
            bld.dish(P, rx, 30, H)
        elif kind == 'billboard':
            bld.billboard(P, rx, 40, H, w=item[2], h=item[3])
        elif kind == 'box':
            bld.roof_box(P, rx, 40, H)
        elif kind == 'hut':
            bld.stair_hut(P, rx, 80, H, wall)
    P.props = dict(w=float(w), kind='facade', zone='down', h=float(H + PARA))
    return P


def alley(name, w=72):
    P = Part(name)
    hw = w / 2
    P.box((-hw, 0, 0), (hw, 96, 2.2), 'concrete_dk', sides={'+z': ('reg', 'slab')})
    P.box((-hw, 96, 0), (hw, 108, 420), 'd_side', sides={'-y': ('reg', 'brick_purple', (0, 0, 1, 1))})
    bld.tiled(P, -hw, 0, hw, 380, 95.7, 'brick_purple', tile=80)
    P.rod((-hw, 40, 210), (hw, 60, 200), 0.6, 'black', seg=4)
    P.rod((-hw, 70, 250), (hw, 30, 240), 0.6, 'black', seg=4)
    P.rod((-hw, 20, 120), (hw, 20, 120), 3.2, 'pipe_grey', seg=8)
    M = Matrix.Translation((0, 60, 0))
    P.box((-12, 86, 130), (12, 96, 138), 'steel_dk', bevel=0.8)
    P.box((-9, 85.4, 131), (9, 86, 137), 'lamp_amber')
    P.anchor('walllight', (0, 80, 130), col='#ffb060')
    P.props = dict(w=float(w), kind='alley', zone='down', h=0.0)
    return P


def tower(name, w, h, seed, body, reg):
    rng = random.Random(seed)
    P = Part(name)
    hw = w / 2
    P.box((-hw, 0, 0), (hw, 160, h), body, sides={'+z': 'd_roof'})
    z = 60
    while z < h - 50:
        for i in range(max(1, round(w / 110))):
            n = max(1, round(w / 110))
            x0 = -hw + 10 + (w - 20) * i / n
            x1 = -hw + 10 + (w - 20) * (i + 1) / n - 6
            if rng.random() < 0.85:
                a = rng.choice((0, 0.25, 0.5))
                P.front(x0, z, x1, z + 26, -0.3, ('reg', reg, (a, 0, a + 0.5, 1)))
        z += 44
    P.box((-hw - 4, -4, h - 8), (hw + 4, 4, h), 'd_trim1')
    P.box((-hw + 6, -0.6, h - 26), (hw - 6, 0, h - 22), 'neon_purple' if seed % 2 else 'neon_cyan')
    bld.antenna(P, hw * 0.4, 60, h, 90)
    P.props = dict(w=float(w), kind='tower', zone='down', h=float(h))
    P.matmap = {'atlas': 'far'}
    return P


def sidewalk(name, slab_w, slab_d, top_sw, length=200, depth=172, top=3.0):
    """sidewalk strip: slabs from the facade (y=0) to the curb (y=-depth) + curb stone with gutter"""
    P = Part(name)
    P.box((-length / 2, -depth, 0), (length / 2, 0, top - 0.8), 'gutter')
    nx, ny = round(length / slab_w), round(depth / slab_d)
    for i in range(nx):
        for j in range(ny):
            x0 = -length / 2 + i * length / nx
            y0 = -depth + j * depth / ny
            off = (slab_w / 2) if (j % 2 and slab_w > 60) else 0
            P.box((x0 + 0.6, y0 + 0.6, 0), (x0 + length / nx - 0.6, y0 + depth / ny - 0.6, top), 'concrete',
                  bevel=0.7, sides={'+z': ('reg', top_sw)})
    # curb stone (8 deep) - its road face drops to 0
    P.box((-length / 2, -depth - 8, 0), (length / 2, -depth + 1, top + 0.3), 'curb', bevel=1.2, sides={'+z': 'curb_top'})
    P.props = dict(w=float(length), kind='walk', zone='all', h=0.0)
    return P


def build():
    parts = [
        town('town_a', 300, 1, 11, 'd_wall1', 'd_trim1', 'shop', shop='shop_ramen', awning='aw_red',
             roof=(('tank', -60), ('antenna', 90, 120), ('box', 20)), pipe='right', vsign='right'),
        town('town_b', 340, 3, 12, 'd_wall2', 'd_trim1', 'shop', shop='shop_mart', fire='right',
             brick='brick_purple', ac=0.4, vsign='left'),
        town('town_c', 260, 2, 13, 'd_wall4', 'd_trim3', 'shutter', shop='shutter_a', balcony=(1,), pipe='left', ac=0.5, dentils=True),
        town('town_d', 400, 1, 14, 'd_wall3', 'd_trim2', 'double', shop=('shop_arcade', 'shop_laundry'),
             awning=('aw_purple', 'aw_teal'), roof=(('billboard', -40, 200, 86), ('dish', 150))),
        town('town_e', 300, 3, 15, 'd_wall6', 'd_trim3', 'lobby', fire='left', brick='brick_red', ac=0.35),
        town('town_f', 320, 2, 16, 'd_wall5', 'd_trim4', 'shop', shop='shop_arcade', awning='aw_navy',
             pipe='left', vsign='right', dentils=True, balcony=(0,)),
        town('town_g', 250, 1, 17, 'd_wall2', 'd_trim2', 'shutter', shop='shutter_b',
             roof=(('hut', -50), ('antenna', 70, 150), ('box', 10)), ac=0.6),
        town('town_h', 280, 2, 18, 'd_wall1', 'd_trim1', 'shop', shop='shop_laundry', awning='aw_teal',
             fire='left', ac=0.3),
        alley('alley'),
        tower('tower_a', 260, 760, 21, 'd_side', 'hiwin_amber'),
        tower('tower_b', 200, 900, 22, 'd_wall4', 'hiwin_cyan'),
        tower('tower_c', 320, 680, 23, 'd_side', 'hiwin_cyan'),
        sidewalk('walk_town', 50, 43, 'slab'),
    ]
    return parts
