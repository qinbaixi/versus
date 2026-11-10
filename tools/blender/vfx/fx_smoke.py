"""Mantaflow smoke effects (normal blending, toon-graded):

  bruno_dust_blast  震地拳 ground blast: radial dust surge + rising column + rigid debris chunks (particles)
  dust_puff         small footstep / landing / skid puff (2 variants)
  smoke_puff        enemy death smoke pop (violet, neon-friendly instead of grey)

    LD_PRELOAD=manta_inittab_shim.so blender --background --python fx_smoke.py -- KIND    # stage sim
    $BPY_PYTHON fx_smoke.py -- KIND                                                     # stage render

Render: Principled Volume driven by the baked 'density' grid, single-scatter lit by a warm key sun
(transparent film -> real coverage alpha).  pack.py then gradient-maps the lit luminance through
3 hard-ish toon bands (shadow / mid / highlight colours per effect) and tightens the alpha edge
(alpha_curve), which turns the soft sim into cel-shaded puffs.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vfxlib import *

KIND = (argv() or ['dust_blast'])[0]
NAME = {'dust_blast': 'bruno_dust_blast', 'dust_puff': 'dust_puff', 'smoke_puff': 'smoke_puff'}[KIND]
VARIANTS = 2 if KIND == 'dust_puff' else 1
reset()

CFG = {
    'dust_blast': dict(nfr=40, res=96, box=((5.0, 3.0, 2.6), (0, 0, 1.3))),
    'dust_puff': dict(nfr=22, res=56, box=((1.6, 1.0, 1.0), (0, 0, 0.5))),
    'smoke_puff': dict(nfr=30, res=64, box=((2.2, 2.2, 2.6), (0, 0, 1.1))),
}[KIND]
NFR = CFG['nfr']


def sim(variant):
    name = NAME + (f'_v{variant}' if VARIANTS > 1 else '')
    rnd = random.Random(31 + variant * 17)
    dom = box('Domain', *CFG['box'])
    if KIND == 'dust_blast':
        # radial surge: a flat ring on the ground blowing outward, plus a central updraft puff
        bpy.ops.mesh.primitive_torus_add(major_radius=0.55, minor_radius=0.2, location=(0, 0, 0.16))
        r = bpy.context.active_object
        r.scale = (1, 0.6, 1)
        fs = flow(r, 'SMOKE', surf=1.2, vel_norm=15.0, subframes=3, density=1.8, temp=0.5)
        fs.keyframe_insert('use_inflow', frame=5)
        fs.use_inflow = False
        fs.keyframe_insert('use_inflow', frame=6)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.3, location=(0, 0, 0.25))
        c = bpy.context.active_object
        fs = flow(c, 'SMOKE', surf=0.8, vel=(0, 0, 5.0), subframes=2, density=1.3, temp=1.5)
        fs.keyframe_insert('use_inflow', frame=3)
        fs.use_inflow = False
        fs.keyframe_insert('use_inflow', frame=4)
        tb_s, tb_size = 3.0, 0.45
        alpha, beta = 0.6, 0.6
    elif KIND == 'dust_puff':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.13, location=(0, 0, 0.1))
        c = bpy.context.active_object
        c.scale = (1.6, 0.8, 0.7)
        fs = flow(c, 'SMOKE', surf=0.6, vel_norm=3.5, vel=(rnd.uniform(-0.8, 0.8), 0, 0.6), subframes=2,
                  density=1.4, temp=0.4)
        fs.keyframe_insert('use_inflow', frame=3)
        fs.use_inflow = False
        fs.keyframe_insert('use_inflow', frame=4)
        tb_s, tb_size = 1.5, 0.25
        alpha, beta = 0.2, 0.3
    else:
        # three lumpy fuel-less puffs blown outward/up -> irregular cauliflower pop, not a ball
        for (px, pz, r) in ((0.0, 0.45, 0.2), (-0.16, 0.36, 0.14), (0.15, 0.5, 0.15)):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(px, 0, pz))
            c = bpy.context.active_object
            fs = flow(c, 'SMOKE', surf=0.6, vel_norm=6.5, vel=(px * 6, 0, 1.4), subframes=2, density=1.5, temp=1.2)
            fs.keyframe_insert('use_inflow', frame=2)
            fs.use_inflow = False
            fs.keyframe_insert('use_inflow', frame=3)
        tb_s, tb_size = 5.0, 0.25
        alpha, beta = 0.3, 0.9
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 0.5))
    tb = bpy.context.active_object
    tb.field.strength = tb_s
    tb.field.size = tb_size
    tb.field.seed = 3 + variant * 11
    ds = make_gas_domain(dom, name, CFG['res'], (1, NFR))
    ds.alpha, ds.beta = alpha, beta
    ds.vorticity = 0.4
    ds.use_dissolve_smoke = True
    ds.dissolve_speed = {'dust_blast': 60, 'dust_puff': 16, 'smoke_puff': 24}[KIND]
    ds.use_dissolve_smoke_log = True
    ds.use_collision_border_bottom = True
    bake_domain(name, dom, (1, NFR))


def smoke_mat(density):
    m, nt, out = nodes_mat('smoke')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'density'
    k = math_node(nt, 'MULTIPLY', at.outputs['Fac'], density)
    pv = nt.nodes.new('ShaderNodeVolumePrincipled')
    pv.inputs['Color'].default_value = (1, 1, 1, 1)
    pv.inputs['Anisotropy'].default_value = 0.2
    nt.links.new(k.outputs[0], pv.inputs['Density'])
    nt.links.new(pv.outputs[0], out.inputs['Volume'])
    return m


def debris(seed):
    """rigid chunks thrown out of the crater (legacy particles, Newtonian + gravity, instanced rocks)"""
    bpy.ops.mesh.primitive_circle_add(vertices=24, radius=0.45, fill_type='NGON', location=(0, 0, 0.05))
    em = bpy.context.active_object
    em.show_instancer_for_render = False
    ps = em.modifiers.new('debris', 'PARTICLE_SYSTEM').particle_system
    ps.seed = seed
    s = ps.settings
    s.count = 22
    s.frame_start, s.frame_end = 1, 3
    s.lifetime = 60
    s.normal_factor = 2.6
    s.factor_random = 1.4
    s.object_align_factor = (0, 0, 2.6)
    s.physics_type = 'NEWTON'
    s.render_type = 'COLLECTION'
    s.use_rotations = True
    s.rotation_factor_random = 1.0
    s.use_dynamic_rotation = True
    s.angular_velocity_mode = 'RAND'
    s.angular_velocity_factor = 12
    s.particle_size = 0.085
    s.size_random = 0.7
    col = bpy.data.collections.new('Rocks')
    rnd = random.Random(seed)
    rock_m = bpy.data.materials.new('rock')
    rock_m.use_nodes = True
    bs = rock_m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = hexc('#4a3640')
    bs.inputs['Roughness'].default_value = 1.0
    for i in range(4):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=(0, 0, -30 - i * 3))
        r = bpy.context.active_object
        for v in r.data.vertices:
            v.co *= rnd.uniform(0.6, 1.25)
        r.scale = (1, rnd.uniform(0.5, 0.9), rnd.uniform(0.4, 0.8))
        r.data.materials.append(rock_m)
        for c in r.users_collection:
            c.objects.unlink(r)
        col.objects.link(r)
    s.instance_collection = col
    s.use_collection_pick_random = True
    # bounce off the ground
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    g = bpy.context.active_object
    g.hide_render = True
    g.modifiers.new('col', 'COLLISION')
    g.collision.damping_factor = 0.6
    g.collision.friction_factor = 0.5


GRADES = {
    'dust_blast': {'stops': [[0, '#5a3a5e'], [0.32, '#a8705a'], [0.62, '#e0aa72'], [0.86, '#fbe0b0']], 'soft': 0.03,
                   'alpha_curve': [0.08, 0.32]},
    'dust_puff': {'stops': [[0, '#6a5470'], [0.38, '#b49a8e'], [0.7, '#ece0cc']], 'soft': 0.035,
                  'alpha_curve': [0.08, 0.34]},
    'smoke_puff': {'stops': [[0, '#2c1840'], [0.3, '#6a3490'], [0.6, '#b46ad8'], [0.85, '#f0c8ff']], 'soft': 0.03,
                   'alpha_curve': [0.07, 0.3]},
}

if SIM_STAGE:
    for v in range(VARIANTS):
        reset()
        sim(v)
else:
    for v in range(VARIANTS):
        name = NAME + (f'_v{v}' if VARIANTS > 1 else '')
        reset()
        if KIND == 'dust_blast':
            setup(res=(256, 256), frames=(2, 31), samples=64, transparent=True, fps=24, volume_step=1.0)
            camera(2.7, center=(0, 0, 0.9), tilt=12)
        elif KIND == 'dust_puff':
            setup(res=(128, 128), frames=(2, 17), samples=48, transparent=True, fps=24, volume_step=1.0)
            camera(0.8, center=(0, 0, 0.26), tilt=12)
        else:
            setup(res=(256, 256), frames=(3, 18), samples=64, transparent=True, fps=24, volume_step=1.0)
            camera(1.15, center=(0, 0, 0.62), tilt=12)
        gas = vdb_volume(name)
        gas.data.materials.append(smoke_mat({'dust_blast': 9.0, 'dust_puff': 11.0, 'smoke_puff': 10.0}[KIND]))
        sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
        link(sun)
        sun.data.energy = 9.0
        bg = bpy.context.scene.world.node_tree.nodes['Background']
        bg.inputs[0].default_value = (0.55, 0.5, 0.75, 1)       # cool ambient fill from the night sky
        bg.inputs[1].default_value = 0.9
        sun.data.angle = math.radians(8)
        sun.rotation_euler = (math.radians(40), math.radians(-35), math.radians(-20))
        if KIND == 'dust_blast':
            debris(9)
        g = dict(GRADES[KIND])
        render(NAME, dict(mode='normal', blending='normal', fps=24, loop=False,
                          cols={'dust_blast': 6, 'dust_puff': 8, 'smoke_puff': 4}[KIND],
                          rows={'dust_blast': 5, 'dust_puff': 4, 'smoke_puff': 4}[KIND],
                          size={'dust_blast': 190, 'dust_puff': 45, 'smoke_puff': 85}[KIND],
                          pivot={'dust_blast': [0.5, 0.17], 'dust_puff': [0.5, 0.18], 'smoke_puff': [0.5, 0.4]}[KIND], billboard=True, edge=0.05,
                          grade_normal=g, alpha_curve=g['alpha_curve'],
                          use={'dust_blast': 'bruno super 震地拳: dust/debris eruption at the punch point (with shockwave + crack decals)',
                               'dust_puff': 'footsteps / landing / skid / dash start (small, at the feet)',
                               'smoke_puff': 'enemy death (KO vanish) smoke pop'}[KIND]),
               variant=v if VARIANTS > 1 else None)
os._exit(0)
