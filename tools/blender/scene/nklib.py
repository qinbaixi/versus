"""Shared helpers for the Neon Knuckles scene kits (Blender 4.0, --background).

Conventions (Blender space; the glTF exporter turns +Z up into +Y up and -Y into +Z):
  * x = along the street, z = up, -y = towards the camera / street.
  * A facade module has its front plane at y = 0, x centred on 0, ground at z = 0.
  * 1 unit ~ 1.75 cm (heroes are 100 units tall).
Every face is UV-mapped into the shared atlas (atlas.py): flat-colour faces put all
their UVs on a swatch centre; textured faces map onto a region rectangle.
Material slot names ('atlas', 'fence', 'puddle') are what world.js looks up.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import atlas as A  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(REPO, 'priv', 'www', 'assets', 'scene')
PREVIEW = os.environ.get('NK_PREVIEW', '/mnt/project-files/neon-knuckles-v5/scene')

SIDE_N = {'-y': Vector((0, -1, 0)), '+y': Vector((0, 1, 0)), '-x': Vector((-1, 0, 0)),
          '+x': Vector((1, 0, 0)), '+z': Vector((0, 0, 1)), '-z': Vector((0, 0, -1))}


def side_of(n):
    best, bs = None, -2
    for k, v in SIDE_N.items():
        d = n.dot(v)
        if d > bs:
            best, bs = k, d
    return best


def face_uv_planar(side, p, lo, hi):
    """normalised (u, v) of point p on a box side; lo/hi are box corners"""
    sx, sy, sz = (hi[i] - lo[i] or 1 for i in range(3))
    x, y, z = (p[0] - lo[0]) / sx, (p[1] - lo[1]) / sy, (p[2] - lo[2]) / sz
    return {'-y': (x, z), '+y': (1 - x, z), '-x': (1 - y, z), '+x': (y, z), '+z': (x, y), '-z': (x, 1 - y)}[side]


def resolve(spec):
    """spec -> ('sw', uv) | ('reg', rect, mat).  spec: 'swatch' | ('reg', 'name') | ('fence', 'name')"""
    if isinstance(spec, tuple):
        kind, name = spec[0], spec[1]
        sub = spec[2] if len(spec) > 2 else None
        r = A.region_uv(name)
        if sub:   # sub-rectangle in region fractions
            u0, v0, u1, v1 = r
            r = (u0 + (u1 - u0) * sub[0], v0 + (v1 - v0) * sub[1], u0 + (u1 - u0) * sub[2], v0 + (v1 - v0) * sub[3])
        return ('reg', r, 'fence' if kind == 'fence' else ('puddle' if kind == 'puddle' else 'atlas'))
    return ('sw', A.swatch_uv(spec), 'atlas')


class Part:
    """Accumulates triangles/quads for one exported object."""

    def __init__(self, name):
        self.name = name
        self.V, self.F, self.UV, self.MI = [], [], [], []
        self.mats = []
        self.anchors = []
        self.matmap = {}   # e.g. {'atlas': 'far'} to give a whole object another material slot name

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add_face(self, pts, uvs, mat='atlas'):
        base = len(self.V)
        self.V.extend([tuple(p) for p in pts])
        self.F.append(tuple(range(base, base + len(pts))))
        self.UV.append([tuple(u) for u in uvs])
        self.MI.append(self.mat(mat))

    def add_bm(self, bm, M, uvfun):
        """append a bmesh (vertices stay welded so smooth shading works); uvfun(face, co) -> (uv, mat)"""
        bm.normal_update()
        bm.verts.index_update()
        idx = {}
        for v in bm.verts:
            idx[v.index] = len(self.V)
            self.V.append(tuple(M @ v.co))
        for f in bm.faces:
            uvs = []
            mat = 'atlas'
            for lp in f.loops:
                uv, mat = uvfun(f, lp.vert.co)
                uvs.append(tuple(uv))
            self.F.append(tuple(idx[lp.vert.index] for lp in f.loops))
            self.UV.append(uvs)
            self.MI.append(self.mat(mat))
        bm.free()

    # ------------------------------------------------------------ primitives
    def box(self, lo, hi, sw, bevel=0.0, sides=None, M=None):
        """axis-aligned box lo..hi (then optional matrix M). sw = default spec;
        sides = {'-y': spec, ...} overrides per side (spec = swatch or ('reg', name))."""
        lo, hi = Vector(lo), Vector(hi)
        size = hi - lo
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((lo.x + (v.co.x + 0.5) * size.x, lo.y + (v.co.y + 0.5) * size.y, lo.z + (v.co.z + 0.5) * size.z))
        if bevel > 0:
            b = min(bevel, min(size) * 0.45)
            bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=b, offset_type='OFFSET', segments=1,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        sides = sides or {}
        default = resolve(sw)
        rs = {k: resolve(v) for k, v in sides.items()}

        def uvf(f, co):
            s = side_of(f.normal)
            if abs(f.normal.dot(SIDE_N[s])) > 0.95 and s in rs:
                r = rs[s]
            else:
                r = default
            if r[0] == 'sw':
                return r[1], r[2]
            u, v = face_uv_planar(s, co, lo, hi)
            u0, v0, u1, v1 = r[1]
            return (u0 + (u1 - u0) * min(1, max(0, u)), v0 + (v1 - v0) * min(1, max(0, v))), r[2]
        self.add_bm(bm, M or Matrix(), uvf)

    def boxc(self, c, s, sw, **kw):
        """box from centre + size"""
        c, s = Vector(c), Vector(s)
        self.box(c - s / 2, c + s / 2, sw, **kw)

    def cyl(self, base, r, h, sw, seg=12, r2=None, cap=None, axis='z', M=None, cap_ends=True):
        """cylinder / cone standing on `base` along axis (z, x or y)"""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap_ends, cap_tris=False, segments=seg, radius1=r,
                              radius2=r if r2 is None else r2, depth=h)
        rot = {'z': Matrix(), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'y': Matrix.Rotation(-math.pi / 2, 4, 'X')}[axis]
        T = (M or Matrix()) @ Matrix.Translation(Vector(base)) @ rot @ Matrix.Translation((0, 0, h / 2))
        side, capr = resolve(sw), resolve(cap or sw)

        def uvf(f, co):
            r_ = capr if abs(f.normal.z) > 0.9 else side
            if r_[0] == 'sw':
                return r_[1], r_[2]
            u0, v0, u1, v1 = r_[1]
            if abs(f.normal.z) > 0.9:   # disc mapping for caps
                rr = max(r, r2 or 0) or 1
                return (u0 + (u1 - u0) * (co.x / rr * 0.5 + 0.5), v0 + (v1 - v0) * (co.y / rr * 0.5 + 0.5)), r_[2]
            a = (math.atan2(co.y, co.x) / (2 * math.pi)) % 1.0
            return (u0 + (u1 - u0) * a, v0 + (v1 - v0) * (co.z / h + 0.5)), r_[2]
        self.add_bm(bm, T, uvf)

    def rod(self, p0, p1, r, sw, seg=8, cap_ends=True):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        self.cyl((0, 0, 0), r, d.length, sw, seg=seg, M=Matrix.Translation(p0) @ q, cap_ends=cap_ends)

    def beam(self, p0, p1, w, h, sw, bevel=0.0, up=(0, 0, 1)):
        """square-ish beam from p0 to p1 (w across, h along `up`)"""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        x = d.normalized()
        upv = Vector(up)
        if abs(x.dot(upv)) > 0.99:
            upv = Vector((0, 1, 0)) if abs(x.y) < 0.9 else Vector((1, 0, 0))
        y = upv.cross(x).normalized()
        z = x.cross(y)
        R = Matrix((x, y, z)).transposed().to_4x4()
        self.box((0, -w / 2, -h / 2), (L, w / 2, h / 2), sw, bevel=bevel, M=Matrix.Translation(p0) @ R)

    def quad(self, p0, p1, p2, p3, spec, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
        """quad p0..p3 counter-clockwise seen from the front; uv fractions into spec's region"""
        r = resolve(spec)
        if r[0] == 'sw':
            self.add_face([p0, p1, p2, p3], [r[1]] * 4, r[2])
        else:
            u0, v0, u1, v1 = r[1]
            self.add_face([p0, p1, p2, p3], [(u0 + (u1 - u0) * a, v0 + (v1 - v0) * b) for a, b in uv], r[2])

    def front(self, x0, z0, x1, z1, y, spec, uv=None):
        """front-facing (-y) quad"""
        self.quad((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1), spec, uv or ((0, 0), (1, 0), (1, 1), (0, 1)))

    def floor(self, x0, y0, x1, y1, z, spec, uv=None):
        """upward-facing quad (front edge = y0)"""
        self.quad((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), spec, uv or ((0, 0), (1, 0), (1, 1), (0, 1)))

    def poly_floor(self, pts, z, spec):
        """upward-facing convex/star polygon (fan), planar UVs over its bbox"""
        r = resolve(spec)
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)

        def uv(p):
            if r[0] == 'sw':
                return r[1]
            u0, v0, u1, v1 = r[1]
            return (u0 + (u1 - u0) * (p[0] - x0) / (x1 - x0), v0 + (v1 - v0) * (p[1] - y0) / (y1 - y0))
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            self.add_face([(cx, cy, z), (a[0], a[1], z), (b[0], b[1], z)], [uv((cx, cy)), uv(a), uv(b)], r[2])

    def ico(self, c, r, sw, sub=1, sc=(1, 1, 1), seed=0, jitter=0.0):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        if jitter:
            import random
            rr = random.Random(seed)
            for v in bm.verts:
                v.co *= 1 + rr.uniform(-jitter, jitter)
        T = Matrix.Translation(Vector(c)) @ Matrix.Diagonal(Vector(sc)).to_4x4()
        res = resolve(sw)
        self.add_bm(bm, T, lambda f, co: (res[1], res[2]))

    def extrude(self, prof, x0, x1, sw, cap=None, sides=None):
        """extrude a (y, z) profile polygon (counter-clockwise seen from +x) along x.
        sides: optional list of specs per profile edge (region specs map u along x, v along edge)"""
        n = len(prof)
        r_cap = resolve(cap or sw)
        for i in range(n):
            (ya, za), (yb, zb) = prof[i], prof[(i + 1) % n]
            spec = sides[i] if sides and sides[i] else sw
            r = resolve(spec)
            pts = [(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)]
            if r[0] == 'sw':
                self.add_face(pts, [r[1]] * 4, r[2])
            else:
                u0, v0, u1, v1 = r[1]
                self.add_face(pts, [(u0, v0), (u0, v1), (u1, v1), (u1, v0)], r[2])
        # caps
        cu = [r_cap[1]] * n if r_cap[0] == 'sw' else [((r_cap[1][0] + r_cap[1][2]) / 2, (r_cap[1][1] + r_cap[1][3]) / 2)] * n
        self.add_face([(x1, y, z) for y, z in prof], cu, r_cap[2])
        self.add_face([(x0, y, z) for y, z in reversed(prof)], cu, r_cap[2])

    def anchor(self, kind, loc, **props):
        self.anchors.append((kind, tuple(loc), props))

    def extend(self, other, M=None):
        M = M or Matrix()
        base = len(self.V)
        self.V.extend(tuple(M @ Vector(v)) for v in other.V)
        for f, uvs, mi in zip(other.F, other.UV, other.MI):
            self.F.append(tuple(base + i for i in f))
            self.UV.append(list(uvs))
            self.MI.append(self.mat(other.mats[mi]))
        for kind, loc, props in other.anchors:
            self.anchors.append((kind, tuple(M @ Vector(loc)), props))

    # ------------------------------------------------------------ to Blender
    def to_object(self, coll=None, **props):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.V, [], self.F)
        uvl = me.uv_layers.new(name='UVMap')
        k = 0
        for poly, uvs in zip(me.polygons, self.UV):
            for li, uv in zip(poly.loop_indices, uvs):
                uvl.data[li].uv = uv
            k += 1
        for m in self.mats:
            me.materials.append(get_material(self.matmap.get(m, m)))
        me.polygons.foreach_set('material_index', self.MI)
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(40)
        me.validate()
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        (coll or bpy.context.scene.collection).objects.link(ob)
        for key, val in props.items():
            ob[key] = val
        for i, (kind, loc, pr) in enumerate(self.anchors):
            e = bpy.data.objects.new(f'{self.name}~{kind}~{i}', None)
            e.empty_display_size = 6
            e.location = loc
            e['anchor'] = kind
            for key, val in pr.items():
                e[key] = val
            (coll or bpy.context.scene.collection).objects.link(e)
            e.parent = ob
        return ob

    def tris(self):
        return sum(len(f) - 2 for f in self.F)


# ---------------------------------------------------------------- materials

def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


_IMG = {}


def load_img(name):
    if name not in _IMG:
        p = os.path.join(OUT, name)
        img = bpy.data.images.load(p, check_existing=True)
        if name == 'atlas_e.png':
            img.colorspace_settings.name = 'sRGB'
        _IMG[name] = img
    return _IMG[name]


def get_material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.85
    try:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = load_img('atlas.png')
        tex.interpolation = 'Closest'
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = load_img('atlas_e.png')
        te.interpolation = 'Closest'
        nt.links.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 2.5
        if name == 'fence':
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP'
        if name == 'puddle':
            bsdf.inputs['Roughness'].default_value = 0.05
            bsdf.inputs['Metallic'].default_value = 0.6
    except Exception as e:  # images missing: flat material still exports fine
        print('material warn', e)
    return m


# ---------------------------------------------------------------- scene / export / preview

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _IMG.clear()


def _props(idb):
    out = {}
    for k in idb.keys():
        v = idb[k]
        if hasattr(v, 'to_list'):
            v = v.to_list()
        elif hasattr(v, 'to_dict'):
            v = v.to_dict()
        out[k] = v
    return out


def export_glb(objs, path):
    """Minimal pure-Python glTF 2.0 (.glb) writer — Blender's own exporter needs numpy, which
    distro builds of Blender lack.  Writes POSITION/NORMAL/TEXCOORD_0 + indices per material,
    materials by name only (the game binds the shared atlas textures itself), object custom
    properties as extras, and anchor empties as child nodes.  Blender Z-up -> glTF Y-up."""
    import json, struct
    gl = {'asset': {'version': '2.0', 'generator': 'neon-knuckles nklib'}, 'scenes': [{'nodes': []}], 'scene': 0,
          'nodes': [], 'meshes': [], 'accessors': [], 'bufferViews': [], 'buffers': [], 'materials': []}
    binbuf = bytearray()
    matidx = {}

    def view(data, target=None):
        while len(binbuf) % 4:
            binbuf.append(0)
        v = {'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(data)}
        if target:
            v['target'] = target
        binbuf.extend(data)
        gl['bufferViews'].append(v)
        return len(gl['bufferViews']) - 1

    def acc(vals, typ, comp=5126, minmax=False):
        n = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[typ]
        if typ == 'SCALAR':
            fmt = '<%d%s' % (len(vals), 'I' if comp == 5125 else 'H')
            data = struct.pack(fmt, *vals)
            if len(data) % 4:
                data += b'\0' * (4 - len(data) % 4)
            bv = view(data, 34963)
            a = {'bufferView': bv, 'componentType': comp, 'count': len(vals), 'type': typ}
        else:
            flat = [c for v in vals for c in v]
            bv = view(struct.pack('<%df' % len(flat), *flat), 34962)
            a = {'bufferView': bv, 'componentType': 5126, 'count': len(vals), 'type': typ}
            if minmax:
                a['min'] = [min(v[i] for v in vals) for i in range(n)]
                a['max'] = [max(v[i] for v in vals) for i in range(n)]
        gl['accessors'].append(a)
        return len(gl['accessors']) - 1

    def conv(v):
        return (round(v[0], 4), round(v[2], 4), round(-v[1], 4))

    for ob in objs:
        me = ob.data
        me.calc_normals_split()
        me.calc_loop_triangles()
        uvl = me.uv_layers.active.data
        verts, loops = me.vertices, me.loops
        prims = {}
        for tri in me.loop_triangles:
            P = prims.setdefault(tri.material_index, [{}, [], [], [], []])
            for li in tri.loops:
                lp = loops[li]
                n, uv = lp.normal, uvl[li].uv
                key = (lp.vertex_index, round(n.x, 3), round(n.y, 3), round(n.z, 3), round(uv.x, 5), round(uv.y, 5))
                k = P[0].get(key)
                if k is None:
                    k = P[0][key] = len(P[1])
                    P[1].append(conv(verts[lp.vertex_index].co))
                    P[2].append(conv(n))
                    P[3].append((round(uv.x, 6), round(1 - uv.y, 6)))
                P[4].append(k)
        mesh = {'name': ob.name, 'primitives': []}
        for mi in sorted(prims):
            P = prims[mi]
            mname = me.materials[mi].name if mi < len(me.materials) else 'atlas'
            if mname not in matidx:
                matidx[mname] = len(gl['materials'])
                gl['materials'].append({'name': mname, 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1}})
            big = len(P[1]) > 65535
            mesh['primitives'].append({'attributes': {'POSITION': acc(P[1], 'VEC3', minmax=True), 'NORMAL': acc(P[2], 'VEC3'),
                                                      'TEXCOORD_0': acc(P[3], 'VEC2')},
                                       'indices': acc(P[4], 'SCALAR', 5125 if big else 5123), 'material': matidx[mname]})
        gl['meshes'].append(mesh)
        node = {'name': ob.name, 'mesh': len(gl['meshes']) - 1}
        ex = _props(ob)
        if ex:
            node['extras'] = ex
        if ob.location.length > 1e-6:
            node['translation'] = list(conv(ob.location))
        kids = []
        for c in ob.children:
            cn = {'name': c.name, 'translation': list(conv(c.location)), 'extras': _props(c)}
            gl['nodes'].append(cn)
            kids.append(len(gl['nodes']) - 1)
        if kids:
            node['children'] = kids
        gl['nodes'].append(node)
        gl['scenes'][0]['nodes'].append(len(gl['nodes']) - 1)
    while len(binbuf) % 4:
        binbuf.append(0)
    gl['buffers'].append({'byteLength': len(binbuf)})
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binbuf))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binbuf), 0x004E4942) + bytes(binbuf)
    with open(path, 'wb') as f:
        f.write(out)
    print('exported', path, len(out), 'bytes')


def _setup_render(res, samples):
    scn = bpy.context.scene
    if scn.world is None:
        w = bpy.data.worlds.new('w')
        w.use_nodes = True
        w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.012, 0.05, 1)
        w.node_tree.nodes['Background'].inputs['Strength'].default_value = 3.0
        scn.world = w
        for nm, en, col, rot in (('key', 3.2, (1.0, 0.86, 0.92), (55, -20, -15)), ('fill', 0.8, (0.45, 0.5, 1.0), (70, 40, 30))):
            L = bpy.data.lights.new(nm, 'SUN')
            L.energy, L.color = en, col
            lo = bpy.data.objects.new(nm, L)
            lo.rotation_euler = tuple(math.radians(v) for v in rot)
            scn.collection.objects.link(lo)
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = samples
    scn.cycles.use_denoising = False
    scn.cycles.filter_width = 1.2
    scn.cycles.max_bounces = 3
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.view_settings.view_transform = 'Standard'


def preview(objs, path, per=10, rows=2, gap=40, res=(1920, 1080), pitch=15, samples=32):
    """Render the kit in pages of `per` objects (rows stacked vertically, each on a dark floor
    slab) with an orthographic camera pitched like the game camera.  Writes path, path_2, ..."""
    scn = bpy.context.scene
    _setup_render(res, samples)
    gmat = bpy.data.materials.new('groundmat')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.03, 0.025, 0.04, 1)
    pages = [objs[i:i + per] for i in range(0, len(objs), per)]
    for pi, page in enumerate(pages):
        temp = []
        for o in objs:
            o.hide_render = o not in page
        for o in page:
            o.location = (0, 0, 0)
        bpy.context.view_layer.update()
        info = []
        for o in page:
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            info.append((min(v.x for v in bb), max(v.x for v in bb), min(v.z for v in bb), max(v.z for v in bb)))
        rowlen = sum(i[1] - i[0] + gap for i in info) / rows
        x, zrow, height = 0, 0, 0
        rowz = [0]
        for o, (mn, mx, zn, zx) in zip(page, info):
            if x > 0 and x + (mx - mn) > rowlen * 1.05:
                x, zrow, height = 0, zrow - height - 90, 0
                rowz.append(zrow)
            o.location = (x - mn, 0, zrow)
            x += mx - mn + gap
            height = max(height, zx - zn)
        bpy.context.view_layer.update()
        pts = [o.matrix_world @ Vector(c) for o in page for c in o.bound_box]
        x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
        for i, rz in enumerate(rowz):
            gm = bpy.data.meshes.new('ground')
            gm.from_pydata([(x0 - 200, -120, rz - 0.5), (x1 + 200, -120, rz - 0.5), (x1 + 200, 400, rz - 0.5), (x0 - 200, 400, rz - 0.5)], [], [(0, 1, 2, 3)])
            gm.materials.append(gmat)
            g = bpy.data.objects.new('ground', gm)
            scn.collection.objects.link(g)
            temp.append(g)
        cam = bpy.data.cameras.new('cam')
        cam.type = 'ORTHO'
        aspect = res[0] / res[1]
        a = math.radians(pitch)
        fwd, up = Vector((0, math.cos(a), -math.sin(a))), Vector((0, math.sin(a), math.cos(a)))
        us = [p.dot(up) for p in pts]
        u0, u1 = min(us), max(us)
        cam.ortho_scale = max((x1 - x0) * 1.04, (u1 - u0) * 1.08 * aspect)
        cam.clip_end = 30000
        co = bpy.data.objects.new('cam', cam)
        scn.collection.objects.link(co)
        co.location = Vector(((x0 + x1) / 2, 0, 0)) + up * ((u0 + u1) / 2) - fwd * 8000
        co.rotation_euler = (math.pi / 2 - a, 0, 0)
        scn.camera = co
        temp.append(co)
        out = path if pi == 0 else path.replace('.png', '_%d.png' % (pi + 1))
        scn.render.filepath = out
        os.makedirs(os.path.dirname(out), exist_ok=True)
        bpy.ops.render.render(write_still=True)
        print('preview', out)
        for t in temp:
            bpy.data.objects.remove(t, do_unlink=True)
    for o in objs:
        o.hide_render = False
