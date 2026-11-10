"""hit_spark / hit_heavy -- impact bursts (additive).

    blender --background --python tools/blender/vfx/fx_hit.py -- spark|heavy

A legacy particle system fires a burst of emissive "sparks" (Newtonian, drag, a little gravity); Cycles
motion blur stretches each spark into a streak along its velocity (that is the streak shape, no faking).
On top: a keyed star-shaped flash card, an expanding ring (heavy: two rings + a shock disc) and a
compositor glare (fog glow) for the neon halo.  3 variants with different seeds / star angles.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

kind = (argv() or ['spark'])[0]
HEAVY = kind == 'heavy'
NAME = 'hit_heavy' if HEAVY else 'hit_spark'
RES = 256 if HEAVY else 128
NF = 12


def star_mesh(name, n, r_out, r_in, jitter, rnd):
    verts = [(0, 0, 0)]
    for i in range(2 * n):
        a = math.pi * i / n
        r = (r_out * (1 - jitter * rnd.random()) if i % 2 == 0 else r_in)
        verts.append((r * math.cos(a), 0, r * math.sin(a)))
    faces = [(0, 1 + i, 1 + (i + 1) % (2 * n)) for i in range(2 * n)]
    ob = mesh_obj(name, verts, faces)
    # vertex colour = 1 at centre, 0 at tips -> radial gradient in the shader
    ca = ob.data.color_attributes.new('rad', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(ob.data.vertices):
        c = 1.0 if i == 0 else 0.0
        ca.data[i].color = (c, c, c, 1)
    return ob


def star_material(name, hot, mid, strength):
    m, nt, out = nodes_mat(name)
    at = nt.nodes.new('ShaderNodeVertexColor')
    at.layer_name = 'rad'
    r = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.25, mid), (0.75, hot), (1.0, (1, 1, 1, 1))])
    nt.links.new(at.outputs['Color'], r.inputs[0])
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs[1].default_value = strength
    nt.links.new(r.outputs[0], e.inputs[0])
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


def spark_material(name, c0, c1, c2, strength):
    m, nt, out = nodes_mat(name)
    pi = nt.nodes.new('ShaderNodeParticleInfo')
    dv = math_node(nt, 'DIVIDE', pi.outputs['Age'], pi.outputs['Lifetime'])
    r = ramp(nt, [(0.0, (1, 1, 1, 1)), (0.15, c0), (0.55, c1), (1.0, c2)])
    nt.links.new(dv.outputs[0], r.inputs[0])
    st = math_node(nt, 'SUBTRACT', 1.0, dv.outputs[0], clamp=True)
    st2 = math_node(nt, 'MULTIPLY', st.outputs[0], strength)
    e = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(r.outputs[0], e.inputs[0])
    nt.links.new(st2.outputs[0], e.inputs[1])
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


def ring_material(name, color, strength, soft=0.5):
    m, nt, out = nodes_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = sep_xyz(nt, tc.outputs['UV'])
    # v: 0 inner .. 1 outer -> bright at the leading (outer) edge, soft tail inside
    r = ramp(nt, [(0.0, (0, 0, 0, 1)), (soft, color), (0.88, color), (0.94, (1, 0.95, 0.8, 1)), (1.0, (0, 0, 0, 1))])
    nt.links.new(sp.outputs['Y'], r.inputs[0])
    # break the ring into dashes: noise along the angle (u wraps 0..1; 4D noise on a circle keeps it seamless)
    ang = math_node(nt, 'MULTIPLY', sp.outputs['X'], 2 * math.pi)
    cx = math_node(nt, 'COSINE', ang.outputs[0]); sx = math_node(nt, 'SINE', ang.outputs[0])
    cmb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(cx.outputs[0], cmb.inputs[0]); nt.links.new(sx.outputs[0], cmb.inputs[1])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 2.2
    nz.inputs['Detail'].default_value = 1.0
    nt.links.new(cmb.outputs[0], nz.inputs['Vector'])
    br = ramp(nt, [(0.38, (0, 0, 0, 1)), (0.55, (1, 1, 1, 1))])
    nt.links.new(nz.outputs['Fac'], br.inputs[0])
    mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    nt.links.new(r.outputs[0], mix.inputs[1]); nt.links.new(br.outputs[0], mix.inputs[2])
    e = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(mix.outputs[0], e.inputs[0])
    val = nt.nodes.new('ShaderNodeValue')
    val.name = 'K'
    val.outputs[0].default_value = strength
    nt.links.new(val.outputs[0], e.inputs[1])
    nt.links.new(e.outputs[0], out.inputs[0])
    return m, val


def build(variant):
    reset()
    rnd = random.Random(77 + variant * 13 + (100 if HEAVY else 0))
    sc = setup(res=(RES, RES), frames=(1, NF), samples=96, fps=30, blur=1.5)
    ext = 2.2 if HEAVY else 1.4
    camera(ext)
    hot = hexc('#fff2a8'); mid = hexc('#ffb02e'); deep = hexc('#ff4a1a')

    # --- spark particles
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.06 if HEAVY else 0.04)
    em = bpy.context.active_object
    em.name = 'Emitter'
    em.scale = (1, 0.35, 1)                      # keep the burst mostly in the picture plane
    mod = em.modifiers.new('burst', 'PARTICLE_SYSTEM')
    psys = mod.particle_system
    psys.seed = 11 + variant * 7
    s = psys.settings
    s.count = 46 if HEAVY else 22
    s.frame_start, s.frame_end = 1, 1.6
    s.lifetime = 14 if HEAVY else 10
    s.lifetime_random = 0.55
    s.emit_from = 'FACE'
    s.use_emit_random = True
    s.normal_factor = 6.0 if HEAVY else 3.6
    s.factor_random = 2.6 if HEAVY else 1.6
    s.physics_type = 'NEWTON'
    s.drag_factor = 0.85
    s.damping = 0.17
    s.effector_weights.gravity = 0.35
    s.render_type = 'OBJECT'
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1)
    dot = bpy.context.active_object
    dot.name = 'Spark'
    dot.location = (0, 0, -50)
    dot.data.materials.append(spark_material('spark', hot, mid, deep, 22.0))
    s.instance_object = dot
    s.particle_size = 0.022 if HEAVY else 0.02
    s.size_random = 0.6
    s.use_rotations = False
    s.show_unborn = False
    s.use_dead = False
    em.show_instancer_for_render = False

    # --- flash star
    n = rnd.choice((4, 5, 6)) if not HEAVY else rnd.choice((6, 8))
    star = star_mesh('Star', n, 1.0, 0.16 if HEAVY else 0.2, 0.45, rnd)
    star.data.materials.append(star_material('star', hot, mid, 6.0))
    star.rotation_euler = (0, rnd.uniform(0, math.pi), 0)
    star.location = (0, -1, 0)
    star.cycles.use_motion_blur = False
    sz = (0.75 if HEAVY else 0.42)
    for f, k in ((1, 0.55), (2, 1.0), (3, 0.8), (5, 0.35), (7 if HEAVY else 6, 0.0)):
        star.scale = (sz * k, sz * k, sz * k * (1.0 if f > 1 else 0.7))
        star.keyframe_insert('scale', frame=f)
    star.rotation_euler.y += 0.0
    star.keyframe_insert('rotation_euler', frame=1)
    star.rotation_euler.y += 0.25
    star.keyframe_insert('rotation_euler', frame=7)

    # a second, thinner cross flare for punch (heavy: long horizontal-ish streaks)
    if HEAVY:
        fl = star_mesh('Flare', 2, 1.0, 0.035, 0.0, rnd)
        fl.data.materials.append(star_material('flare', hot, deep, 8.0))
        fl.location = (0, -1.2, 0)
        fl.cycles.use_motion_blur = False
        fl.rotation_euler = (0, rnd.uniform(-0.35, 0.35), 0)
        for f, k in ((1, 0.4), (2, 1.0), (4, 0.9), (8, 0.0)):
            fl.scale = (1.05 * k, 1, 1.05 * (0.3 + 0.7 * k))
            fl.keyframe_insert('scale', frame=f)

    # --- shock rings (flat in the picture plane)
    rings = [(0.0, 1.0, 4 if HEAVY else 3)] + ([(1.0, 0.72, 3.5)] if HEAVY else [])
    for i, (delay, rmax, dur) in enumerate(rings):
        rg = ring_mesh(f'Ring{i}', 0.9 if not HEAVY else 0.86, 1.0, seg=96)
        rg.rotation_euler = (math.pi / 2, 0, 0)
        rg.location = (0, -2 - i * 0.1, 0)
        rg.cycles.use_motion_blur = False
        rm, val = ring_material(f'ring{i}', mid if i == 0 else hexc('#ff7a2a'), 5.0, 0.55)
        rg.data.materials.append(rm)
        R = (0.8 if HEAVY else 0.46) * rmax
        f0 = 1 + delay
        steps = [(f0, 0.18, 1.0), (f0 + dur * 0.35, 0.65, 0.9), (f0 + dur, 0.92, 0.35), (f0 + dur * 1.8, 1.0, 0.0)]
        for f, k, b in steps:
            rg.scale = (R * k, R * k, 1)
            rg.keyframe_insert('scale', frame=f)
            val.outputs[0].default_value = 5.0 * b
            val.outputs[0].keyframe_insert('default_value', frame=f)
        # ring thins as it grows: inner radius via shape of UV ramp is fixed; scale Y thickness by mesh scale only
    glare('FOG_GLOW', threshold=0.6, size=7 if HEAVY else 6, mix=-0.25)
    render(NAME, dict(mode='additive', blending='additive', cols=6, rows=6, fps=30, loop=False,
                      size=150 if HEAVY else 70, pivot=[0.5, 0.5], billboard=True, edge=0.05,
                      use='hit_spark: light hits (jab/kick) at the contact point; hit_heavy: finishers, '
                          'knockdowns, super hits'), variant=variant)


for v in range(3):
    build(v)
