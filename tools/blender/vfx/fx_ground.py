"""bruno_shockwave (expanding ground ring, additive decal) / bruno_crack (cracked-ground decal, normal).

    blender --background --python tools/blender/vfx/fx_ground.py -- shock|crack

Both are rendered from straight above (ground-aligned decals: image up = away from the viewer).
shock: an annulus expands with an ease-out curve; its emission is brightest on the leading edge with a
noise-broken trailing wake (4D noise on the angle circle, seamless), plus 48 radial dust rays that
shoot out with it and a faint inner shock disc.  Grayscale -> gold/orange toon bands in pack.py.
crack: seeded branching random-walk cracks (tapered ribbons) radiating from a crater, black core with
a thin molten-orange seam, over a soft scorched crater disc.  Transparent film, 2 variants, 1 frame each.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

KIND = (argv() or ['shock'])[0]
SHOCK_GRADE = {'stops': [[0, '#000000'], [0.06, '#5a1a08'], [0.2, '#c84a10'], [0.4, '#ff9a2a'],
                         [0.65, '#ffd860'], [0.88, '#fff8e0']], 'soft': 0.03}


def circle_noise(nt, u, scale, w=None):
    ang = math_node(nt, 'MULTIPLY', u, 2 * math.pi)
    cmb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(math_node(nt, 'COSINE', ang.outputs[0]).outputs[0], cmb.inputs[0])
    nt.links.new(math_node(nt, 'SINE', ang.outputs[0]).outputs[0], cmb.inputs[1])
    if w is not None:
        nt.links.new(w, cmb.inputs[2])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = 3
    nt.links.new(cmb.outputs[0], nz.inputs['Vector'])
    return nz.outputs['Fac']


def emit_out(nt, out, sock, k_node=None):
    em = nt.nodes.new('ShaderNodeEmission')
    if k_node is not None:
        nt.links.new(math_node(nt, 'MULTIPLY', sock, k_node).outputs[0], em.inputs[1])
    else:
        nt.links.new(sock, em.inputs[1])
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(nt.nodes.new('ShaderNodeBsdfTransparent').outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs[0])


reset()
if KIND == 'shock':
    NF = 16
    setup(res=(256, 256), frames=(1, NF), samples=40, fps=30)
    camera(2.3, view='top')
    # ring
    rg = ring_mesh('Ring', 0.8, 1.0, seg=160)
    m, nt, out = nodes_mat('ring')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = sep_xyz(nt, tc.outputs['UV'])
    prof = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.7, (0.18, 0.18, 0.18, 1)), (0.92, (1, 1, 1, 1)), (1.0, (0, 0, 0, 1))])
    nt.links.new(sp.outputs['Y'], prof.inputs[0])
    nz = circle_noise(nt, sp.outputs['X'], 3.0, sp.outputs['Y'])
    br = ramp(nt, [(0.3, (0.1, 0.1, 0.1, 1)), (0.6, (1, 1, 1, 1))])
    nt.links.new(nz, br.inputs[0])
    a = math_node(nt, 'MULTIPLY', prof.outputs[0], br.outputs[0])
    K = nt.nodes.new('ShaderNodeValue')
    emit_out(nt, out, a.outputs[0], K.outputs[0])
    rg.data.materials.append(m)
    for f, sc_, k in ((1, 0.12, 2.6), (3, 0.55, 2.4), (6, 0.85, 1.7), (10, 0.98, 0.8), (16, 1.04, 0.0)):
        rg.scale = (sc_, sc_, 1)
        rg.keyframe_insert('scale', frame=f)
        K.outputs[0].default_value = k
        K.outputs[0].keyframe_insert('default_value', frame=f)
    # inner disc
    dk = ring_mesh('Disc', 0.0, 1.0, seg=96, z=-0.01)
    m2, nt2, out2 = nodes_mat('disc')
    sp2 = sep_xyz(nt2, nt2.nodes.new('ShaderNodeTexCoord').outputs['UV'])
    pr2 = ramp(nt2, [(0.0, (0.05, 0.05, 0.05, 1)), (0.85, (0.3, 0.3, 0.3, 1)), (1.0, (0, 0, 0, 1))])
    nt2.links.new(sp2.outputs['Y'], pr2.inputs[0])
    K2 = nt2.nodes.new('ShaderNodeValue')
    emit_out(nt2, out2, pr2.outputs[0], K2.outputs[0])
    dk.data.materials.append(m2)
    for f, sc_, k in ((1, 0.1, 0.9), (3, 0.5, 0.45), (6, 0.8, 0.15), (10, 0.95, 0.0)):
        dk.scale = (sc_, sc_, 1)
        dk.keyframe_insert('scale', frame=f)
        K2.outputs[0].default_value = k
        K2.outputs[0].keyframe_insert('default_value', frame=f)
    # radial rays (dust streaks)
    rnd = random.Random(8)
    verts, faces = [], []
    for i in range(48):
        a0 = 2 * math.pi * i / 48 + rnd.uniform(-0.05, 0.05)
        r0, r1 = rnd.uniform(0.55, 0.8), rnd.uniform(0.95, 1.25)
        w = rnd.uniform(0.008, 0.022)
        c, s = math.cos(a0), math.sin(a0)
        n = len(verts)
        verts += [(c * r0 - s * w * 0.3, s * r0 + c * w * 0.3, 0.01), (c * r0 + s * w * 0.3, s * r0 - c * w * 0.3, 0.01),
                  (c * r1 + s * w, s * r1 - c * w, 0.01), (c * r1 - s * w, s * r1 + c * w, 0.01)]
        faces.append((n, n + 1, n + 2, n + 3))
    rays = mesh_obj('Rays', verts, faces)
    rays.data.materials.append(emission_mat('rays', (1, 1, 1, 1), 1.0))
    rv = rays.data.materials[0].node_tree.nodes['Emission'].inputs[1]
    for f, sc_, k in ((1, 0.1, 1.8), (3, 0.6, 1.6), (6, 0.95, 0.8), (9, 1.1, 0.0)):
        rays.scale = (sc_, sc_, 1)
        rays.keyframe_insert('scale', frame=f)
        rv.default_value = k
        rv.keyframe_insert('default_value', frame=f)
    render('bruno_shockwave', dict(mode='additive', blending='additive', cols=4, rows=4, fps=30, loop=False,
                                   size=420, pivot=[0.5, 0.5], billboard=False, edge=0.03, grade=dict(SHOCK_GRADE, floor=0.22),
                                   use='bruno super 震地拳: ground ring on impact (decal, lay flat at the fist)'))
else:
    for var in range(2):
        reset()
        setup(res=(512, 512), frames=(1, 1), samples=48, transparent=True)
        camera(2.2, view='top')
        rnd = random.Random(400 + var * 31)
        black = emission_mat('crack', hexc('#120810'), 1.0, add=False)
        seam = emission_mat('seam', hexc('#ff7a24'), 0.9, add=False)
        # crater: dark disc with noisy soft edge (mix transparent / emission by a radial noise mask)
        cr = ring_mesh('Crater', 0.0, 0.62, seg=96, z=-0.02)
        m, nt, out = nodes_mat('crater')
        sp = sep_xyz(nt, nt.nodes.new('ShaderNodeTexCoord').outputs['UV'])
        nz = circle_noise(nt, sp.outputs['X'], 2.4)
        edge = math_node(nt, 'ADD', sp.outputs['Y'], math_node(nt, 'MULTIPLY', nz, 0.5).outputs[0])
        mask = ramp(nt, [(0.45, (0.92, 0.92, 0.92, 1)), (0.9, (0, 0, 0, 1))])
        nt.links.new(edge.outputs[0], mask.inputs[0])
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(mask.outputs[0], mix.inputs[0])
        nt.links.new(nt.nodes.new('ShaderNodeBsdfTransparent').outputs[0], mix.inputs[1])
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs[0].default_value = hexc('#2a1420')
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs[0])
        cr.data.materials.append(m)

        def crack(p, ang, length, width, depth):
            pts = [p.copy()]
            n = max(3, int(length / 0.07))
            for i in range(n):
                ang += rnd.uniform(-0.28, 0.28)
                p = p + Vector((math.cos(ang), math.sin(ang), 0)) * (length / n)
                pts.append(p.copy())
            ws = [width * (1 - i / len(pts)) ** 0.8 + 0.002 for i in range(len(pts))]
            ob = ribbon_mesh('c', pts, ws)
            ob.data.materials.append(black)
            sw = [w * 0.16 for w in ws]
            s = ribbon_mesh('s', [q + Vector((0, 0, 0.01)) for q in pts], sw)
            s.data.materials.append(seam)
            if depth < 2:
                for k in range(rnd.randint(1, 2)):
                    j = rnd.randint(len(pts) // 4, max(len(pts) // 4 + 1, len(pts) * 2 // 3))
                    crack(pts[j], ang + rnd.choice((-1, 1)) * rnd.uniform(0.5, 1.0),
                          length * rnd.uniform(0.35, 0.55), ws[j] * 0.8, depth + 1)

        n = rnd.randint(6, 8)
        for i in range(n):
            a = 2 * math.pi * (i + rnd.uniform(-0.3, 0.3)) / n
            crack(Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, 0)), a, rnd.uniform(0.55, 0.95),
                  rnd.uniform(0.07, 0.1), 0)
        render('bruno_crack', dict(mode='normal', blending='normal', cols=2, rows=1, fps=1, loop=False, size=300,
                                   pivot=[0.5, 0.5], billboard=False, edge=0.02, hold=True,
                                   use='bruno super 震地拳: static cracked-ground decal at the impact; hold then fade out'),
               variant=var)
