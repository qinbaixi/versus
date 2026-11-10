"""mira_wind_ring (旋风腿 tornado swirl around the legs, seamless loop) / mira_wind_slash (crescent). Additive.

    blender --background --python tools/blender/vfx/fx_wind.py -- ring|slash

ring: six swept wind bands (partial-spiral ribbons on a funnel) spin round the vertical axis at whole
turns per loop, so the cycle closes exactly; each band carries a stretched noise "streak" texture tied
to the object (it loops with the rotation), a bright leading head and a long fading tail.  Cycles
motion blur (multi-step, so the rotation blurs along the arc) smears them into wind.
slash: a tapered crescent sweeps open (shader wipe along the arc) and dissolves; two thin echo arcs.
Rendered as grayscale emission; pack.py maps intensity to cyan toon bands.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

KIND = (argv() or ['ring'])[0]
WIND_GRADE = {'stops': [[0, '#000000'], [0.05, '#063c6a'], [0.15, '#10a6e0'], [0.3, '#3ae6ff'],
                        [0.52, '#9ffaff'], [0.8, '#f4ffff']], 'soft': 0.03}
reset()


def band_material(name, head=0.9, k=3.0, streak_scale=(1.5, 14.0), wipe=None):
    """u along the band (0 tail .. 1 head), v across. emission = profile(v) * along(u) * streak noise.
    wipe: a Value node (0..1.4) revealing the band from u=0 forward with a fading tail (slash)"""
    m, nt, out = nodes_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = sep_xyz(nt, tc.outputs['UV'])
    d = math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', sp.outputs['Y'], 0.5).outputs[0])
    prof = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', d.outputs[0], 2.0).outputs[0], clamp=True)
    prof = math_node(nt, 'POWER', prof.outputs[0], 1.3)
    u = sp.outputs['X']
    if wipe is not None:
        # position relative to the wipe front: s = u - front;  visible for -tail < s < 0
        s = math_node(nt, 'SUBTRACT', u, wipe)
        along = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.45, (0.35, 0.35, 0.35, 1)), (0.78, (1, 1, 1, 1)),
                          (0.8, (1, 1, 1, 1)), (0.87, (0, 0, 0, 1))])
        sh = math_node(nt, 'ADD', s.outputs[0], 0.8)
        nt.links.new(sh.outputs[0], along.inputs[0])
    else:
        along = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.55, (0.3, 0.3, 0.3, 1)), (head, (1, 1, 1, 1)), (1.0, (0, 0, 0, 1))])
        nt.links.new(u, along.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 1.0
    nz.inputs['Detail'].default_value = 4.0
    nz.inputs['Roughness'].default_value = 0.6
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (streak_scale[0], streak_scale[1], 1)
    nt.links.new(tc.outputs['UV'], mp.inputs[0])
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    st = ramp(nt, [(0.42, (0.0, 0.0, 0.0, 1)), (0.68, (1, 1, 1, 1))])
    nt.links.new(nz.outputs['Fac'], st.inputs[0])
    a = math_node(nt, 'MULTIPLY', prof.outputs[0], along.outputs[0])
    b = math_node(nt, 'MULTIPLY', a.outputs[0], st.outputs[0])
    c = math_node(nt, 'MULTIPLY', b.outputs[0], k)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(c.outputs[0], em.inputs[1])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def funnel_band(name, z0, z1, r0, r1, sweep, width, phase, n=90):
    pts, wid = [], []
    for i in range(n):
        t = i / (n - 1)
        a = phase + sweep * t
        z = z0 + (z1 - z0) * t
        r = r0 + (r1 - r0) * t
        pts.append(Vector((r * math.cos(a), r * math.sin(a), z)))
        wid.append(width * (0.35 + 0.65 * math.sin(math.pi * min(1, t * 1.1)) ** 0.5))
    return ribbon_mesh(name, pts, wid, normal_fn=lambda i, p, tg: (Vector((0, 0, 1)) - tg * tg.z).normalized())


if KIND == 'ring':
    NF = 24
    sc = setup(res=(256, 256), frames=(1, NF), samples=48, fps=24, blur=0.8)
    camera(2.3, center=(0, 0, 0.58), tilt=14)
    rnd = random.Random(21)
    bands = [  # z0, z1, r0, r1, sweep, width, turns per loop, brightness
        (0.05, 0.25, 0.62, 0.66, 4.4, 0.12, 2, 2.2),
        (0.22, 0.5, 0.58, 0.7, 4.0, 0.15, 2, 2.0),
        (0.45, 0.78, 0.62, 0.8, 3.8, 0.16, 1, 1.7),
        (0.7, 1.0, 0.72, 0.88, 3.4, 0.14, 1, 1.3),
        (0.12, 0.62, 0.5, 0.56, 3.0, 0.07, 3, 1.8),
        (0.4, 0.95, 0.66, 0.74, 2.6, 0.06, 2, 1.5),
    ]
    for i, (z0, z1, r0, r1, sw, w, turns, k) in enumerate(bands):
        ob = funnel_band(f'band{i}', z0, z1, r0, r1, sw, w, rnd.uniform(0, 6.28))
        ob.data.materials.append(band_material(f'bm{i}', head=0.88, k=k * 1.4,
                                               streak_scale=(rnd.uniform(1.0, 2.0), rnd.uniform(9, 16))))
        ob.cycles.motion_steps = 4
        # counter-clockwise seen from above; whole turns over NF frames -> exact loop
        ob.rotation_euler = (0, 0, 0)
        ob.keyframe_insert('rotation_euler', frame=1, index=2)
        ob.rotation_euler = (0, 0, 2 * math.pi * turns)
        ob.keyframe_insert('rotation_euler', frame=NF + 1, index=2)
        linear_fcurves(ob)
    # ground swirl: a flat ring of dust-wind at the feet
    rg = ring_mesh('ground', 0.35, 0.95, seg=128, z=0.02)
    gm, nt, out = nodes_mat('ground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = sep_xyz(nt, tc.outputs['UV'])
    prof = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.55, (0.6, 0.6, 0.6, 1)), (0.8, (1, 1, 1, 1)), (1.0, (0, 0, 0, 1))])
    nt.links.new(sp.outputs['Y'], prof.inputs[0])
    ang = math_node(nt, 'MULTIPLY', sp.outputs['X'], 2 * math.pi)
    cmb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(math_node(nt, 'COSINE', ang.outputs[0]).outputs[0], cmb.inputs[0])
    nt.links.new(math_node(nt, 'SINE', ang.outputs[0]).outputs[0], cmb.inputs[1])
    nt.links.new(sp.outputs['Y'], cmb.inputs[2])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 2.5
    nz.inputs['Detail'].default_value = 3
    nt.links.new(cmb.outputs[0], nz.inputs['Vector'])
    st = ramp(nt, [(0.45, (0, 0, 0, 1)), (0.65, (1, 1, 1, 1))])
    nt.links.new(nz.outputs['Fac'], st.inputs[0])
    mm = math_node(nt, 'MULTIPLY', prof.outputs[0], st.outputs[0])
    mm2 = math_node(nt, 'MULTIPLY', mm.outputs[0], 1.1)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(mm2.outputs[0], em.inputs[1])
    nt.links.new(em.outputs[0], out.inputs[0])
    rg.data.materials.append(gm)
    rg.cycles.motion_steps = 4
    rg.keyframe_insert('rotation_euler', frame=1, index=2)
    rg.rotation_euler = (0, 0, 2 * math.pi)
    rg.keyframe_insert('rotation_euler', frame=NF + 1, index=2)
    linear_fcurves(rg)
    render('mira_wind_ring', dict(mode='additive', blending='additive', cols=6, rows=4, fps=24, loop=True,
                                  size=170, pivot=[0.5, 0.25], billboard=True, edge=0.04, grade=WIND_GRADE,
                                  use='mira super 旋风腿: loop around her legs/body while spinning (pivot at the feet)'))
else:
    NF = 12
    sc = setup(res=(256, 256), frames=(1, NF), samples=48, fps=30, blur=0.5)
    camera(2.0, center=(0, 0, 0), tilt=0)
    for i, (r, w, sweep, k, delay, z) in enumerate(((0.78, 0.30, 2.9, 3.4, 0, 0.0), (0.62, 0.07, 2.4, 2.2, 1, -0.02),
                                                    (0.9, 0.05, 2.6, 1.8, 0.5, 0.02))):
        # crescent in the picture plane (XZ), tapered both ends, widest at 60% of the sweep
        pts, wid = [], []
        n = 80
        a0 = math.radians(200) - sweep / 2 + math.pi / 2
        for j in range(n):
            t = j / (n - 1)
            a = a0 + sweep * t
            pts.append(Vector((r * math.cos(a), 0, r * math.sin(a) * 0.82)))
            wid.append(w * math.sin(math.pi * t) ** 0.7 * (0.5 + 0.5 * t))
        ob = ribbon_mesh(f'cres{i}', pts, wid, normal_fn=lambda j, p, tg: Vector((0, -1, 0)).cross(tg).normalized())
        ob.location.y = -0.1 * i
        mat2 = band_material(f'slashw{i}', k=k, streak_scale=(2.0, 6.0), wipe=0.0)
        ob.data.materials.append(mat2)
        # find the SUBTRACT node fed by the constant wipe and key its second input
        sub = [n for n in mat2.node_tree.nodes if n.type == 'MATH' and n.operation == 'SUBTRACT'
               and not n.inputs[1].is_linked and n.inputs[0].is_linked
               and n.inputs[0].links[0].from_socket.name == 'X'][0]
        sock = sub.inputs[1]
        for f, v in ((1 + delay, 0.12), (4 + delay, 0.85), (7 + delay, 1.25), (11 + delay, 1.9)):
            sock.default_value = v
            sock.keyframe_insert('default_value', frame=f)
        linear_fcurves(mat2.node_tree)
    render('mira_wind_slash', dict(mode='additive', blending='additive', cols=4, rows=3, fps=30, loop=False,
                                   size=200, pivot=[0.5, 0.5], billboard=True, edge=0.04, grade=WIND_GRADE,
                                   use='mira kicks / super: crescent wind slash along the kick arc (rotate to match)'))
