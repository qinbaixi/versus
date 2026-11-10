"""Build mira's outfit / hair on the Quaternius female base and export priv/www/assets/mira.glb.

  blender --background --python tools/blender/mira_build.py

Everything is procedural (bmesh, shared tools in hero_common.py): clothing shells are duplicated body
regions pushed out along the normals, smoothed, closed with thickness at every opening, cut with planes
for stripes and the zipper; sneakers / ponytail / tie are built from primitives. Shells inherit the
body's skin weights (same topology), primitives get weights by nearest-surface transfer. The armature,
bone names and rest pose are left exactly as imported; only ponytail_1..5 (children of Head) are added.
Saves tools/blender/mira.blend and exports the glb (no animations, no images).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hero_common as hc
from hero_common import *

# toon palette (sRGB hex) -- slot names are what the game looks up (js3d/heroes.js mira.mats)
hc.PALETTE.update({
    'mira_skin': '#c98a62', 'mira_jacket': '#2662d9', 'mira_trim': '#173f99', 'mira_stripes': '#f4f6ff',
    'mira_zipper': '#cfd4e2', 'mira_pants': '#1f4fb8', 'mira_shoes': '#f2f2f6', 'mira_sole': '#6ff0ff',
    'mira_laces': '#173f99', 'mira_gloves': '#26222a', 'mira_wrap': '#6ff0ff', 'mira_hair': '#5a1830',
    'mira_tie': '#6ff0ff',
})

H = HeroBuild('mira', WORK + '/female_plain.glb', 'Superhero_Female', WORK + '/T_Superhero_Female_Dark_BaseColor.png')
arm, body = H.arm, H.body

HEM_Z, WAIST_Z, SHOE_Z, ANKLE_Z = 0.95, 1.03, 0.13, 0.092
WRIST_X, GLOVE_X, KNUCKLE_X = 0.60, 0.585, 0.705
NECK_P, NECK_N = Vector((0, -0.1, 1.462)), Vector((0, -0.043, 0.18)).normalized()

# ---- pre-cut the body along every clothing edge so all openings are clean straight lines
torso = lambda c: abs(c.x) < 0.3 and c.z > 0.6
legs = lambda c: c.z < 0.4
Z = Vector((0, 0, 1))
cuts = [(torso, Vector((0, 0, HEM_Z)), Z), (torso, Vector((0, 0, HEM_Z + 0.035)), Z),   # hem + rib band
        (torso, Vector((0, 0, WAIST_Z)), Z),
        (lambda c: abs(c.x) < 0.12 and c.z > 1.38, NECK_P, NECK_N),
        (legs, Vector((0, 0, SHOE_Z)), Z), (legs, Vector((0, 0, ANKLE_Z)), Z), (legs, Vector((0, 0, 0.15)), Z)]
for sx in (-1, 1):
    for x in (GLOVE_X, WRIST_X, 0.572, 0.635, KNUCKLE_X):
        cuts.append((lambda c, sx=sx: sx * c.x > 0.45 and c.z > 1.3, Vector((sx * x, 0, 0)), Vector((1, 0, 0))))
H.precut(cuts)
H.snapshot()
me, ORIG, NRM, gw = H.me, H.ORIG, H.NRM, H.gw


def neckline(y):          # jacket top (plane NECK_P/NECK_N): lower in front, higher at the back
    return NECK_P.z - NECK_N.y / NECK_N.z * (y - NECK_P.y)


def hairline(x, y):       # scalp region above this height is covered by hair
    t = lerp(1.712, 1.655, sm(-0.085, -0.02, y))
    t = lerp(t, 1.575, sm(0.0, 0.07, y))
    if abs(x) > 0.055 and -0.06 < y < 0.02:       # above the ears / temples
        t = max(t, 1.665)
    return t


REG = {k: set() for k in ('jacket', 'pants', 'shoe', 'glove', 'hair')}
for f in me.polygons:
    c = f.center; g = H.face_group(f); ax = abs(c.x)
    if g == 'head':
        if c.z > hairline(c.x, c.y) and min(ORIG[i].z for i in f.vertices) > hairline(c.x, c.y) - 0.012:
            REG['hair'].add(f.index)
        continue
    if g in ('hand', 'finger', 'farm') and GLOVE_X < ax < KNUCKLE_X and c.z > 1.25:
        REG['glove'].add(f.index)
    if g in ('uarm', 'farm') and ax <= WRIST_X:
        REG['jacket'].add(f.index)
    if g in ('chest', 'belly', 'pelvis', 'neck') and c.z > HEM_Z and (ax < 0.25 or c.z > 1.3):
        if c.z < neckline(c.y):
            REG['jacket'].add(f.index)
    if g in ('pelvis', 'belly', 'thigh', 'calf') and ANKLE_Z < c.z < WAIST_Z:
        REG['pants'].add(f.index)
    if c.z < SHOE_Z and g in ('foot', 'calf'):
        REG['shoe'].add(f.index)
print({k: len(v) for k, v in REG.items()})


# ------------------------------------------------------------------ offsets
def jacket_off(i, p):
    ax = abs(p.x)
    o = (0.012 * gw(i, 'chest') + 0.021 * gw(i, 'belly') + 0.03 * gw(i, 'pelvis') + 0.008 * gw(i, 'neck')
         + 0.011 * gw(i, 'uarm') + 0.015 * gw(i, 'farm') + 0.008 * gw(i, 'hand') + 0.012 * gw(i, 'head'))
    if p.y > 0.02 and p.z > 1.15 and ax < 0.2: o += 0.004               # a little room across the back
    if ax > 0.565: o = lerp(o, 0.010, sm(0.565, 0.58, ax))               # gathered cuff
    return max(o, 0.007)


def pants_off(i, p):
    o = 0.012 * (gw(i, 'pelvis') + gw(i, 'belly')) + 0.017 * gw(i, 'thigh') + 0.017 * gw(i, 'calf') + 0.01 * gw(i, 'foot')
    if abs(p.x) < 0.07 and p.z > 0.72: o = min(o, 0.009)                 # crotch: keep the legs apart
    o = lerp(0.008, o, sm(0.14, 0.24, p.z))                              # elastic ankle cuff
    return max(o, 0.006)


def glove_off(i, p): return 0.0035


def hair_off(i, p):
    t = sm(0.0, 0.06, p.z - hairline(p.x, p.y))
    o = 0.006 + 0.012 * t
    ang = math.atan2(p.x, p.z - 1.62)                                  # meridians that meet at the tie
    o -= 0.0035 * t * max(0.0, math.cos(ang * 9)) ** 6                  # combed-back grooves
    o += 0.008 * sm(0.0, 0.08, p.y) * sm(1.6, 1.7, p.z)                  # fuller at the back/crown
    return o


# ------------------------------------------------------------------ gloves
gl = H.make_shell('Mira_Gloves', REG['glove'], glove_off, smooth=1)
bm = edit(gl); src = bm.verts.layers.int['src']
I_G, I_W = mat_index(gl, 'mira_gloves'), mat_index(gl, 'mira_wrap')
for loop in boundary_loops(bm):
    close_loop(bm, loop, lambda v: H.to_skin(v, src, 0.0005))
for f in bm.faces:
    f.material_index = I_W if abs(f.calc_center_median().x) < 0.635 else I_G
done(gl, bm)

# ------------------------------------------------------------------ shoes: lofted sneaker upper + chunky sole
sh = H.sneakers('Mira_Shoes', {'upper': 'mira_shoes', 'sole': 'mira_sole', 'accent': 'mira_laces'})

# ------------------------------------------------------------------ pants
pt = H.make_shell('Mira_Pants', REG['pants'], pants_off, smooth=3)
bm = edit(pt); src = bm.verts.layers.int['src']
H.membrane(bm, [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.09 and v.co.z > 0.7], 6, lambda v: 0.007)   # groin
I_P, I_PS, I_PT = mat_index(pt, 'mira_pants'), mat_index(pt, 'mira_stripes'), mat_index(pt, 'mira_trim')
for loop in boundary_loops(bm):
    c, _ = loop_center(loop)
    gap = 0.004 if c.z < 0.3 else 0.001
    close_loop(bm, loop, lambda v, gap=gap: H.to_skin(v, src, gap))
LW = 0.015
LEG_LINE = []
for s_ in (-1, 1):
    for (z0, z1) in ((0.55, 0.97), (0.15, 0.55)):
        vs = [v for v in bm.verts if s_ * v.co.x > 0.08 and z0 < v.co.z < z1]
        outer = extreme(vs, lambda v: v.co.z, lambda v: s_ * v.co.x)
        a0, b0 = fit([(v.co.z, v.co.y) for v in outer])
        if z1 == 0.55:                                   # pass through the thigh line at the knee
            yk = LEG_LINE[-1][3] + LEG_LINE[-1][4] * 0.55
            num = sum((v.co.z - 0.55) * (v.co.y - yk) for v in outer); den = sum((v.co.z - 0.55) ** 2 for v in outer) or 1e-9
            b0 = num / den; a0 = yk - b0 * 0.55
        LEG_LINE.append((s_, z0, z1, a0, b0))
        nrm_ = Vector((0, 1, -b0)).normalized()
        for d in (-LW, LW):
            sel = [f for f in bm.faces if s_ * f.calc_center_median().x > 0.08 and z0 - 0.03 < f.calc_center_median().z < z1 + 0.03]
            bisect(bm, sel, Vector((0, a0 + d, 0)), nrm_)


def on_leg_stripe(c, n):
    for (s_, z0, z1, a0, b0) in LEG_LINE:
        if s_ * c.x > 0.08 and z0 - 0.005 <= c.z <= z1 + 0.005 and abs(c.y - (a0 + b0 * c.z)) < LW and n.x * s_ > 0.35:
            return True
    return False


for f in bm.faces:
    c = f.calc_center_median()
    f.material_index = I_P
    if on_leg_stripe(c, f.normal) and c.z < WAIST_Z - 0.01: f.material_index = I_PS
    if c.z < 0.15: f.material_index = I_PT
done(pt, bm)

# ------------------------------------------------------------------ jacket
jk = H.make_shell('Mira_Jacket', REG['jacket'], jacket_off, smooth=4)
bm = edit(jk); src = bm.verts.layers.int['src']
I_J, I_T, I_S, I_Z = mat_index(jk, 'mira_jacket'), mat_index(jk, 'mira_trim'), mat_index(jk, 'mira_stripes'), mat_index(jk, 'mira_zipper')
# a zipped jacket bridges the chest and hangs straight over the belly: taut membrane at the front
front = [v for v in bm.verts if not v.is_boundary and v.co.y < 0.02 and 0.9 < v.co.z < 1.44 and abs(v.co.x) < 0.17]
H.membrane(bm, front, 25, lambda v: 0.009)
keep_outside([v for v in bm.verts if v.co.z < 1.08], bvh_of(pt), 0.006)
keep_outside([v for v in bm.verts if abs(v.co.x) > 0.55], bvh_of(gl), 0.004)
for loop in boundary_loops(bm):
    c, vs = loop_center(loop)
    if c.z > 1.4 and abs(c.x) < 0.12:                       # neckline -> stand-up collar
        cy = c.y
        def up(v, cy=cy):
            r = Vector((v.co.x, v.co.y - cy, 0)); r.normalize()
            return v.co + Vector((0, 0, 0.042)) + r * 0.006
        nv, _ = close_loop(bm, loop, up)
        top = [e for e in bm.edges if e.is_boundary and all(v in nv for v in e.verts)]
        def down(v, cy=cy):
            r = Vector((v.co.x, v.co.y - cy, 0)); r.normalize()
            return v.co - r * 0.011 - Vector((0, 0, 0.036))
        close_loop(bm, top, down)
    elif abs(c.x) > 0.5:                                     # sleeve cuff over the glove
        close_loop(bm, loop, lambda v: H.to_skin(v, src, 0.002))
    elif c.z < 1.0:                                          # hem: a 4 mm lip, kept clear of the pants
        close_loop(bm, loop, lambda v: v.co - NRM[v[src]] * 0.004)
    else:
        close_loop(bm, loop, lambda v: H.to_skin(v, src, 0.001))
# stripes along the top of both sleeves and over the shoulders (centre line fitted to the mesh)
SW = 0.0125
ARM_LINE = {}
for s_ in (-1, 1):
    vs = [v for v in bm.verts if 0.16 < s_ * v.co.x < 0.57 and v.co.z > 1.38]
    top = extreme(vs, lambda v: s_ * v.co.x, lambda v: v.co.z)
    a0, b0 = fit([(v.co.x, v.co.y) for v in top]); ARM_LINE[s_] = (a0, b0)
    nrm_ = Vector((-b0, 1, 0)).normalized()
    for d in (-SW, SW):
        bisect(bm, [f for f in bm.faces if f.calc_center_median().z > 1.39 and s_ * f.calc_center_median().x > 0.07],
               Vector((0, a0 + d, 0)), nrm_)
for x0 in (-0.0055, 0.0055):
    bisect(bm, [f for f in bm.faces if f.calc_center_median().y < -0.02 and abs(f.calc_center_median().x) < 0.05], Vector((x0, 0, 0)), Vector((1, 0, 0)))
for f in bm.faces:
    c = f.calc_center_median(); ax = abs(c.x)
    f.material_index = I_J
    al = ARM_LINE[1 if c.x > 0 else -1]
    if c.z > 1.39 and 0.08 < ax < 0.572 and abs(c.y - (al[0] + al[1] * c.x)) < SW and f.normal.z > 0.3:
        f.material_index = I_S
    if ax > 0.572 or c.z < HEM_Z + 0.035 or (c.z > neckline(c.y) + 0.004 and ax < 0.12):
        f.material_index = I_T
    if c.y < -0.02 and ax < 0.0055:
        f.material_index = I_Z
for v in {v for f in bm.faces if f.material_index == I_Z for v in f.verts}: v.co.y -= 0.0025
done(jk, bm)

# ------------------------------------------------------------------ hair cap
hr = H.make_shell('Mira_Hair', REG['hair'], hair_off, smooth=4)
bm = edit(hr); src = bm.verts.layers.int['src']
I_H, I_TIE = mat_index(hr, 'mira_hair'), mat_index(hr, 'mira_tie')
for loop in boundary_loops(bm):
    smooth_loop(loop, 6)                                   # smooth the jagged hairline
    close_loop(bm, loop, lambda v: v.co - NRM[v[src]] * (hair_off(v[src], ORIG[v[src]]) - 0.0008))
for f in bm.faces: f.material_index = I_H
done(hr, bm)
CAP_BVH = bvh_of(hr)

# ------------------------------------------------------------------ ponytail bones + mesh
# v6: a high ponytail that hangs well past the nape (visible beside the neck from the front / 3-4 views)
P = [Vector(p) for p in ((0, 0.072, 1.722), (0, 0.138, 1.716), (0, 0.196, 1.645), (0.008, 0.214, 1.545),
                         (0.016, 0.208, 1.435), (0.02, 0.192, 1.315))]
PONY = [f'ponytail_{k}' for k in range(1, 6)]
H.add_bones([('Head', PONY, P)])
C = catmull(P, 4)                          # 21 centre points
bm = edit(hr); dl = bm.verts.layers.deform.verify()


L = [0.0]
for a, b in zip(C, C[1:]): L.append(L[-1] + (b - a).length)
# hair tie: just where the tail leaves the hair cap; the tail is gathered (thin) there and puffs out after it
k_tie = next(k for k in range(2, len(C)) if CAP_BVH.find_nearest(C[k])[3] > 0.016)
U_TIE = L[k_tie] / L[-1]


def radius(u):                             # u 0..1 along the tail: gathered at the tie, full, then tapering
    full = 0.022 + 0.034 * sm(U_TIE, U_TIE + 0.22, u) - 0.02 * sm(0.45, 1.0, u) - 0.012 * sm(0.75, 1.0, u)
    return full if u >= U_TIE else 0.022 + 0.004 * (1 - u / max(U_TIE, 1e-3))


H.tube(hr, bm, C, PONY, 'Head', radius, I_H, rad=12)
tdir = (C[k_tie + 1] - C[k_tie - 1]).normalized()
gi = {n: hr.vertex_groups[n].index for n in ('Head', 'ponytail_1')}
torus(bm, C[k_tie], tdir, radius(U_TIE) + 0.006, 0.0075, seg=14, sides=6, mat=I_TIE,
      weights={gi['Head']: 0.3, gi['ponytail_1']: 0.7}, dl=dl)
bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index == I_TIE])
done(hr, bm)
print('tie at', k_tie, C[k_tie])

# ------------------------------------------------------------------ weights for primitives, drop covered skin
H.transfer_weights(sh, H.unweighted(sh))
# hair: keep one ring of scalp under the (smoothed) hairline so no gap can open
hv_out = {i for f in me.polygons if f.index not in REG['hair'] for i in f.vertices}
hair_inner = {fi for fi in REG['hair'] if not any(i in hv_out for i in me.polygons[fi].vertices)}
H.drop_body_faces(REG['jacket'] | REG['pants'] | REG['shoe'] | REG['glove'] | hair_inner, 'mira_skin')

H.finalize([jk, pt, sh, gl], [hr], smooth_parts=(jk, pt))
