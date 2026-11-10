"""Build kai's outfit / hair / headband on the Quaternius male base and export priv/www/assets/kai.glb.

  blender --background --python tools/blender/kai_build.py

Same pipeline as mira_build.py (shared tools in hero_common.py):
  * open red bomber jacket over a white tee: front opening cut with planes, inward lips on every edge,
    ribbed collar folded over at the back of the neck, zipper tape down both front edges, gathered rib
    cuffs and hem (the body above them is bloused out for volume);
  * dark jeans: loose straight legs (lower legs pushed out to a tapered cylinder), turned-up cuffs that
    stack on the sneakers, belt + buckle, outer seams;
  * lofted sneakers (white / red), fingerless gloves over white wrist wraps;
  * hair: the SimpleParted sculpt re-skinned to Head + tapered spiky locks; a modelled headband that
    follows the head/hair surface, a knot at the back and two ribbon tails on new bones
    headband_l1/l2 and headband_r1/r2 (children of Head) for sway.
The armature, bone names and rest pose are left exactly as imported (only the four tail bones are added).
Saves tools/blender/kai.blend and exports the glb (no animations, no images).
Inputs in $HERO_WORK (decode_glb.mjs): male_plain.glb (hero_male.glb), hair_parted.glb (hair/Hair_SimpleParted.glb);
optional T_Superhero_Male_Dark.png (preview-only face texture, extracted from male_plain.glb).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hero_common as hc
from hero_common import *

# toon palette (sRGB hex) -- slot names are what the game looks up (js3d/heroes.js kai.mats)
hc.PALETTE.update({
    'kai_skin': '#c98a62', 'kai_jacket': '#d3262e', 'kai_trim': '#9c1820', 'kai_zipper': '#34363f',
    'kai_tee': '#f2efe8', 'kai_jeans': '#2b3a63', 'kai_seam': '#1f2a4a', 'kai_belt': '#2a2020',
    'kai_buckle': '#cfd4e2', 'kai_shoes': '#f2f2f6', 'kai_sole': '#c8323a', 'kai_accent': '#d3262e',
    'kai_gloves': '#26222a', 'kai_wrap': '#f0f0f0', 'kai_hair': '#1a1216', 'kai_band': '#f4f4f4',
})

H = HeroBuild('kai', WORK + '/male_plain.glb', 'SuperHero_Male', WORK + '/T_Superhero_Male_Dark.png')
arm, body, me0 = H.arm, H.body, H.me

HEM_Z, RIB_Z, TEE_Z, BELT_Z0, WAIST_Z = 0.94, 0.98, 0.955, 0.975, 1.003
ANKLE_Z, SHOE_Z, PCUFF_Z = 0.112, 0.13, 0.158
CUFF_X, SLEEVE_X, GLOVE_X, WRAP_X, KNUCKLE_X = 0.622, 0.652, 0.638, 0.722, 0.836
Z, XN = Vector((0, 0, 1)), Vector((1, 0, 0))


def open_w(z): return 0.055 + 0.12 * (z - 1.0)      # half width of the open front (wider towards the collar)


def plane_y(fn):    # plane z = fn(y) (linear) -> point, normal
    a = fn(0.0); b = fn(1.0) - a
    return Vector((0, 0, a)), Vector((0, -b, 1)).normalized()


# ---- pre-cut the body along every clothing edge
torso = lambda c: abs(c.x) < 0.3 and c.z > 0.6
legs = lambda c: c.z < 0.45
front = lambda c: abs(c.x) < 0.25 and c.y < 0.03 and 0.85 < c.z < 1.5
cuts = [(torso, Vector((0, 0, z)), Z) for z in (HEM_Z, RIB_Z, TEE_Z, BELT_Z0, WAIST_Z)]
# neck holes: polygonal prisms around the neck (jacket collar line / tee crew neck), one tangent plane per sector
ni = H.body.vertex_groups['neck_01'].index
NP = [v.co for v in me0.vertices if 1.53 < v.co.z < 1.58 and any(g.group == ni and g.weight > 0.5 for g in v.groups)]
NCY = (min(p.y for p in NP) + max(p.y for p in NP)) / 2
NRX, NRY = max(abs(p.x) for p in NP), (max(p.y for p in NP) - min(p.y for p in NP)) / 2
print('neck', NCY, NRX, NRY)
NSEC = 20


def prism(grow, zmin):
    rx, ry = NRX + grow, NRY + grow * 1.1
    planes = []
    for i in range(NSEC):
        t = 2 * math.pi * i / NSEC
        p = Vector((rx * math.sin(t), NCY - ry * math.cos(t), 0))
        n = Vector((math.sin(t) / rx, -math.cos(t) / ry, 0)).normalized()
        planes.append((p, n))
    def sector(c): return int(round((math.atan2(c.x, -(c.y - NCY)) % (2 * math.pi)) / (2 * math.pi) * NSEC)) % NSEC
    def inside(c): p, n = planes[sector(c)]; return c.z > zmin and (c - Vector((p.x, p.y, c.z))).dot(n) < 0
    return planes, sector, inside


JP, JSEC, in_jneck = prism(0.024, 1.40)
TEE_KN = [(0.0, 1.452), (0.035, 1.457), (0.07, 1.474), (0.1, 1.503), (0.14, 1.55)]   # crew neck (front only), z(|x|)


def tee_line(ax):
    for (x0, z0), (x1, z1) in zip(TEE_KN, TEE_KN[1:]):
        if ax <= x1: return z0 + (ax - x0) * (z1 - z0) / (x1 - x0)
    return 9.0


for (x0, z0), (x1, z1) in zip(TEE_KN, TEE_KN[1:]):
    sl = (z1 - z0) / (x1 - x0)
    for sx in (-1, 1):
        cuts.append((lambda c, x0=x0, x1=x1, sx=sx: c.y < 0.04 and c.z > 1.38 and x0 - 0.005 <= sx * c.x <= x1 + 0.005,
                     Vector((sx * x0, 0, z0)), Vector((-sx * sl, 0, 1)).normalized()))


def back_neck(y): return 1.418 + 0.6 * y             # the hole may not run down the upper back
cuts.append((lambda c: c.z > 1.38 and abs(c.x) < 0.14 and c.y > -0.04, Vector((0, 0, 1.418)), Vector((0, -0.6, 1)).normalized()))
for planes, sec in ((JP, JSEC),):
    for i, (p, n) in enumerate(planes):
        cuts.append((lambda c, i=i, sec=sec: c.z > 1.38 and abs(c.x) < 0.25 and sec(c) == i, p, n))
cuts += [(legs, Vector((0, 0, z)), Z) for z in (ANKLE_Z, SHOE_Z, PCUFF_Z)]
for sx in (-1, 1):
    for d in (0.0, 0.006):                        # front edge + zipper tape
        cuts.append((front, Vector((sx * (0.055 - 0.12 + d), 0, 0)), Vector((sx, 0, -0.12)).normalized()))
    for x in (CUFF_X, SLEEVE_X, GLOVE_X, WRAP_X, KNUCKLE_X):
        cuts.append((lambda c, sx=sx: sx * c.x > 0.45 and c.z > 1.3, Vector((sx * x, 0, 0)), XN))
H.precut(cuts)
H.snapshot()
me, ORIG, NRM, gw = H.me, H.ORIG, H.NRM, H.gw

REG = {k: set() for k in ('jacket', 'tee', 'pants', 'shoe', 'glove')}
for f in me.polygons:
    c = f.center; g = H.face_group(f); ax = abs(c.x)
    if g == 'head': continue
    if g in ('hand', 'finger', 'farm') and GLOVE_X < ax < KNUCKLE_X and c.z > 1.25:
        REG['glove'].add(f.index)
    if g in ('uarm', 'farm') and ax <= SLEEVE_X:
        REG['jacket'].add(f.index)
    if g in ('chest', 'belly', 'pelvis', 'neck') and (ax < 0.25 or c.z > 1.3):
        if HEM_Z < c.z and not (in_jneck(c) and c.z > back_neck(c.y)) and not (c.y < 0.0 and ax < open_w(c.z)):
            REG['jacket'].add(f.index)
        if TEE_Z < c.z < tee_line(ax) and c.y < 0.02 and ax < 0.19:
            REG['tee'].add(f.index)
    if g in ('pelvis', 'belly', 'thigh', 'calf', 'foot') and ANKLE_Z < c.z < WAIST_Z:
        REG['pants'].add(f.index)
    if c.z < SHOE_Z and g in ('foot', 'calf'):
        REG['shoe'].add(f.index)
print({k: len(v) for k, v in REG.items()})


# ------------------------------------------------------------------ offsets
def jacket_off(i, p):
    ax = abs(p.x)
    o = (0.017 * gw(i, 'chest') + 0.03 * gw(i, 'belly') + 0.036 * gw(i, 'pelvis') + 0.012 * gw(i, 'neck')
         + 0.019 * gw(i, 'uarm') + 0.022 * gw(i, 'farm') + 0.012 * gw(i, 'hand') + 0.014 * gw(i, 'head'))
    if p.y > 0.02 and p.z > 1.12 and ax < 0.22: o += 0.006               # room across the back
    o = lerp(o, 0.015, 1 - sm(RIB_Z - 0.005, RIB_Z + 0.03, p.z))         # gathered rib hem (bloused above)
    if ax > 0.55: o = lerp(o, 0.012, sm(CUFF_X - 0.035, CUFF_X, ax))     # gathered rib cuff
    return max(o, 0.01)


def tee_off(i, p):
    return 0.0045 + 0.004 * gw(i, 'belly') + 0.003 * gw(i, 'pelvis')


def pants_off(i, p):
    o = 0.016 * (gw(i, 'pelvis') + gw(i, 'belly')) + 0.024 * gw(i, 'thigh') + 0.02 * gw(i, 'calf') + 0.012 * gw(i, 'foot')
    if abs(p.x) < 0.07 and p.z > 0.72: o = min(o, 0.012)                 # crotch: keep the legs apart
    if BELT_Z0 - 0.003 < p.z: o += 0.004                                  # belt sits proud
    return max(o, 0.008)


def glove_off(i, p): return 0.0045 if abs(p.x) < WRAP_X else 0.0035


# ------------------------------------------------------------------ gloves + wraps
gl = H.make_shell('Kai_Gloves', REG['glove'], glove_off, smooth=1)
bm = edit(gl); src = bm.verts.layers.int['src']
I_G, I_W = mat_index(gl, 'kai_gloves'), mat_index(gl, 'kai_wrap')
for loop in boundary_loops(bm):
    close_loop(bm, loop, lambda v: H.to_skin(v, src, 0.0005))
for f in bm.faces:
    f.material_index = I_W if abs(f.calc_center_median().x) < WRAP_X else I_G
# wrap bands: alternate rings slightly proud so the white wrap reads as layered tape
for v in bm.verts:
    ax = abs(v.co.x)
    if GLOVE_X < ax < WRAP_X:
        v.co += NRM[v[src]] * 0.0018 * max(0.0, math.sin((ax - GLOVE_X) / (WRAP_X - GLOVE_X) * math.pi * 3)) ** 2
done(gl, bm)
bpy.context.view_layer.objects.active = gl                 # the hands are dense: 60% is plenty for a glove
for o in bpy.context.selected_objects: o.select_set(False)
gl.select_set(True)
dec = gl.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.6; dec.use_collapse_triangulate = False
bpy.ops.object.modifier_apply(modifier=dec.name)

# ------------------------------------------------------------------ sneakers
sh = H.sneakers('Kai_Shoes', {'upper': 'kai_shoes', 'sole': 'kai_sole', 'accent': 'kai_accent'}, ztop=0.12)
SH_BVH = bvh_of(sh)

# ------------------------------------------------------------------ tee
tee = H.make_shell('Kai_Tee', REG['tee'], tee_off, smooth=3)
bm = edit(tee); src = bm.verts.layers.int['src']
I_TE = mat_index(tee, 'kai_tee')
H.membrane(bm, [v for v in bm.verts if not v.is_boundary and v.co.y < 0.0 and 0.96 < v.co.z < 1.42 and abs(v.co.x) < 0.16], 12, lambda v: 0.005)
for loop in boundary_loops(bm):
    c, _ = loop_center(loop)
    if c.z > 1.3:                                            # crew neck: rolled rib
        smooth_loop(loop, 10)
        nv, _ = close_loop(bm, loop, lambda v: v.co + Z * 0.006 + NRM[v[src]] * 0.002)
        close_loop(bm, [e for e in bm.edges if e.is_boundary and all(x in nv for x in e.verts)], lambda v: H.to_skin(v, src, 0.001) + Z * 0.004)
    else:
        close_loop(bm, loop, lambda v: H.to_skin(v, src, 0.001))
for f in bm.faces: f.material_index = I_TE
done(tee, bm)
TEE_BVH = bvh_of(tee)

# ------------------------------------------------------------------ jeans
pt = H.make_shell('Kai_Pants', REG['pants'], pants_off, smooth=3)
bm = edit(pt); src = bm.verts.layers.int['src']
H.membrane(bm, [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.1 and v.co.z > 0.7], 8, lambda v: 0.01)   # groin
# loose straight legs: below the knee push the shell out to a gently tapered cylinder around the leg axis
CEN = {}
for s_ in (-1, 1):
    for k in range(0, 60):
        z = k * 0.01
        pts = [ORIG[i] for i in range(H.NV) if s_ * ORIG[i].x > 0.02 and abs(ORIG[i].z - z) < 0.012
               and gw(i, 'calf') + gw(i, 'thigh') + gw(i, 'foot') > 0.5 and ORIG[i].y > -0.12]
        if pts: CEN[(s_, k)] = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts)))


def leg_axis(s_, z):
    k = max(0, min(59, int(round(z / 0.01))))
    while (s_, k) not in CEN and k < 59: k += 1
    return CEN.get((s_, k), Vector((s_ * 0.11, 0.03)))


for v in bm.verts:
    if v.co.z > 0.62 or abs(v.co.x) < 0.02: continue
    s_ = 1 if v.co.x > 0 else -1
    c2 = leg_axis(s_, v.co.z)
    d = Vector((v.co.x - c2.x, v.co.y - c2.y)); r = d.length
    R = lerp(0.071, 0.083, sm(0.12, 0.52, v.co.z))
    k = 1 - sm(0.5, 0.62, v.co.z)
    if r < R and r > 1e-4:
        d2 = d * (lerp(r, R, k) / r); v.co.x, v.co.y = c2.x + d2.x, c2.y + d2.y
keep_outside([v for v in bm.verts if v.co.z > TEE_Z - 0.03], TEE_BVH, 0.004)
keep_outside([v for v in bm.verts if v.co.z < 0.2], SH_BVH, 0.003)
I_P, I_PS, I_B = mat_index(pt, 'kai_jeans'), mat_index(pt, 'kai_seam'), mat_index(pt, 'kai_belt')
for loop in boundary_loops(bm):
    c, _ = loop_center(loop)
    if c.z < 0.3:                                            # hem: 6 mm lip towards the leg axis
        def lip(v):
            c2 = leg_axis(1 if v.co.x > 0 else -1, v.co.z)
            d = Vector((c2.x - v.co.x, c2.y - v.co.y, 0)).normalized()
            return v.co + d * 0.006 + Z * 0.004
        close_loop(bm, loop, lip)
    else:
        close_loop(bm, loop, lambda v: H.to_skin(v, src, 0.001))
# outer seams (thin dark lines fitted to the outermost verts of each leg)
LW = 0.0035
LEG_LINE = []
for s_ in (-1, 1):
    for (z0, z1) in ((0.55, 0.97), (PCUFF_Z, 0.55)):
        vs = [v for v in bm.verts if s_ * v.co.x > 0.08 and z0 < v.co.z < z1]
        outer = extreme(vs, lambda v: v.co.z, lambda v: s_ * v.co.x)
        a0, b0 = fit([(v.co.z, v.co.y) for v in outer])
        if z1 == 0.55:
            yk = LEG_LINE[-1][3] + LEG_LINE[-1][4] * 0.55
            num = sum((v.co.z - 0.55) * (v.co.y - yk) for v in outer); den = sum((v.co.z - 0.55) ** 2 for v in outer) or 1e-9
            b0 = num / den; a0 = yk - b0 * 0.55
        LEG_LINE.append((s_, z0, z1, a0, b0))
        for d in (-LW, LW):
            sel = [f for f in bm.faces if s_ * f.calc_center_median().x > 0.08 and z0 - 0.03 < f.calc_center_median().z < z1 + 0.03]
            bisect(bm, sel, Vector((0, a0 + d, 0)), Vector((0, 1, -b0)).normalized())
for f in bm.faces:
    c = f.calc_center_median()
    f.material_index = I_P
    for (s_, z0, z1, a0, b0) in LEG_LINE:
        if s_ * c.x > 0.08 and z0 - 0.005 <= c.z <= z1 + 0.005 and abs(c.y - (a0 + b0 * c.z)) < LW and f.normal.x * s_ > 0.3 and c.z < BELT_Z0 - 0.02:
            f.material_index = I_PS
    if c.z < PCUFF_Z: f.material_index = I_PS                           # turned-up cuff
    if c.z > BELT_Z0: f.material_index = I_B
for v in bm.verts:                                                      # cuff stands proud of the leg
    if v.co.z < PCUFF_Z + 0.002 and abs(v.co.x) > 0.02:
        c2 = leg_axis(1 if v.co.x > 0 else -1, v.co.z)
        d = Vector((v.co.x - c2.x, v.co.y - c2.y, 0)).normalized(); v.co += d * 0.004
# belt buckle
fz = [v.co for v in bm.verts if abs(v.co.x) < 0.02 and BELT_Z0 < v.co.z < WAIST_Z and v.co.y < 0]
by = min(p.y for p in fz) if fz else -0.1
r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, by - 0.004, (BELT_Z0 + WAIST_Z) / 2)) @ Matrix.Diagonal((0.05, 0.008, 0.032, 1)))
I_BK = mat_index(pt, 'kai_buckle')
BUCKLE = set(r['verts'])
for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = I_BK
done(pt, bm)
PANTS_BVH = bvh_of(pt)

# ------------------------------------------------------------------ bomber jacket
jk = H.make_shell('Kai_Jacket', REG['jacket'], jacket_off, smooth=4)
bm = edit(jk); src = bm.verts.layers.int['src']
I_J, I_T, I_Z = mat_index(jk, 'kai_jacket'), mat_index(jk, 'kai_trim'), mat_index(jk, 'kai_zipper')
# open panels hang over the pecs / abs instead of hugging them
H.membrane(bm, [v for v in bm.verts if not v.is_boundary and v.co.y < 0.02 and 0.96 < v.co.z < 1.42 and abs(v.co.x) < 0.2], 20, lambda v: 0.016)
H.membrane(bm, [v for v in bm.verts if not v.is_boundary and 0.24 < abs(v.co.x) < CUFF_X - 0.03], 8, lambda v: 0.014)
GL_BVH0 = None
low = [v for v in bm.verts if v.co.z < 1.08]
for _ in range(4):                                           # settle the hem over the jeans without zig-zags
    keep_outside([v for v in bm.verts if abs(v.co.x) < 0.3], TEE_BVH, 0.006)
    keep_outside(low, PANTS_BVH, 0.008)
    bmesh.ops.smooth_vert(bm, verts=[v for v in low if not v.is_boundary], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
keep_outside(low, PANTS_BVH, 0.007)
keep_outside([v for v in bm.verts if abs(v.co.x) > 0.55], bvh_of(gl), 0.004)
cy_neck = NCY
COLLAR, ZIP = set(), set()
for loop in boundary_loops(bm):
    c, vs = loop_center(loop)
    if abs(c.x) > 0.5:                                       # sleeve cuff: lip over the wraps
        close_loop(bm, loop, lambda v: v.co - NRM[v[src]] * 0.005)
        continue
    # one loop: back neck -> both front edges -> hem. Collar weight k: 1 around the neck, 0 down the front
    smooth_loop(loop, 5)                                     # the neck line crosses dense shoulder topology
    def kc(v): return sm(1.36, 1.43, v.co.z) if v.co.y < 0.0 else sm(1.3, 1.4, v.co.z)
    def radial(v):
        r_ = Vector((v.co.x, v.co.y - cy_neck, 0)); return r_.normalized()
    def up(v):
        k = kc(v)
        return v.co + (Z * 0.034 + radial(v) * 0.004) * k - NRM[v[src]] * 0.006 * (1 - k)
    K = {v: kc(v) for v in vs}
    ZIP |= {f for v in vs if K[v] < 0.5 and v.co.y < 0 and v.co.z > RIB_Z + 0.01 for f in v.link_faces
            if all(x.co.z > RIB_Z + 0.004 for x in f.verts)}
    nv, f1 = close_loop(bm, loop, up)
    COLLAR |= {f for f in f1 if any(K.get(x, 0) > 0.05 for x in f.verts)}
    ZIP |= {f for f in f1 if f not in COLLAR and all(x.co.z > RIB_Z + 0.005 for x in f.verts)}
    top = [e for e in bm.edges if e.is_boundary and all(x in nv for x in e.verts) and all(kc_ > 0.05 for kc_ in [sm(1.36, 1.47, x.co.z) for x in e.verts])]
    def down(v):                                             # fold the rib collar over and down, outwards
        k = sm(1.39, 1.47, v.co.z) if v.co.y < 0 else 1.0
        return v.co + (radial(v) * 0.013 - Z * 0.03) * k
    _, f2 = close_loop(bm, top, down)
    COLLAR |= set(f2)
for f in bm.faces:
    c = f.calc_center_median(); ax = abs(c.x)
    f.material_index = I_J
    if f in ZIP: f.material_index = I_Z
    if ax > CUFF_X or c.z < RIB_Z or f in COLLAR: f.material_index = I_T
for v in {v for f in bm.faces if f.material_index == I_Z for v in f.verts}:
    if v.co.y < -0.02: v.co.y -= 0.0012
done(jk, bm)

# ------------------------------------------------------------------ hair: SimpleParted sculpt, re-skinned to Head
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=WORK + '/hair_parted.glb')
new = set(bpy.data.objects) - before
hr = next(o for o in new if o.type == 'MESH' and o.name.startswith('Hair'))
mw = hr.matrix_world.copy(); hr.parent = None; hr.matrix_world = mw
for o in new:
    if o is not hr: bpy.data.objects.remove(o)
for m in list(hr.modifiers): hr.modifiers.remove(m)
bpy.context.view_layer.objects.active = hr
for o in bpy.context.selected_objects: o.select_set(False)
hr.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
hr.name = 'Kai_Hair'
hr.data.materials.clear(); I_HR = mat_index(hr, 'kai_hair')
for vg in list(hr.vertex_groups): hr.vertex_groups.remove(vg)
gH = hr.vertex_groups.new(name='Head')
gH.add([v.index for v in hr.data.vertices], 1.0, 'REPLACE')
dec = hr.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.6                 # the sculpt is denser than it needs to be
bpy.ops.object.modifier_apply(modifier=dec.name)
HAIR_BVH = bvh_of(hr)
I_BAND = mat_index(hr, 'kai_band')


def surf(z, a, y0=0.004):
    """outermost head/hair surface point at height z in horizontal direction a (0 = front, -Y)"""
    d = Vector((math.sin(a), -math.cos(a), 0))
    o = Vector((0, y0, z)) + d * 0.3
    best = None
    for tree in (H.REF_BVH, HAIR_BVH):
        hit = tree.ray_cast(o, -d, 0.3)
        if hit[0] is not None and (best is None or (hit[0] - o).length < (best - o).length): best = hit[0]
    return best if best is not None else Vector((0, y0, z)) + d * 0.09


# ---- headband: a 3 cm band following the forehead / hair, tilted down towards the knot at the back
def band_z(a): return 1.737 - 0.024 * (0.5 - 0.5 * math.cos(a))
NB, HB, TH = 48, 0.0155, 0.0065
bm = edit(hr); dl = bm.verts.layers.deform.verify()
gHi = hr.vertex_groups['Head'].index
sections = []
for k in range(NB):
    a = 2 * math.pi * k / NB
    zc = band_z(a)
    lo, hi = surf(zc - HB, a), surf(zc + HB, a)
    d = Vector((math.sin(a), -math.cos(a), 0))
    prof = [(lo, 0.0012, 0), (lo, TH - 0.0015, 0), (lo, TH, 0.004), (hi, TH, -0.004), (hi, TH - 0.0015, 0), (hi, 0.0012, 0)]
    sec = []
    for p, out_, dz in prof:
        v = bm.verts.new(p + d * out_ + Z * dz); v[dl][gHi] = 1.0; sec.append(v)
    sections.append(sec)
for k in range(NB):
    s0, s1 = sections[k], sections[(k + 1) % NB]
    for j in range(6):
        f = bm.faces.new((s0[j], s1[j], s1[(j + 1) % 6], s0[(j + 1) % 6])); f.material_index = I_BAND
back = surf(band_z(math.pi), math.pi) + Vector((0, 1, 0)) * (TH + 0.006)
# knot: two flattened lobes + a centre wrap
for sx, sc in ((-1, (0.017, 0.009, 0.012)), (1, (0.017, 0.009, 0.012)), (0, (0.009, 0.01, 0.011))):
    r = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0,
                                  matrix=Matrix.Translation(back + Vector((sx * 0.016, 0.002 if sx else 0.004, 0.002 * abs(sx)))) @ Matrix.Diagonal((*sc, 1)))
    for v in r['verts']: v[dl][gHi] = 1.0
    for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = I_BAND
done(hr, bm)

# ---- tails on new bones
TAILS = []
for sx, side in ((1, 'l'), (-1, 'r')):
    p0 = back + Vector((sx * 0.008, 0.004, -0.006))
    p1 = p0 + Vector((sx * 0.02, 0.05, -0.1))
    p2 = p1 + Vector((sx * 0.018, 0.04, -0.11))
    TAILS.append((side, sx, [p0, p1, p2]))
H.add_bones([('Head', [f'headband_{s}1', f'headband_{s}2'], P) for s, sx, P in TAILS])
bm = edit(hr)
for side, sx, P in TAILS:
    C = catmull(P, 5)
    H.tube(hr, bm, C, [f'headband_{side}1', f'headband_{side}2'], 'Head',
           lambda u: 0.016 * (1 - 0.12 * u), I_BAND, rad=8, twist=0.9 * sx, root_blend=0.25,
           section=lambda a, u: (1.0, 0.22), side=Vector((1, 0, 0)))

# ---- spiky locks over the parted sculpt (silhouette): root inside the hair, tapering tip
dl = bm.verts.layers.deform.verify()
LOCKS = [  # (angle around the head, height, sweep direction, length, root radius): chunky tufts swept up and back
    (-0.3, 1.785, (0.04, 0.35, 0.9), 0.07, 0.024), (0.2, 1.79, (-0.03, 0.4, 0.9), 0.075, 0.025),
    (0.65, 1.775, (0.2, 0.45, 0.85), 0.06, 0.021), (-0.75, 1.77, (-0.2, 0.45, 0.85), 0.06, 0.021),
    (2.7, 1.8, (0.15, 0.85, 0.4), 0.06, 0.022), (-2.7, 1.8, (-0.15, 0.85, 0.4), 0.06, 0.022),
]
for a, z, dvec, ln, rr in LOCKS:
    s = surf(z, a, 0.0)
    d = Vector(dvec).normalized()
    n_ = (s - Vector((0, 0.0, 1.70))).normalized()
    p0 = s - n_ * 0.03
    p1 = s + d * ln * 0.4 + n_ * 0.012
    p2 = s + d * ln + n_ * 0.004
    C = catmull([p0, p1, p2], 4)
    H.tube(hr, bm, C, ['Head'], 'Head', lambda u, rr=rr: rr * (1 - u) ** 0.9, I_HR, rad=7, twist=0.0, root_blend=0.0,
           section=lambda a_, u: (1.35, 0.6), side=d.cross(n_).normalized())
done(hr, bm)

# ------------------------------------------------------------------ weights for primitives, drop covered skin
H.transfer_weights(sh, H.unweighted(sh))
bv = H.unweighted(pt)
if bv: H.transfer_weights(pt, bv)
H.drop_body_faces(REG['jacket'] | REG['tee'] | REG['pants'] | REG['shoe'] | REG['glove'], 'kai_skin')

H.finalize([jk, tee, pt, sh, gl], [hr], smooth_parts=(jk, pt, tee))
