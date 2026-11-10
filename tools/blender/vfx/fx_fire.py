"""kai_fire_spiral (rising fire vortex column, loop) / kai_fire_burst (fire explosion, one-shot). Additive.

    LD_PRELOAD=manta_inittab_shim.so blender --background --python fx_fire.py -- spiral   # stage sim  (bake)
    $BPY_PYTHON fx_fire.py -- spiral                                                     # stage render
    (same for 'burst'; build_all.py runs both stages)

Mantaflow GAS domain (fire): a ring of FIRE inflow at the base spun by a VORTEX force field (with axial
inflow -> funnel) plus a TURBULENCE field (spiral), or a sphere of fuel + seven fuel blobs blasted
outward for 2 frames (burst).  The baked 'flame' grid is rendered as pure emission (grayscale on black);
the spiral adds three emissive helical flame ribbons wound around the column (mesh + scrolling noise).
pack.py gradient-maps the intensity through stepped toon bands (deep red -> red -> orange -> yellow ->
white core) and loops the spiral with a cross-fade.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

kind = (argv() or ['spiral'])[0]
SPIRAL = kind == 'spiral'
NAME = 'kai_fire_spiral' if SPIRAL else 'kai_fire_burst'
reset()

FIRE_GRADE = {'stops': [[0, '#000000'], [0.05, '#6e0614'], [0.16, '#d01a12'], [0.34, '#ff5a14'],
                        [0.55, '#ff9a22'], [0.75, '#ffd84a'], [0.92, '#fff6d0']], 'soft': 0.025}

NFR = 84 if SPIRAL else 34
FIRE_K = float(os.environ.get('FIRE_K', '1.8' if SPIRAL else '4.0'))
FIRE_P = float(os.environ.get('FIRE_P', '2.0'))
RIB_K = float(os.environ.get('RIB_K', '1.5'))


def sim_spiral():
    dom = box('Domain', (2.0, 2.0, 4.6), (0, 0, 2.2))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.42, minor_radius=0.1, location=(0, 0, 0.12))
    flow(bpy.context.active_object, fuel=1.6, temp=2.0, surf=0.8, vel=(0, 0, 1.6))
    bpy.ops.object.effector_add(type='VORTEX', location=(0, 0, 0))
    vx = bpy.context.active_object
    vx.field.strength = -9.0
    vx.field.inflow = 1.2              # pull toward the axis -> tight funnel
    vx.field.use_max_distance = True
    vx.field.distance_max = 1.4
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 1))
    tb = bpy.context.active_object
    tb.field.strength = 3.0
    tb.field.size = 0.6
    tb.field.seed = 7
    ds = make_gas_domain(dom, NAME, 112, (1, NFR))
    ds.alpha = 0.0
    ds.beta = 2.6                      # strong heat buoyancy -> tall column
    ds.vorticity = 0.25
    ds.burning_rate = 0.62
    ds.flame_smoke = 0.0
    ds.flame_vorticity = 0.9
    ds.flame_max_temp = 3.0
    ds.flame_ignition = 1.2
    bake_domain(NAME, dom, (1, NFR))


def sim_burst():
    dom = box('Domain', (3.6, 3.6, 3.6), (0, 0, 0.3))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.35, location=(0, 0, 0))
    fs = flow(bpy.context.active_object, fuel=3.0, temp=3.0, surf=1.2, vel_norm=7.0, subframes=2)
    fs.use_inflow = True
    fs.keyframe_insert('use_inflow', frame=3)
    fs.use_inflow = False
    fs.keyframe_insert('use_inflow', frame=4)
    rnd = random.Random(5)
    for i in range(7):
        a = rnd.uniform(0, 2 * math.pi); e = rnd.uniform(-0.3, 1.0)
        dv = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e) * 0.5, math.sin(e)))
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.16, location=dv * 0.35)
        f2 = flow(bpy.context.active_object, fuel=2.5, temp=2.5, surf=0.6, vel=tuple(dv * 9.0), subframes=2)
        f2.use_inflow = True
        f2.keyframe_insert('use_inflow', frame=2)
        f2.use_inflow = False
        f2.keyframe_insert('use_inflow', frame=3)
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 0))
    tb = bpy.context.active_object
    tb.field.strength = 4.0
    tb.field.size = 0.5
    ds = make_gas_domain(dom, NAME, 96, (1, NFR))
    ds.alpha = 0.0
    ds.beta = 0.9
    ds.vorticity = 0.35
    ds.burning_rate = 0.45
    ds.flame_smoke = 0.0
    ds.flame_vorticity = 1.2
    ds.flame_ignition = 1.1
    ds.flame_max_temp = 3.0
    bake_domain(NAME, dom, (1, NFR))


def ribbons():
    """three emissive helical flame ribbons wound around the column"""
    m, nt, out = nodes_mat('ribbon')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sp = sep_xyz(nt, tc.outputs['UV'])
    d = math_node(nt, 'SUBTRACT', sp.outputs['Y'], 0.5)
    d2 = math_node(nt, 'ABSOLUTE', d.outputs[0])
    prof = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', d2.outputs[0], 2.0).outputs[0], clamp=True)
    prof2 = math_node(nt, 'POWER', prof.outputs[0], 1.6)
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.noise_dimensions = '2D'
    nz.inputs['Scale'].default_value = 3.0
    nz.inputs['Detail'].default_value = 3.0
    mp = nt.nodes.new('ShaderNodeMapping')
    nt.links.new(tc.outputs['UV'], mp.inputs[0])
    mp.inputs['Scale'].default_value = (4.0, 0.6, 1)
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    rr = ramp(nt, [(0.48, (0, 0, 0, 1)), (0.66, (1, 1, 1, 1))])
    nt.links.new(nz.outputs['Fac'], rr.inputs[0])
    ends = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.12, (1, 1, 1, 1)), (0.7, (0.8, 0.8, 0.8, 1)), (1.0, (0, 0, 0, 1))])
    nt.links.new(sp.outputs['X'], ends.inputs[0])
    a1 = math_node(nt, 'MULTIPLY', prof2.outputs[0], rr.outputs[0])
    a2 = math_node(nt, 'MULTIPLY', a1.outputs[0], ends.outputs[0])
    a3 = math_node(nt, 'MULTIPLY', a2.outputs[0], RIB_K)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(a3.outputs[0], em.inputs[1])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')      # let the fire volume show through the ribbon
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(tr.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs[0])
    linear_fcurves(nt)
    root = link(bpy.data.objects.new('Ribbons', None))
    for k in range(3):
        pts, wid = [], []
        N = 120
        for i in range(N):
            t = i / (N - 1)
            r = 0.38 + 0.42 * t ** 1.3
            a = 2 * math.pi * (k / 3 + t * 1.6)
            pts.append(Vector((r * math.cos(a), r * math.sin(a), 0.1 + t * 3.7)))
            wid.append(0.05 + 0.12 * t)
        rb = ribbon_mesh(f'rib{k}', pts, wid, normal_fn=lambda i, p, t: (Vector((0, 0, 1)) - t * t.z).normalized())
        rb.data.materials.append(m)
        rb.parent = root
    root.keyframe_insert('rotation_euler', frame=1, index=2)
    # 2/3 turn per 32-frame loop: three-fold symmetric ribbons repeat exactly, so the loop cross-fade
    # only blends the fire volume
    root.rotation_euler = (0, 0, -(2 * math.pi / 3) * 2 * (NFR - 1) / 32.0)
    root.keyframe_insert('rotation_euler', frame=NFR, index=2)
    linear_fcurves(root)


if SIM_STAGE:
    (sim_spiral if SPIRAL else sim_burst)()
elif SPIRAL:
    sc = setup(res=(256, 512), frames=(36, NFR), samples=48, fps=24, volume_step=1.0)
    cam = camera(4.4, center=(0, 0, 2.0), tilt=12)
    cam.data.sensor_fit = 'VERTICAL'
    gas = vdb_volume(NAME)
    gas.data.materials.append(volume_emission_mat('fire', 'flame', FIRE_K, power=FIRE_P))
    ribbons()
    render(NAME, dict(mode='additive', blending='additive', cols=8, rows=4, fps=20, loop=True,
                      take=[0, 32], xfade=12, size=150, pivot=[0.5, 0.06], billboard=True, edge=0.03,
                      grade=FIRE_GRADE,
                      use='kai super 升龙旋风: column on kai during the rising spin (loop while airborne)'))
else:
    sc = setup(res=(256, 256), frames=(2, 21), samples=48, fps=24, volume_step=1.0)
    camera(2.3, center=(0, 0, 0.25), tilt=12)
    gas = vdb_volume(NAME)
    gas.data.materials.append(volume_emission_mat('fire', 'flame', FIRE_K, power=FIRE_P))
    render(NAME, dict(mode='additive', blending='additive', cols=5, rows=4, fps=24, loop=False,
                      size=260, pivot=[0.5, 0.5], billboard=True, edge=0.04, grade=FIRE_GRADE,
                      use='kai super finisher: fire explosion at the apex / on the final hit'))
os._exit(0)
