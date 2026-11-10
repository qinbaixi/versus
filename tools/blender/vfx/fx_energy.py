"""elec_spark (robot-hit electric arcs, 3 variants) / super_flash (super start starburst) /
speed_lines (dash / run streaks, loop).  Additive.

    blender --background --python tools/blender/vfx/fx_energy.py -- elec|flash|speed

elec: every frame gets fresh seeded lightning (midpoint-displacement polylines with forks, built as
tapered ribbons and switched per frame with keyed render visibility), plus a particle burst of tiny
sparks with motion blur and a compositor fog glow.
flash: 32 tapered rays + a hot core star + a ring, keyed to snap open, rotate a little and collapse.
speed: 30 seeded tapered streak ribbons (two copies one wrap-span apart) slide exactly one span per loop
with motion blur -> seamless loop.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

KIND = (argv() or ['elec'])[0]
ELEC = {'stops': [[0, '#000000'], [0.05, '#2a0c6a'], [0.16, '#6a3cff'], [0.34, '#3ad8ff'],
                  [0.62, '#c8fbff'], [0.86, '#ffffff']], 'soft': 0.03}
FLASH = {'stops': [[0, '#000000'], [0.06, '#4a2a10'], [0.2, '#b06a20'], [0.42, '#ffc860'],
                   [0.68, '#fff0c0'], [0.88, '#ffffff']], 'soft': 0.03}
SPEED = {'stops': [[0, '#000000'], [0.06, '#103050'], [0.22, '#3a8ac0'], [0.48, '#a8e4ff'],
                   [0.78, '#ffffff']], 'soft': 0.03}


def bolt(rnd, a, b, disp, depth=5):
    pts = [a, b]
    for _ in range(depth):
        nxt = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            d = q - p
            nrm = Vector((-d.z, 0, d.x)).normalized() if d.length > 1e-6 else Vector((0, 0, 1))
            mid = (p + q) / 2 + nrm * rnd.uniform(-disp, disp) * d.length
            nxt += [mid, q]
        pts = nxt
    return pts


def vis_keys(ob, f, nf):
    """object rendered only on frame f"""
    for fr in sorted({1, f - 1, f, f + 1, nf}):
        if fr < 1:
            continue
        ob.hide_render = fr != f
        ob.keyframe_insert('hide_render', frame=fr)
    for fc in ob.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'


if KIND == 'elec':
    NF = 8
    for var in range(3):
        reset()
        rnd = random.Random(900 + var * 101)
        setup(res=(128, 128), frames=(1, NF), samples=48, fps=24, blur=0.8)
        camera(1.25)
        mat = emission_mat('arc', (1, 1, 1, 1), 1.0)
        for f in range(1, NF + 1):
            life = 1 - (f - 1) / NF
            nb = max(1, int(round((4 + rnd.randint(0, 2)) * life)))
            for b in range(nb):
                ang = rnd.uniform(0, 2 * math.pi)
                L = rnd.uniform(0.3, 0.58) * (0.6 + 0.4 * life)
                a = Vector((math.cos(ang), 0, math.sin(ang))) * rnd.uniform(0.0, 0.08)
                e = Vector((math.cos(ang), 0, math.sin(ang))) * L
                pts = bolt(rnd, a, e, 0.42)
                w = 0.016 * (0.5 + life)
                ws = [w * (1 - 0.7 * i / len(pts)) for i in range(len(pts))]
                ob = ribbon_mesh(f'b{f}_{b}', pts, ws, normal_fn=lambda i, p, t: Vector((0, -1, 0)).cross(t).normalized())
                ob.data.materials.append(mat)
                vis_keys(ob, f, NF)
                ob.cycles.use_motion_blur = False
                if rnd.random() < 0.7:
                    j = rnd.randint(len(pts) // 3, 2 * len(pts) // 3)
                    a2 = ang + rnd.choice((-1, 1)) * rnd.uniform(0.4, 0.9)
                    e2 = pts[j] + Vector((math.cos(a2), 0, math.sin(a2))) * L * 0.45
                    p2 = bolt(rnd, pts[j], e2, 0.45, 4)
                    ob2 = ribbon_mesh(f'k{f}_{b}', p2, [ws[j] * 0.6] * len(p2),
                                      normal_fn=lambda i, p, t: Vector((0, -1, 0)).cross(t).normalized())
                    ob2.data.materials.append(mat)
                    vis_keys(ob2, f, NF)
                    ob2.cycles.use_motion_blur = False
        # core flash
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, location=(0, 0.2, 0))
        core = bpy.context.active_object
        cm = emission_mat('core', (1, 1, 1, 1), 6.0)
        core.data.materials.append(cm)
        core.cycles.use_motion_blur = False
        for f, s in ((1, 1.4), (2, 1.0), (3, 0.4), (4, 0.0)):
            core.scale = (s, s, s)
            core.keyframe_insert('scale', frame=f)
        # sparks
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.03)
        em = bpy.context.active_object
        em.show_instancer_for_render = False
        ps = em.modifiers.new('sp', 'PARTICLE_SYSTEM').particle_system
        ps.seed = 3 + var
        s = ps.settings
        s.count = 14
        s.frame_start, s.frame_end = 1, 2
        s.lifetime = 6
        s.lifetime_random = 0.5
        s.normal_factor = 3.0
        s.factor_random = 1.5
        s.effector_weights.gravity = 0.4
        s.damping = 0.15
        s.render_type = 'OBJECT'
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=1, location=(0, 0, -40))
        dot = bpy.context.active_object
        dot.data.materials.append(emission_mat('dot', (1, 1, 1, 1), 5.0))
        s.instance_object = dot
        s.particle_size = 0.008
        glare('FOG_GLOW', threshold=0.5, size=6, mix=-0.3)
        render('elec_spark', dict(mode='additive', blending='additive', cols=8, rows=3, fps=24, loop=False,
                                  size=90, pivot=[0.5, 0.5], billboard=True, edge=0.05, grade=ELEC,
                                  use='hits on Voltex robots (with or instead of hit_spark); stun / short-circuit'),
               variant=var)

elif KIND == 'flash':
    reset()
    NF = 16
    setup(res=(256, 256), frames=(1, NF), samples=48, fps=30)
    camera(2.4)
    rnd = random.Random(55)
    verts, faces = [], []
    for i in range(32):
        a = 2 * math.pi * i / 32 + rnd.uniform(-0.06, 0.06)
        L = rnd.uniform(0.55, 1.15) if i % 2 == 0 else rnd.uniform(0.3, 0.6)
        w = rnd.uniform(0.03, 0.06)
        c, s_ = math.cos(a), math.sin(a)
        n = len(verts)
        verts += [(-s_ * w, 0, c * w), (c * L, 0, s_ * L), (s_ * w, 0, -c * w)]
        faces.append((n, n + 1, n + 2))
    rays = mesh_obj('Rays', verts, faces)
    ca = rays.data.color_attributes.new('rad', 'FLOAT_COLOR', 'POINT')
    for i in range(len(verts)):
        c = 0.0 if i % 3 == 1 else 1.0
        ca.data[i].color = (c, c, c, 1)
    m, nt, out = nodes_mat('rays')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'rad'
    k = nt.nodes.new('ShaderNodeValue')
    pw = math_node(nt, 'POWER', vc.outputs['Color'], 1.5)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(math_node(nt, 'MULTIPLY', pw.outputs[0], k.outputs[0]).outputs[0], em.inputs[1])
    nt.links.new(em.outputs[0], out.inputs[0])
    rays.data.materials.append(m)
    for f, sc_, kv, rot in ((1, 0.15, 3.0, 0), (3, 1.0, 2.6, 0.05), (8, 1.05, 1.8, 0.14), (12, 0.7, 0.9, 0.2),
                            (16, 0.3, 0.0, 0.24)):
        rays.scale = (sc_, 1, sc_)
        rays.rotation_euler = (0, rot, 0)
        rays.keyframe_insert('scale', frame=f)
        rays.keyframe_insert('rotation_euler', frame=f)
        k.outputs[0].default_value = kv
        k.outputs[0].keyframe_insert('default_value', frame=f)
    # core
    core = ring_mesh('Core', 0.0, 0.32, seg=64)
    core.rotation_euler = (math.pi / 2, 0, 0)
    core.location.y = -0.5
    m2, nt2, out2 = nodes_mat('core')
    sp = sep_xyz(nt2, nt2.nodes.new('ShaderNodeTexCoord').outputs['UV'])
    pr = ramp(nt2, [(0, (1, 1, 1, 1)), (0.35, (0.8, 0.8, 0.8, 1)), (1, (0, 0, 0, 1))])
    nt2.links.new(sp.outputs['Y'], pr.inputs[0])
    k2 = nt2.nodes.new('ShaderNodeValue')
    em2 = nt2.nodes.new('ShaderNodeEmission')
    nt2.links.new(math_node(nt2, 'MULTIPLY', pr.outputs[0], k2.outputs[0]).outputs[0], em2.inputs[1])
    nt2.links.new(em2.outputs[0], out2.inputs[0])
    core.data.materials.append(m2)
    for f, sc_, kv in ((1, 0.6, 4.0), (2, 1.3, 4.0), (5, 0.9, 2.5), (12, 0.5, 1.0), (16, 0.2, 0.0)):
        core.scale = (sc_, sc_, 1)
        core.keyframe_insert('scale', frame=f)
        k2.outputs[0].default_value = kv
        k2.outputs[0].keyframe_insert('default_value', frame=f)
    rg = ring_mesh('Ring', 0.9, 1.0, seg=96)
    rg.rotation_euler = (math.pi / 2, 0, 0)
    rg.location.y = -0.6
    rm = emission_mat('ring', (1, 1, 1, 1), 0.0)
    rg.data.materials.append(rm)
    s = rm.node_tree.nodes['Emission'].inputs[1]
    for f, sc_, kv in ((1, 0.2, 2.5), (4, 0.7, 1.6), (8, 0.95, 0.5), (11, 1.05, 0.0)):
        rg.scale = (sc_, sc_, 1)
        rg.keyframe_insert('scale', frame=f)
        s.default_value = kv
        s.keyframe_insert('default_value', frame=f)
    render('super_flash', dict(mode='additive', blending='additive', cols=4, rows=4, fps=30, loop=False,
                               size=260, pivot=[0.5, 0.5], billboard=True, edge=0.03, grade=FLASH,
                               use='super start: starburst on the hero as the super begins (tint with the hero colour)'))

else:
    reset()
    NF = 12
    setup(res=(512, 128), frames=(1, NF), samples=64, fps=24, blur=0.6)
    camera(4.0)
    rnd = random.Random(17)
    D = 6.0                       # wrap span: every line travels exactly D per loop and has a copy at +D
    root = link(bpy.data.objects.new('Lines', None))
    for i in range(30):
        z = rnd.uniform(-0.42, 0.42)
        L = rnd.uniform(0.6, 2.2)
        x0 = rnd.uniform(-3.0, 3.0)
        w = rnd.uniform(0.006, 0.018) * (1.4 - abs(z))
        k = rnd.uniform(0.6, 1.6) * (1.2 - abs(z))
        lm = emission_mat(f'l{i}', (1, 1, 1, 1), k)
        for cp in (0, D):
            pts = [Vector((x0 + cp + L * t / 12, 0, z)) for t in range(13)]
            ws = [w * math.sin(math.pi * t / 12) ** 0.6 * (0.4 + 0.6 * t / 12) for t in range(13)]
            rb = ribbon_mesh(f'ln{i}_{cp}', pts, ws, normal_fn=lambda j, p, tg: Vector((0, 0, 1)))
            rb.data.materials.append(lm)
            rb.parent = root
    root.keyframe_insert('location', frame=1, index=0)
    root.location.x = -D
    root.keyframe_insert('location', frame=NF + 1, index=0)
    linear_fcurves(root)
    render('speed_lines', dict(mode='additive', blending='additive', cols=2, rows=6, fps=24, loop=True,
                               size=300, pivot=[0.5, 0.5], billboard=True, edge=0.08, grade=SPEED,
                               use='dash / run: streak bundle behind the runner (lines move toward -X; flip for facing)'))
