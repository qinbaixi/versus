"""Shared Blender (4.0, --background) helpers for the modelled heroes (mira, kai).

Inputs are plain (decoded) glbs written by decode_glb.mjs into $HERO_WORK (default /tmp/mira_work):
  female_plain.glb / male_plain.glb (base bodies), anims_plain.glb (hero_anims), optional hair glbs.
Blender 4.0's glTF importer needs numpy; if the system Blender has none, put one on PYTHONPATH.

HeroBuild wraps one base body: import, pre-cut along clothing edges, snapshot rest positions /
normals / bone-group weights, and offers the garment tools (offset shells, closed openings,
plane cuts, taut "membrane" smoothing, lofted sneakers, tube/ribbon chains on new bones,
weight transfer) plus finalize() which parents, cleans weights, saves the .blend and exports the glb.
"""
import bpy, bmesh, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
WORK = os.environ.get('HERO_WORK', os.environ.get('MIRA_WORK', '/tmp/mira_work'))


def blend_path(hero): return os.path.join(HERE, f'{hero}.blend')
def glb_path(hero): return os.path.join(REPO, 'priv', 'www', 'assets', f'{hero}.glb')


# ------------------------------------------------------------------ small math
def sm(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def fit(pairs):
    """least-squares line y = a + b x"""
    n = len(pairs); mx = sum(p[0] for p in pairs) / n; my = sum(p[1] for p in pairs) / n
    sxx = sum((p[0] - mx) ** 2 for p in pairs) or 1e-9
    b_ = sum((p[0] - mx) * (p[1] - my) for p in pairs) / sxx
    return my - b_ * mx, b_


def extreme(verts, key_bin, key_max, step=0.02):
    """per bin of key_bin, the vertex with the largest key_max"""
    best = {}
    for v in verts:
        k = int(key_bin(v) / step)
        if k not in best or key_max(v) > key_max(best[k]): best[k] = v
    return list(best.values())


def catmull(pts, n):
    out = []
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for j in range(n):
            t = j / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(pts[-1])
    return out


# ------------------------------------------------------------------ materials (toon palette, sRGB hex)
PALETTE = {}


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        col = srgb(PALETTE[name])
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = col
        bsdf.inputs['Roughness'].default_value = 0.8
        m.diffuse_color = col
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path, **kw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, **kw)
    return [o for o in bpy.data.objects if o not in before]


def bone_group(name):
    if name == 'Head': return 'head'
    if name == 'neck_01': return 'neck'
    if name == 'spine_03' or name.startswith('clavicle'): return 'chest'
    if name in ('spine_01', 'spine_02'): return 'belly'
    if name in ('pelvis', 'root'): return 'pelvis'
    if name.startswith('upperarm'): return 'uarm'
    if name.startswith('lowerarm'): return 'farm'
    if name.startswith('hand'): return 'hand'
    if name.split('_')[0] in ('index', 'middle', 'ring', 'pinky', 'thumb'): return 'finger'
    if name.startswith('thigh'): return 'thigh'
    if name.startswith('calf'): return 'calf'
    return 'foot'


def edit(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    return bm


def done(ob, bm):
    bm.normal_update(); bm.to_mesh(ob.data); bm.free(); ob.data.update()


def boundary_loops(bm):
    edges = [e for e in bm.edges if e.is_boundary]
    seen, loops, adj = set(), [], {}
    for e in edges:
        for v in e.verts: adj.setdefault(v, []).append(e)
    for e0 in edges:
        if e0 in seen: continue
        loop, stack = [], [e0]
        while stack:
            e = stack.pop()
            if e in seen: continue
            seen.add(e); loop.append(e)
            for v in e.verts:
                for e2 in adj[v]:
                    if e2 not in seen: stack.append(e2)
        loops.append(loop)
    return loops


def loop_center(loop):
    vs = {v for e in loop for v in e.verts}
    return sum((v.co for v in vs), Vector()) / len(vs), vs


def close_loop(bm, loop_edges, target_fn):
    """Extrude a boundary loop and move the copies to target_fn(vert) (gives an opening thickness)."""
    r = bmesh.ops.extrude_edge_only(bm, edges=loop_edges)
    nv = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in nv:
        v.co = target_fn(v)
    return nv, [g for g in r['geom'] if isinstance(g, bmesh.types.BMFace)]


def smooth_loop(loop, iters=6):
    vs = list({v for e in loop for v in e.verts})
    for _ in range(iters):
        new = {}
        for v in vs:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2: new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
        for v, c in new.items(): v.co = c


def mat_index(ob, name):
    m = material(name)
    if m.name not in ob.data.materials:
        ob.data.materials.append(m)
    return list(ob.data.materials).index(m)


def bisect(bm, faces, co, no):
    geom = list(set(faces) | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)


def bvh_of(ob):
    b = bmesh.new(); b.from_mesh(ob.data); b.normal_update()
    t = BVHTree.FromBMesh(b); b.free(); return t


def keep_outside(verts, tree, gap):
    """push verts that are inside / too close to the surface in `tree` out along its normal"""
    n = 0
    for v in verts:
        loc, nn, idx, d = tree.find_nearest(v.co)
        if loc is None: continue
        s_ = (v.co - loc).dot(nn)
        if s_ < gap:
            v.co += nn * (gap - s_); n += 1
    return n


def torus(bm, center, axis, R, r, seg=12, sides=6, mat=0, weights=None, dl=None, scale=(1, 1)):
    tm = Matrix.Translation(center) @ axis.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    rows = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for j in range(sides):
            b = 2 * math.pi * j / sides
            p = Vector(((R + r * math.cos(b)) * math.cos(a) * scale[0], (R + r * math.cos(b)) * math.sin(a) * scale[1], r * math.sin(b)))
            v = bm.verts.new(tm @ p)
            if weights and dl is not None:
                for gi, w in weights.items(): v[dl][gi] = w
            row.append(v)
        rows.append(row)
    faces = []
    for i in range(seg):
        for j in range(sides):
            f = bm.faces.new((rows[i][j], rows[(i + 1) % seg][j], rows[(i + 1) % seg][(j + 1) % sides], rows[i][(j + 1) % sides]))
            f.material_index = mat; faces.append(f)
    return faces


# ------------------------------------------------------------------ the base body
class HeroBuild:
    def __init__(self, hero, base_glb, body_name, skin_tex=None):
        self.hero = hero
        reset()
        bpy.ops.import_scene.gltf(filepath=base_glb, merge_vertices=True)
        if 'Icosphere' in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects['Icosphere'])
        self.arm = bpy.data.objects['Armature']
        self.body = bpy.data.objects[body_name]
        self.eyes = bpy.data.objects.get('Eyes')
        self.brows = bpy.data.objects.get('Eyebrows')
        self.body.name = hero.capitalize() + '_Body'
        self.me = self.body.data
        self.VG = {vg.index: vg.name for vg in self.body.vertex_groups}
        self.skin_tex = skin_tex
        self.ref = None

    def bpos(self, name, tail=False):
        b = self.arm.data.bones[name]
        return self.arm.matrix_world @ (b.tail_local if tail else b.head_local)

    # ---- 1. clean cut lines on the body (before any region is taken)
    def precut(self, cuts):
        """cuts: list of (face-centre predicate, plane point, plane normal)"""
        bm = bmesh.new(); bm.from_mesh(self.me)
        bm.verts.layers.deform.verify()
        for sel, co, no in cuts:
            fs = [f for f in bm.faces if sel(f.calc_center_median())]
            geom = list(set(fs) | {e for f in fs for e in f.edges} | {v for f in fs for v in f.verts})
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-6)
        bm.to_mesh(self.me); bm.free(); self.me.update()

    # ---- 2. rest snapshot + reference body (weights source, surface for membranes)
    def snapshot(self):
        me = self.me
        self.NV = len(me.vertices)
        self.ORIG = [v.co.copy() for v in me.vertices]
        self.NRM = [v.normal.copy() for v in me.vertices]
        self.VGRP = []
        for v in me.vertices:
            d = {}
            for g in v.groups:
                k = bone_group(self.VG[g.group]); d[k] = d.get(k, 0) + g.weight
            self.VGRP.append(d)
        self.ref = self.body.copy(); self.ref.data = self.body.data.copy(); self.ref.name = 'BodyRef'
        bpy.context.scene.collection.objects.link(self.ref)
        self.REF_BVH = bvh_of(self.ref)

    def gw(self, i, k): return self.VGRP[i].get(k, 0)

    def face_group(self, f):
        d = {}
        for i in f.vertices:
            for k, w in self.VGRP[i].items():
                d[k] = d.get(k, 0) + w
        return max(d, key=d.get) if d else 'pelvis'

    # ---- garments
    def make_shell(self, name, faces, offset_fn, smooth=2, smooth_fac=0.5):
        """Duplicate body faces -> new object; push verts out along the body normals (offset_fn(i, p))."""
        ob = self.body.copy(); ob.data = self.body.data.copy(); ob.name = name
        for m in list(ob.modifiers): ob.modifiers.remove(m)
        bpy.context.scene.collection.objects.link(ob)
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
        src = bm.verts.layers.int.new('src')               # source (body) vertex of every shell vertex
        for v in bm.verts: v[src] = v.index
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in faces], context='FACES')
        O, N = self.ORIG, self.NRM
        for v in bm.verts:
            i = v[src]; v.co = O[i] + N[i] * offset_fn(i, O[i])
        inner = [v for v in bm.verts if not v.is_boundary]
        for _ in range(smooth):
            bmesh.ops.smooth_vert(bm, verts=inner, factor=smooth_fac, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in bm.verts:                                  # never closer to the skin than 70% of the wanted offset
            i = v[src]; want = offset_fn(i, O[i])
            d = (v.co - O[i]).dot(N[i])
            if d < want * 0.7: v.co += N[i] * (want * 0.7 - d)
        bm.to_mesh(ob.data); bm.free()
        ob.data.materials.clear()
        return ob

    def to_skin(self, v, src, gap):
        """point `gap` above the body surface under shell vertex v"""
        i = v[src]; return self.ORIG[i] + self.NRM[i] * gap

    def membrane(self, bm, verts, iters, gap_fn, factor=0.5):
        """taut cloth: smooth, then keep gap_fn(v) above the skin; spans hollows (toes, cleavage, groin)"""
        for _ in range(iters):
            bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
            for v in verts:
                loc, nn, idx, d = self.REF_BVH.find_nearest(v.co)
                g = gap_fn(v); s_ = (v.co - loc).dot(nn)
                if s_ < g: v.co += nn * (g - s_)

    def new_object(self, name):
        ob = bpy.data.objects.new(name, bpy.data.meshes.new(name))
        bpy.context.scene.collection.objects.link(ob)
        for vg in self.body.vertex_groups: ob.vertex_groups.new(name=vg.name)
        return ob

    def sneakers(self, name, mats, ztop=0.118, laces=4, collar=True):
        """Lofted sneaker upper + chunky beveled sole + lace bars + padded ankle collar, both feet.
        mats: dict upper/sole/accent -> material names. Weights: collar = foot bone, rest transferred later."""
        sh = self.new_object(name)
        I_SH, I_SO, I_LA = mat_index(sh, mats['upper']), mat_index(sh, mats['sole']), mat_index(sh, mats['accent'])
        bm = bmesh.new(); sdl = bm.verts.layers.deform.verify()
        NSEC, NPR = 20, 18
        O = self.ORIG
        for s_ in (-1, 1):
            fv = [O[i] for i in range(self.NV) if s_ * O[i].x > 0.03 and O[i].z < 0.14 and O[i].y > -0.2 and abs(O[i].x) < 0.25]
            ymin = min(p.y for p in fv); ymax = max(p.y for p in fv); zmin = min(p.z for p in fv)
            secs = []
            for k in range(NSEC):
                t = k / (NSEC - 1)
                tt = 0.5 - 0.5 * math.cos(t * math.pi)            # denser at heel and toe
                y = lerp(ymax + 0.010, ymin - 0.016, tt)
                near = [p for p in fv if abs(p.y - y) < 0.014] or [min(fv, key=lambda p: abs(p.y - y))]
                x0 = min(p.x for p in near); x1 = max(p.x for p in near)
                zt = min(ztop, max(p.z for p in near))
                secs.append([y, (x0 + x1) / 2, (x1 - x0) / 2 + 0.011, zt + 0.011])
            for _ in range(3):
                for k in range(1, NSEC - 1):
                    for j in (1, 2, 3):
                        secs[k][j] = secs[k][j] * 0.5 + (secs[k - 1][j] + secs[k + 1][j]) * 0.25
            zb = zmin - 0.002
            rings = []
            for k, (y, xc, w, ht) in enumerate(secs):
                t = k / (NSEC - 1)
                e = max((1 - abs(2 * t - 1) ** 6) ** (1 / 6), 0.22)  # rounded heel and toe
                w_ = w * (0.55 + 0.45 * e)
                h_ = (ht - zb) * (0.45 + 0.55 * e) if t > 0.5 else (ht - zb) * (0.75 + 0.25 * e)
                lift = 0.012 * sm(0.8, 1.0, t)                   # toe spring
                ring = []
                for j in range(NPR):
                    a = math.pi * j / (NPR - 1)
                    c, sn = math.cos(a), math.sin(a)
                    ring.append(bm.verts.new(Vector((xc + math.copysign(abs(c) ** 0.6, c) * w_, y, zb + lift + (abs(sn) ** 0.45) * h_))))
                rings.append(ring)
            for k in range(NSEC - 1):
                t = (k + 0.5) / (NSEC - 1)
                for j in range(NPR - 1):
                    f = bm.faces.new((rings[k][j], rings[k][j + 1], rings[k + 1][j + 1], rings[k + 1][j]))
                    f.material_index = I_SH
                    if t > 0.86 or (t > 0.7 and (j <= 1 or j >= NPR - 3)): f.material_index = I_LA   # toe cap / bumper
                    if t < 0.1 and 5 <= j <= NPR - 7: f.material_index = I_LA                          # heel tab
                f = bm.faces.new((rings[k][NPR - 1], rings[k][0], rings[k + 1][0], rings[k + 1][NPR - 1])); f.material_index = I_SO
            for ring, rev in ((rings[0], False), (rings[-1], True)):
                f = bm.faces.new(list(reversed(ring)) if rev else ring); f.material_index = I_LA if rev else I_SH
            poly = [(r[0].co.x, r[0].co.y) for r in rings] + [(r[-1].co.x, r[-1].co.y) for r in reversed(rings)]
            cx = sum(p[0] for p in poly) / len(poly); cy = sum(p[1] for p in poly) / len(poly)
            M = len(poly); srings = []
            for (grow, dz) in ((0.003, 0.016), (0.006, 0.002), (0.005, -0.010), (-0.002, -0.0135)):
                ring = []
                for (x, y) in poly:
                    d = Vector((x - cx, (y - cy) * 0.35, 0)).normalized()
                    tt = (y - (ymax + 0.01)) / ((ymin - 0.016) - (ymax + 0.01))
                    ring.append(bm.verts.new(Vector((x, y, zb + dz + 0.012 * sm(0.8, 1.0, tt))) + d * grow))
                srings.append(ring)
            for r0, r1 in zip(srings, srings[1:]):
                for k in range(M):
                    f = bm.faces.new((r0[k], r1[k], r1[(k + 1) % M], r0[(k + 1) % M])); f.material_index = I_SO
            f = bm.faces.new(srings[-1]); f.material_index = I_SO
            for k in range(laces):
                y = lerp(0.035, -0.06, k / max(1, laces - 1))
                kk = min(range(NSEC), key=lambda i: abs(secs[i][0] - y))
                top = max(rings[kk], key=lambda v: v.co.z).co
                r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((secs[kk][1], y, top.z + 0.001)) @ Matrix.Diagonal((0.036, 0.0075, 0.005, 1)))
                for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = I_LA
            if collar:                                             # padded collar where the leg enters the shoe
                zl = max(v.co.z for r in rings for v in r) - 0.005
                pts = [O[i] for i in range(self.NV) if s_ * O[i].x > 0.03 and abs(O[i].z - (zl - 0.01)) < 0.01
                       and self.VGRP[i].get('calf', 0) + self.VGRP[i].get('foot', 0) > 0.5]
                if pts:
                    cc = sum(pts, Vector()) / len(pts)
                    rr = max(math.hypot(p.x - cc.x, p.y - cc.y) for p in pts) + 0.016
                    gi = sh.vertex_groups['foot_l' if s_ > 0 else 'foot_r'].index
                    torus(bm, Vector((cc.x, cc.y, zl)), Vector((0, 0, 1)), rr, 0.0068, seg=16, sides=6, mat=I_SH,
                          weights={gi: 1.0}, dl=sdl, scale=(1, 1.08))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(sh.data); bm.free()
        return sh

    def add_bones(self, chains):
        """chains: list of (parent bone, [names], [points (len names + 1)]) -> new connected bone chains"""
        arm = self.arm
        for o in bpy.context.selected_objects: o.select_set(False)
        bpy.context.view_layer.objects.active = arm; arm.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        eb = arm.data.edit_bones; inv = arm.matrix_world.inverted()
        for parent, names, pts in chains:
            prev = eb[parent]
            for k, n in enumerate(names):
                b = eb.new(n); b.head = inv @ pts[k]; b.tail = inv @ pts[k + 1]
                b.parent = prev; b.use_connect = k > 0; prev = b
        bpy.ops.object.mode_set(mode='OBJECT')

    def tube(self, ob, bm, C, bones, root_bone, radius_fn, mat, rad=12, section=None, twist=1.2, root_blend=0.35, cap_root=True, side=Vector((1, 0, 0))):
        """closed tube along centre points C, weighted along `bones` by arclength (root blends from root_bone).
        section(a, u) -> (sx, sy) multipliers for the cross-section (default: soft 4-lock clumps)."""
        dl = bm.verts.layers.deform.verify()
        for n in [root_bone] + bones:
            if n not in ob.vertex_groups: ob.vertex_groups.new(name=n)
        gidx = {n: ob.vertex_groups[n].index for n in [root_bone] + bones}
        L = [0.0]
        for a, b in zip(C, C[1:]): L.append(L[-1] + (b - a).length)
        NB, NS = len(bones), len(C)
        def weights(u):
            seg = u * NB; b0 = min(NB - 1, int(seg)); fr = seg - b0
            w = {}
            if seg < root_blend:
                w[root_bone] = 1 - seg / root_blend; w[bones[0]] = seg / root_blend
            else:
                w[bones[b0]] = 1 - max(0, fr - 0.5)
                if fr > 0.5 and b0 < NB - 1: w[bones[b0 + 1]] = fr - 0.5
            s_ = sum(w.values()); return {gidx[n]: x / s_ for n, x in w.items()}
        rings, new = [], []
        for k, c in enumerate(C):
            u = L[k] / L[-1]
            tdir = (C[min(k + 1, NS - 1)] - C[max(k - 1, 0)]).normalized()
            sd = (side - tdir * side.dot(tdir)).normalized(); n2 = tdir.cross(sd).normalized()
            r = max(0.002, radius_fn(u)); ring = []
            for j in range(rad):
                a = 2 * math.pi * j / rad + u * twist
                if section: sx, sy = section(a, u)
                else:
                    cl = 1 + 0.12 * math.cos(a * 4 - u * 3); sx, sy = 1.15 * cl, 0.9 * cl
                v = bm.verts.new(c + (sd * math.cos(a) * sx + n2 * math.sin(a) * sy) * r)
                for gi, w in weights(u).items(): v[dl][gi] = w
                ring.append(v); new.append(v)
            rings.append(ring)
        for r0, r1 in zip(rings, rings[1:]):
            for j in range(rad):
                f = bm.faces.new((r0[j], r1[j], r1[(j + 1) % rad], r0[(j + 1) % rad])); f.material_index = mat
        tip = bm.verts.new(C[-1] + (C[-1] - C[-2]).normalized() * 0.008); new.append(tip)
        tip[dl][gidx[bones[-1]]] = 1.0
        faces = []
        for j in range(rad):
            f = bm.faces.new((rings[-1][j], tip, rings[-1][(j + 1) % rad])); f.material_index = mat
        if cap_root:
            f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mat
        nv = set(new)
        bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if any(v in nv for v in f.verts)])
        return L

    def transfer_weights(self, ob, only=None):
        """nearest-surface (interpolated) skin weights from the full reference body"""
        mod = ob.modifiers.new('wt', 'DATA_TRANSFER')
        mod.object = self.ref; mod.use_vert_data = True
        mod.data_types_verts = {'VGROUP_WEIGHTS'}; mod.vert_mapping = 'POLYINTERP_NEAREST'
        mod.layers_vgroup_select_src = 'ALL'; mod.layers_vgroup_select_dst = 'NAME'
        if only is not None:
            vg = ob.vertex_groups.get('__new') or ob.vertex_groups.new(name='__new')
            vg.add(only, 1.0, 'REPLACE'); mod.vertex_group = '__new'
        bpy.context.view_layer.objects.active = ob
        for o in bpy.context.selected_objects: o.select_set(False)
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        if only is not None: ob.vertex_groups.remove(ob.vertex_groups['__new'])

    def unweighted(self, ob):
        return [v.index for v in ob.data.vertices if not len(v.groups)]

    def drop_body_faces(self, faces, skin_mat):
        bm = edit(self.body)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in faces], context='FACES')
        done(self.body, bm)
        self.body.data.materials.clear(); self.body.data.materials.append(material(skin_mat))
        sk = material(skin_mat)                     # preview-only face texture (export skips images)
        if self.skin_tex and os.path.exists(self.skin_tex) and not any(n.type == 'TEX_IMAGE' for n in sk.node_tree.nodes):
            tn = sk.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(self.skin_tex)
            sk.node_tree.links.new(tn.outputs['Color'], sk.node_tree.nodes['Principled BSDF'].inputs['Base Color'])

    def finalize(self, outfit_parts, other_parts, smooth_parts=()):
        """parent + clean weights, join outfit parts into <Hero>_Outfit, save .blend, export glb"""
        arm = self.arm
        for ob in list(outfit_parts) + list(other_parts) + [self.body]:
            bpy.context.view_layer.objects.active = ob
            for o in bpy.context.selected_objects: o.select_set(False)
            ob.select_set(True)
            for m in list(ob.modifiers): ob.modifiers.remove(m)
            ob.parent = arm
            mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
            if ob in smooth_parts:
                bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
                bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.35, repeat=2, expand=0.0)
                bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
            bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
            for p in ob.data.polygons: p.use_smooth = True
            if ob.data.has_custom_normals:
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.data.objects.remove(self.ref)
        for o in bpy.context.selected_objects: o.select_set(False)
        first = outfit_parts[0]
        for ob in outfit_parts: ob.select_set(True)
        bpy.context.view_layer.objects.active = first
        bpy.ops.object.join()
        first.name = self.hero.capitalize() + '_Outfit'
        objs = [self.body, first] + list(other_parts) + [o for o in (self.eyes, self.brows) if o]
        print('TRIS', {o.name: tri_count([o]) for o in objs}, 'total', tri_count(objs))
        try: bpy.ops.file.pack_all()
        except Exception as e: print('pack failed', e)
        bpy.ops.wm.save_as_mainfile(filepath=blend_path(self.hero), compress=True)
        for o in bpy.data.objects: o.select_set(False)
        for o in [arm, self.body, first] + list(other_parts): o.select_set(True)
        out = glb_path(self.hero)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=False,
                                  export_yup=True, export_skins=True, export_image_format='NONE', export_all_influences=False,
                                  export_morph=False, export_extras=False, export_apply=True)
        print('exported', out, os.path.getsize(out))


# ------------------------------------------------------------------ rendering
def setup_render(res=(700, 1000), engine='BLENDER_WORKBENCH'):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    if engine == 'BLENDER_WORKBENCH':
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = os.environ.get('COLOR_TYPE', 'TEXTURE')
        sh.show_object_outline = True
        sh.object_outline_color = (0.02, 0.02, 0.04)
        sh.show_cavity = True
        sh.cavity_type = 'WORLD'
        sh.show_specular_highlight = False
    sc.display_settings.display_device = 'sRGB'
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.get('W') or bpy.data.worlds.new('W')
    world.color = (0.16, 0.13, 0.22)
    sc.world = world


def camera(target, yaw_deg, dist=4.0, ortho=1.0, elev_deg=6.0):
    """yaw 0 = front (character faces -Y), 90 = character's left side."""
    cam = bpy.data.objects.get('PreviewCam')
    if cam is None:
        cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ortho
    y, e = math.radians(yaw_deg), math.radians(elev_deg)
    d = Vector((math.sin(y) * math.cos(e), -math.cos(y) * math.cos(e), math.sin(e)))
    cam.location = Vector(target) + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tri_count(objs):
    n = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH': continue
        me = o.evaluated_get(dg).to_mesh()
        n += sum(len(p.vertices) - 2 for p in me.polygons)
        o.evaluated_get(dg).to_mesh_clear()
    return n
