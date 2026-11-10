"""zed_staff_disc (staff whirl blur disc, seamless loop) / zed_thrust (spear-of-light thrust streak). Additive.

    blender --background --python tools/blender/vfx/fx_staff.py -- disc|thrust

disc: an emissive bo staff with hot tips spins 202.5 deg per frame; Cycles multi-step motion blur
(shutter 1.0, 32 sub-steps) smears it into a disc with brighter tip arcs.  The staff is 180-degree
symmetric and turns 9*pi in 8 frames, so the 8-frame cycle closes exactly.  Two noise-broken guard
rings spin with it.
thrust: a tapered spindle of light shoots out to full length in 3 frames, then thins and fades while
10 speed-line ribbons streak past and an edge-on shock ellipse pops at the tip.
Grayscale emission -> zed green toon bands in pack.py.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

KIND = (argv() or ['disc'])[0]
GREEN = {'stops': [[0, '#000000'], [0.06, '#063a1a'], [0.2, '#14a050'], [0.42, '#4af08a'],
                   [0.7, '#b8ffcc'], [0.9, '#f4fff6']], 'soft': 0.03}
reset()
if KIND == 'disc':
    NF = 8
    setup(res=(256, 256), frames=(1, NF), samples=160, fps=24, blur=1.0)
    camera(2.1)
    root = link(bpy.data.objects.new('Staff', None))
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.035, depth=1.7, rotation=(0, math.pi / 2, 0))
    st = bpy.context.active_object
    st.data.materials.append(emission_mat('staff', (1, 1, 1, 1), 0.4))
    st.parent = root
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, location=(sx * 0.83, 0, 0))
        tip = bpy.context.active_object
        tip.scale = (1.6, 1, 1)
        tip.data.materials.append(emission_mat('tip', (1, 1, 1, 1), 5.0))
        tip.parent = root
    for ob in (root,):
        ob.cycles.motion_steps = 6
    for o in root.children:
        o.cycles.motion_steps = 6
    root.keyframe_insert('rotation_euler', frame=1, index=1)
    root.rotation_euler = (0, -(math.pi + math.pi / 8) * NF, 0)
    root.keyframe_insert('rotation_euler', frame=NF + 1, index=1)
    linear_fcurves(root)
    # guard rings in the picture plane
    for i, (r0, r1, k, turns) in enumerate(((0.88, 0.91, 0.8, 1), (0.5, 0.52, 0.6, -1))):
        rg = ring_mesh(f'ring{i}', r0, r1, seg=128)
        rg.rotation_euler = (math.pi / 2, 0, 0)
        rg.location.y = -0.2
        m, nt, out = nodes_mat(f'ring{i}')
        sp = sep_xyz(nt, nt.nodes.new('ShaderNodeTexCoord').outputs['UV'])
        ang = math_node(nt, 'MULTIPLY', sp.outputs['X'], 2 * math.pi)
        cmb = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(math_node(nt, 'COSINE', ang.outputs[0]).outputs[0], cmb.inputs[0])
        nt.links.new(math_node(nt, 'SINE', ang.outputs[0]).outputs[0], cmb.inputs[1])
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 2.0
        nt.links.new(cmb.outputs[0], nz.inputs['Vector'])
        br = ramp(nt, [(0.4, (0, 0, 0, 1)), (0.6, (1, 1, 1, 1))])
        nt.links.new(nz.outputs['Fac'], br.inputs[0])
        pr = ramp(nt, [(0, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1)), (1, (0, 0, 0, 1))])
        nt.links.new(sp.outputs['Y'], pr.inputs[0])
        a = math_node(nt, 'MULTIPLY', br.outputs[0], pr.outputs[0])
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(math_node(nt, 'MULTIPLY', a.outputs[0], k).outputs[0], em.inputs[1])
        nt.links.new(em.outputs[0], out.inputs[0])
        rg.data.materials.append(m)
        rg.cycles.motion_steps = 4
        rg.keyframe_insert('rotation_euler', frame=1, index=1)
        rg.rotation_euler.y = 2 * math.pi * turns
        rg.keyframe_insert('rotation_euler', frame=NF + 1, index=1)
        linear_fcurves(rg)
    render('zed_staff_disc', dict(mode='additive', blending='additive', cols=4, rows=2, fps=24, loop=True,
                                  size=190, pivot=[0.5, 0.5], billboard=True, edge=0.03, grade=dict(GREEN, floor=0.3), smooth=0.9,
                                  use='zed super 棍影乱舞: whirling staff disc in front of zed (loop; mirror with facing)'))
else:
    NF = 12
    setup(res=(512, 128), frames=(1, NF), samples=48, fps=30, blur=0.6)
    camera(4.0)
    # spindle: tip at +X, tail at the origin side
    verts, faces = [], []
    n, seg = 40, 12
    L = 3.6
    for i in range(n + 1):
        t = i / n
        r = 0.11 * (math.sin(math.pi * min(1.0, t * 1.05)) ** 0.6) * (1 - t) ** 0.35
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append((t * L, r * math.cos(a), r * math.sin(a)))
    for i in range(n):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    sp = mesh_obj('Spear', verts, faces)
    sp.location.x = -1.9
    m, nt, out = nodes_mat('spear')
    gen = nt.nodes.new('ShaderNodeTexCoord')
    sx = sep_xyz(nt, gen.outputs['Generated'])
    rr = ramp(nt, [(0.0, (0.1, 0.1, 0.1, 1)), (0.6, (0.6, 0.6, 0.6, 1)), (0.93, (1, 1, 1, 1)), (1.0, (0.6, 0.6, 0.6, 1))])
    nt.links.new(sx.outputs['X'], rr.inputs[0])
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs[0].default_value = 0.3
    core = math_node(nt, 'SUBTRACT', 1.0, lw.outputs['Facing'])
    k = nt.nodes.new('ShaderNodeValue')
    a = math_node(nt, 'MULTIPLY', rr.outputs[0], math_node(nt, 'ADD', core.outputs[0], 0.25).outputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(math_node(nt, 'MULTIPLY', a.outputs[0], k.outputs[0]).outputs[0], em.inputs[1])
    nt.links.new(em.outputs[0], out.inputs[0])
    sp.data.materials.append(m)
    for f, sxv, szv, kv in ((1, 0.15, 1.3, 2.4), (3, 1.0, 1.2, 2.4), (5, 1.02, 0.9, 1.8), (8, 1.03, 0.45, 1.0),
                            (12, 1.04, 0.1, 0.0)):
        sp.scale = (sxv, 1, szv)
        sp.keyframe_insert('scale', frame=f)
        k.outputs[0].default_value = kv
        k.outputs[0].keyframe_insert('default_value', frame=f)
    # speed lines
    rnd = random.Random(12)
    for i in range(10):
        z = rnd.uniform(-0.32, 0.32)
        ln = rnd.uniform(1.0, 2.4)
        x0 = rnd.uniform(-1.9, 0.4)
        rb = ribbon_mesh(f'line{i}', [Vector((x0 + ln * t / 10, -0.3, z)) for t in range(11)],
                         [0.012 + 0.01 * math.sin(math.pi * t / 10) for t in range(11)],
                         normal_fn=lambda j, p, tg: Vector((0, 0, 1)))
        lm = emission_mat(f'lm{i}', (1, 1, 1, 1), 0.0)
        rb.data.materials.append(lm)
        s = lm.node_tree.nodes['Emission'].inputs[1]
        f0 = 1 + rnd.randint(0, 3)
        rb.location.x = -0.6
        rb.keyframe_insert('location', frame=f0, index=0)
        rb.location.x = 0.9
        rb.keyframe_insert('location', frame=f0 + 6, index=0)
        for f, v in ((f0, 0.0), (f0 + 1, rnd.uniform(1.0, 1.8)), (f0 + 6, 0.0)):
            s.default_value = v
            s.keyframe_insert('default_value', frame=f)
    # shock ellipse at the tip (edge-on ring)
    rg = ring_mesh('Shock', 0.85, 1.0, seg=64)
    rg.rotation_euler = (0, math.pi / 2, 0)
    rg.location = (1.55, 0, 0)
    rm = emission_mat('shock', (1, 1, 1, 1), 0.0)
    rg.data.materials.append(rm)
    s = rm.node_tree.nodes['Emission'].inputs[1]
    for f, sc_, v in ((2, 0.05, 0.0), (3, 0.12, 2.5), (5, 0.3, 1.5), (8, 0.42, 0.0)):
        rg.scale = (sc_, sc_ * 1.0, 1)
        rg.keyframe_insert('scale', frame=f)
        s.default_value = v
        s.keyframe_insert('default_value', frame=f)
    rg.cycles.use_motion_blur = False
    render('zed_thrust', dict(mode='additive', blending='additive', cols=2, rows=6, fps=30, loop=False,
                              size=360, pivot=[0.03, 0.5], billboard=True, edge=0.03, grade=GREEN,
                              use='zed super finisher / staff thrust: spear-of-light streak from the staff tip '
                                  '(pivot at its left end; flip X for facing left)'))
