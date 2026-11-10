"""Factory kit -> priv/www/assets/scene/factory.glb
Industrial walls with pipe runs, a fenced tank yard, a smokestack and the VOLTEX boss gate.
"""
import math, random
import bpy, bmesh
from mathutils import Matrix, Vector
from nklib import Part, resolve
import bld
from kit_town import sidewalk


def pipe_run(P, x0, x1, z, r, sw, y=-14, flange=90):
    P.rod((x0, y, z), (x1, y, z), r, sw, seg=10)
    x = x0 + 30
    while x < x1 - 10:
        P.cyl((x - 2, y, z), r + 2.2, 4, sw, axis='x', seg=10)
        P.box((x + 10 - 2, y, z - r - 18), (x + 10 + 2, 0, z - r), 'steel_dk')
        P.box((x + 10 - 2, y - 2, z - r - 2), (x + 10 + 2, y + 2, z - r), 'steel_dk')
        x += flange


def elbow_down(P, x, z, r, sw, y=-14, zend=0):
    P.ico((x, y, z), r * 1.15, sw, sub=1)
    P.rod((x, y, z), (x, y, zend), r, sw, seg=10)
    P.cyl((x, y, zend + 30), r + 2.2, 4, sw, seg=10)


def valve(P, x, y, z, r=9):
    P.rod((x, y, z), (x, y - 8, z), 1.2, 'steel_dk', seg=5)
    for k in range(10):
        a0, a1 = k / 10 * 2 * math.pi, (k + 1) / 10 * 2 * math.pi
        P.rod((x + math.cos(a0) * r, y - 8, z + math.sin(a0) * r), (x + math.cos(a1) * r, y - 8, z + math.sin(a1) * r), 1.1, 'neon_red' if False else 'pipe_red', seg=4)
    P.rod((x - r, y - 8, z), (x + r, y - 8, z), 0.8, 'pipe_red', seg=4)


def fwall_a():
    P = Part('fw_a')
    w, d, H = 380, 180, 300
    hw = w / 2
    P.box((-hw, 0, 0), (hw, d, H), 'f_wall2', sides={'+z': 'f_roof', '-x': 'f_wall2', '+x': 'f_wall2'})
    bld.tiled(P, -hw, 14, hw, 120, -0.2, 'panel_conc', tile=95)
    bld.tiled(P, -hw, 120, hw, H - 12, -0.2, 'panel_rust', tile=95)
    bld.tiled(P, -hw, 0, hw, 14, -0.4, 'hazard', tile=120)
    for i in range(5):
        x = -hw + i * w / 4
        x = min(max(x, -hw + 5), hw - 5)
        P.box((x - 6, -8, 0), (x + 6, 0, H), 'f_trim', bevel=1.2)
    P.box((-hw - 3, -9, H - 12), (hw + 3, 0, H), 'f_trim', bevel=1.5)
    for i in range(4):   # strip windows per bay
        bx0 = -hw + i * w / 4 + 12
        P.box((bx0 - 2, -3, 206), (bx0 + w / 4 - 22, 0, 240), 'steel_dk')
        P.front(bx0, 208, bx0 + w / 4 - 24, 238, -3.1, ('reg', 'hiwin_amber', (0.25 * (i % 2), 0, 0.25 * (i % 2) + 0.75, 1)))
    # furnace hatch with glow
    P.box((-150, -6, 24), (-50, 0, 100), 'steel_dk', bevel=1.5)
    P.box((-144, -6.4, 30), (-56, -6, 94), 'furnace')
    for x in range(-140, -55, 10):
        P.box((x, -9, 30), (x + 3, -6, 94), 'steel_dk')
    P.anchor('furnace', (-100, -10, 62), w=100, h=70, col='#ff7a1a')
    # pipes
    pipe_run(P, -hw, hw, 150, 9, 'pipe_grey')
    pipe_run(P, -hw, hw - 40, 176, 5, 'pipe_red', y=-10, flange=120)
    elbow_down(P, hw - 40, 176, 5, 'pipe_red', y=-10)
    elbow_down(P, 90, 150, 9, 'pipe_grey', y=-30, zend=0)
    P.rod((90, -14, 150), (90, -30, 150), 9, 'pipe_grey', seg=10)
    valve(P, 90, -30 - 9, 70)
    # catwalk + door
    P.box((10, -40, 108), (150, -2, 111), 'steel_dk', sides={'+z': ('reg', 'grate')})
    bld.railing(P, 12, 148, -38, 111, h=30, sw='hazard_y', step=14)
    for x in (20, 140):
        P.beam((x, -1, 80), (x, -36, 108), 2, 2, 'steel_dk')
    P.box((40, -3, 111), (80, 0, 196), 'steel_dk', bevel=0.8)
    P.front(44, 150, 76, 186, -3.1, ('reg', 'win7'))
    bld.wall_lamp(P, 100, 196, 'warn_lamp')
    # vents + electrical
    for x in (-30, 0):
        P.box((x - 12, -4, 40), (x + 12, 0, 70), 'steel', bevel=0.8, sides={'-y': ('reg', 'grate')})
    P.box((140, -4, 20), (176, 0, 60), 'pipe_green', bevel=1)
    P.box((150, -4.6, 40), (164, -4, 52), ('reg', 'hazard_v', (0, 0, 1, 0.3)))
    P.box((-120, -10, 254), (40, 0, 282), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    P.anchor('sign_h', (-40, -10.6, 268), w=150, h=24)
    P.props = dict(w=float(w), kind='facade', zone='fact', h=float(H))
    return P


def fwall_b():
    P = Part('fw_b')
    w, d, H = 340, 160, 260
    hw = w / 2
    P.box((-hw, 0, 0), (hw, d, H), 'f_wall1', sides={'+z': 'f_roof'})
    bld.tiled(P, -hw, 0, hw, H - 14, -0.2, 'brick_red', tile=85)
    P.box((-hw - 3, -9, H - 14), (hw + 3, 0, H), 'f_trim', bevel=1.5)
    for x in (-hw, hw - 12):
        P.box((x, -8, 0), (x + 12, 0, H), 'f_conc', bevel=1)
    # big sliding door
    x0, x1, dh = -120, 60, 210
    P.box((x0, -4, 0), (x1, 0, dh), 'steel', bevel=1)
    for z in range(16, dh - 4, 22):
        P.box((x0 + 4, -6, z), (x1 - 4, -4, z + 4), 'steel_lt')
    P.box(((x0 + x1) / 2 - 1.5, -7, 0), ((x0 + x1) / 2 + 1.5, -4, dh), 'steel_dk')
    bld.tiled(P, x0 + 2, 2, x1 - 2, 18, -6.2, 'hazard', tile=90)
    P.box((x0 - 10, -14, dh), (x1 + 10, 0, dh + 10), 'steel_dk', bevel=1.5)
    for x in (x0 - 10, x1):
        P.box((x, -10, 0), (x + 10, 0, dh), 'steel', sides={'-y': ('reg', 'hazard_v')})
    P.cyl((x0 - 5, -12, dh + 10), 4, 6, 'warn_lamp', seg=10)
    P.anchor('beacon', (x0 - 5, -16, dh + 14), col='#ffa020')
    # chimney behind
    cx, cy = 110, 90
    P.cyl((cx, cy, 0), 26, 640, 'f_conc', seg=16, r2=20)
    for z, c in ((480, 'barrier_r'), (530, 'white'), (580, 'barrier_r')):
        P.cyl((cx, cy, z), 22.5 - (z - 480) * 0.004, 26, c, seg=16)
    for z in range(H, 620, 14):
        P.box((cx - 6, cy - 26.5 + z * 0.0094, z), (cx + 6, cy - 25 + z * 0.0094, z + 1.5), 'steel_dk')
    P.box((cx - 3, cy - 24, 636), (cx + 3, cy - 18, 642), 'led_red')
    P.anchor('blink', (cx, cy - 26, 640), col='#ff2020')
    P.box((120, -4, 120), (150, 0, 150), 'steel', sides={'-y': ('reg', 'grate')})
    bld.drainpipe(P, hw - 20, 0, H, 'rust_dk')
    P.box((-150, -10, 226), (-20, 0, 250), 'sign_box', bevel=1.5, sides={'-y': 'sign_back'})
    P.anchor('sign_h', (-85, -10.6, 238), w=120, h=20)
    P.props = dict(w=float(w), kind='facade', zone='fact', h=float(H))
    return P


def tank(P, x, y, r, h, rng):
    P.cyl((x, y, 0), r + 4, 8, 'concrete_dk', seg=20)
    P.cyl((x, y, 8), r, h, 'tank', seg=20)
    for z in range(40, int(h), 50):
        P.cyl((x, y, 8 + z), r + 0.8, 3, 'tank_dk', seg=20)
    P.cyl((x, y, 8 + h), r + 1, 18, 'tank_dk', seg=20, r2=r * 0.25)
    # ladder on the front
    ly = y - r - 3
    for xx in (x + r * 0.35 - 7, x + r * 0.35 + 7):
        P.box((xx - 0.8, ly - 1, 8), (xx + 0.8, ly + 1, 8 + h + 6), 'steel_dk')
    for z in range(16, int(h), 10):
        P.box((x + r * 0.35 - 7, ly - 0.6, 8 + z), (x + r * 0.35 + 7, ly + 0.6, 9.2 + z), 'steel_dk')
    # top rail ring
    n = 16
    for k in range(n):
        a0, a1 = k / n * 2 * math.pi, (k + 1) / n * 2 * math.pi
        p0 = (x + math.cos(a0) * (r - 2), y + math.sin(a0) * (r - 2), 8 + h + 26)
        p1 = (x + math.cos(a1) * (r - 2), y + math.sin(a1) * (r - 2), 8 + h + 26)
        P.rod(p0, p1, 0.8, 'hazard_y', seg=4)
        P.rod((p0[0], p0[1], 8 + h + 4), p0, 0.7, 'hazard_y', seg=4)
    P.front(x - 30, 8 + h * 0.45, x + 30, 8 + h * 0.45 + 18, y - r - 0.5, ('reg', 'hazard'))


def fence(P, x0, x1, y, h=96):
    n = max(1, round((x1 - x0) / 70))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        P.cyl((x, y, 0), 1.8, h, 'steel', seg=6)
        P.rod((x, y, h), (x, y - 12, h + 10), 1, 'steel', seg=4)
    P.box((x0, y - 3, 0), (x1, y + 3, 8), 'concrete_dk', bevel=1)
    for z in (8, h - 2):
        P.rod((x0, y, z), (x1, y, z), 1.2, 'steel', seg=5)
    for i in range(n):
        xa = x0 + (x1 - x0) * i / n
        xb = x0 + (x1 - x0) * (i + 1) / n
        reps = max(1, round((xb - xa) / 32))
        for k in range(reps):
            u0, u1 = xa + (xb - xa) * k / reps, xa + (xb - xa) * (k + 1) / reps
            for zz in range(0, 3):
                z0 = 8 + (h - 10) * zz / 3
                z1 = 8 + (h - 10) * (zz + 1) / 3
                P.quad((u0, y, z0), (u1, y, z0), (u1, y, z1), (u0, y, z1), ('fence', 'fence'))
    for k, off in enumerate((4, 8, 12)):   # barbed wire strands
        P.rod((x0, y - off, h + off * 0.8), (x1, y - off, h + off * 0.8), 0.5, 'steel_lt', seg=3)


def tank_yard():
    P = Part('yard')
    rng = random.Random(5)
    w, d = 440, 300
    hw = w / 2
    P.box((-hw, 0, -2), (hw, d, 3.0), 'f_conc')
    for i in range(4):
        P.floor(-hw + i * w / 4 + 1, 1, -hw + (i + 1) * w / 4 - 1, d - 1, 3.05, ('reg', 'panel_conc'))
    P.box((-hw, d, 0), (hw, d + 20, 170), 'f_wall2', sides={'-y': 'f_wall2'})
    bld.tiled(P, -hw, 0, hw, 160, d - 0.2, 'panel_rust', tile=110)
    tank(P, -90, 170, 72, 190, rng)
    tank(P, 120, 150, 54, 150, rng)
    P.rod((-90 + 72, 140, 60), (120 - 54, 140, 60), 6, 'pipe_yel', seg=8)
    P.rod((-90, 98, 30), (-90, 40, 30), 7, 'pipe_green', seg=8)
    P.ico((-90, 40, 30), 8, 'pipe_green')
    P.rod((-90, 40, 30), (-90, 40, 0), 7, 'pipe_green', seg=8)
    fence(P, -hw + 4, hw - 4, -4)
    P.box((-30, -6.5, 40), (30, -5.2, 70), 'white', sides={'-y': ('reg', 'stripe_rw')})
    P.anchor('sign_h', (0, -8, 82), w=90, h=18, small=1)
    P.props = dict(w=float(w), kind='yard', zone='fact', h=270.0)
    return P


def text_part(P, txt, size, center, ext, sw_front, sw_side, italic=0.18, spacing=1.05):
    """extruded text mesh (Blender's built-in font) centred at `center`, facing -y"""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = txt
    cu.size = size
    cu.extrude = ext
    cu.space_character = spacing
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.shear = italic
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    rf, rs = resolve(sw_front), resolve(sw_side)
    # text lies in XY with +Z normal for the front: rotate so it stands up facing -y
    M = Matrix.Translation(Vector(center)) @ Matrix.Rotation(math.radians(90), 4, 'X')

    def uvf(f, co):
        r = rf if f.normal.z > 0.9 else rs
        return r[1], r[2]
    P.add_bm(bm, M, uvf)


def boss_gate():
    P = Part('gate')
    hw = 280
    # pillars
    for s in (-1, 1):
        x0 = s * hw - 26 if s > 0 else -hw - 26
        x0 = hw - 26 if s > 0 else -hw - 26
        P.box((x0, -16, 0), (x0 + 52, 40, 330), 'steel_dk', bevel=2.5)
        bld.tiled(P, x0 + 6, 20, x0 + 46, 300, -16.2, 'hazard_v', tile=70)
        P.box((x0 - 4, -20, 330), (x0 + 56, 44, 342), 'steel', bevel=2)
        P.cyl((x0 + 26, 0, 342), 7, 10, 'warn_lamp', seg=10)
        P.anchor('beacon', (x0 + 26, -8, 350), col='#ff3020')
        P.box((x0 + 10, -18, 220), (x0 + 42, -16.4, 240), ('reg', 'screen'))
        P.box((x0 - 6, -22, 0), (x0 + 58, 44, 10), 'concrete_dk', bevel=1.5)
    # top beam
    P.box((-hw + 26, -12, 286), (hw - 26, 30, 330), 'steel_dk', bevel=2)
    bld.tiled(P, -hw + 30, 296, hw - 30, 320, -12.2, 'hazard', tile=130)
    P.rod((-hw + 30, -14, 282), (hw - 30, -14, 282), 3, 'pipe_yel', seg=6)
    # door leaves
    for s in (-1, 1):
        xa, xb = (-hw + 26, -1) if s < 0 else (1, hw - 26)
        P.box((xa, -4, 0), (xb, 6, 286), 'f_wall1', bevel=1)
        for z in range(30, 280, 30):
            P.box((xa + 6, -7, z), (xb - 6, -4, z + 6), 'steel', bevel=0.8)
        for x in (xa + 20, xb - 26):
            P.box((x, -8, 10), (x + 6, -4, 276), 'steel_dk')
        bld.tiled(P, xa + 2, 2, xb - 2, 26, -4.2, 'hazard', tile=126)
        P.box((xa + (xb - xa) * 0.35, -9, 120), (xa + (xb - xa) * 0.65, -7, 128), 'neon_red')
    P.box((-3, -9, 0), (3, -4, 286), 'black')
    # VOLTEX letters on a backing board above the beam
    P.box((-160, -6, 334), (160, 20, 406), 'sign_back', bevel=2)
    for x in (-150, 150):
        P.box((x - 3, -8, 330), (x + 3, 0, 410), 'steel')
    P.box((-162, -8, 404), (162, 0, 408), 'neon_pink')
    P.box((-162, -8, 332), (162, 0, 336), 'neon_pink')
    text_part(P, 'VOLTEX', 62, (0, -7, 370), 3.5, 'neon_pink', 'sign_box')
    P.anchor('gatesign', (0, -12, 370), w=320, h=72, col='#ff2bd6')
    P.props = dict(w=float(2 * hw + 60), kind='gate', zone='fact', h=410.0)
    return P


def stack():
    P = Part('stack')
    P.cyl((0, 0, 0), 34, 900, 'f_conc', seg=16, r2=24)
    for z in (700, 760, 820):
        P.cyl((0, 0, z), 28.5 - (z - 700) * 0.006, 30, 'barrier_r' if z != 760 else 'white', seg=16)
    P.box((-4, -30, 880), (4, -22, 888), 'led_red')
    P.anchor('blink', (0, -32, 884), col='#ff2020')
    P.props = dict(w=70.0, kind='stack', zone='fact', h=900.0)
    P.matmap = {'atlas': 'far'}
    return P


def build():
    return [fwall_a(), fwall_b(), tank_yard(), boss_gate(), stack(), sidewalk('walk_fact', 90, 86, 'slab_fact')]
