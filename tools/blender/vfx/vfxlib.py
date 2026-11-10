"""Shared Blender 4.0 (--background) helpers for the Neon Knuckles flipbook VFX.

Each fx_<name>.py script builds one effect scene from scratch (factory-empty file), simulates it
(Mantaflow gas, legacy particle systems, animated emissive meshes) and renders the frames with
Cycles CPU into  $VFX_WORK/<name>/f_####.png  plus a  meta.json  that tells pack.py how to lay out the
sprite sheet.  Nothing is loaded from disk: every pixel comes from the simulation / procedural shaders,
and every random choice is seeded, so a rebuild reproduces the same sheets.

Conventions
  * world units = Blender metres; the camera is orthographic, `ext` metres across the frame.
  * billboards are rendered from the front (camera on -Y looking +Y, Z up); ground decals are
    rendered from straight above (camera on +Z), image up = world +Y = "away from the viewer".
  * additive effects render emission on an opaque black world (pack.py derives alpha from the
    brightest channel); normal effects render with a transparent film (alpha from the volume /
    surface coverage).  pack.py then writes premultiplied-alpha sheets.

Run everything via  python3 tools/blender/vfx/build_all.py  (see that file).
"""
import bpy, math, os, sys, json, random, faulthandler
faulthandler.enable()
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORK = os.environ.get('VFX_WORK', '/tmp/nk_vfx')
QUICK = os.environ.get('VFX_QUICK') == '1'          # fewer samples for look-dev


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(1234)


def scene():
    return bpy.context.scene


def outdir(name):
    d = os.path.join(WORK, name)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.startswith('f_') and f.endswith('.png'):
            os.remove(os.path.join(d, f))
    return d


def setup(res=(256, 256), frames=(1, 16), samples=48, transparent=False, fps=24, blur=None,
          volume_step=None, bounces=0):
    sc = scene()
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = max(8, samples // (3 if QUICK else 1))
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = bounces + 2
    sc.cycles.diffuse_bounces = bounces
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.volume_bounces = bounces
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.caustics_reflective = sc.cycles.caustics_refractive = False
    sc.cycles.pixel_filter_width = 1.2
    if volume_step:
        sc.cycles.volume_step_rate = volume_step
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = frames
    if os.environ.get('VFX_FRAMES'):                 # look-dev: render a sub-range only
        sc.frame_start, sc.frame_end = (int(x) for x in os.environ['VFX_FRAMES'].split(','))
    sc.render.use_motion_blur = blur is not None
    if blur is not None:
        sc.render.motion_blur_shutter = blur
        sc.cycles.motion_blur_position = 'CENTER'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.image_settings.compression = 15
    sc.display_settings.display_device = 'sRGB'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    w = bpy.data.worlds.new('W')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0, 0, 0, 1)
    bg.inputs[1].default_value = 0
    sc.world = w
    return sc


def camera(ext, center=(0, 0, 0), view='front', aspect=1.0, tilt=0.0):
    """orthographic camera; ext = metres across the wider image axis.
    view 'front': looks +Y (Z up); 'top': looks -Z (image up = +Y); tilt (deg) pitches a front view down."""
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene().collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ext
    cam.data.clip_start, cam.data.clip_end = 0.01, 200
    c = Vector(center)
    if view == 'top':
        cam.location = c + Vector((0, 0, 40))
        cam.rotation_euler = (0, 0, 0)
    else:
        t = math.radians(tilt)
        cam.location = c + Vector((0, -40 * math.cos(t), 40 * math.sin(t)))
        cam.rotation_euler = (math.pi / 2 - t, 0, 0)
    scene().camera = cam
    return cam


def link(ob):
    scene().collection.objects.link(ob)
    return ob


def mesh_obj(name, verts, faces, edges=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, list(edges), faces)
    me.update()
    return link(bpy.data.objects.new(name, me))


def nodes_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out


def ramp(nt, stops, interp='LINEAR'):
    """ColorRamp node from [(pos, (r,g,b,a)), ...]"""
    r = nt.nodes.new('ShaderNodeValToRGB')
    cr = r.color_ramp
    cr.interpolation = interp
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = stops[0][1]
    for p, c in stops[1:]:
        e = cr.elements.new(p)
        e.color = c
    return r


def math_node(nt, op, a=None, b=None, clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n


def hexc(h, a=1.0):
    h = h.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s]
    return (lin[0], lin[1], lin[2], a)


def emission_mat(name, color, strength=1.0, add=True):
    """emission; add=True also passes light through (Transparent BSDF) so a dark/faded card never
    occludes what is behind it -- the render equivalent of additive blending"""
    m, nt, out = nodes_mat(name)
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs[0].default_value = color if len(color) == 4 else (*color, 1)
    e.inputs[1].default_value = strength
    if add:
        a = nt.nodes.new('ShaderNodeAddShader')
        nt.links.new(e.outputs[0], a.inputs[0])
        nt.links.new(nt.nodes.new('ShaderNodeBsdfTransparent').outputs[0], a.inputs[1])
        nt.links.new(a.outputs[0], out.inputs[0])
    else:
        nt.links.new(e.outputs[0], out.inputs[0])
    return m


def glare(kind='FOG_GLOW', threshold=1.0, size=7, mix=0.0, quality='HIGH', streaks=4, angle=0.0, fade=0.9,
          chain=None):
    """compositor glare after the render layer (additive effects: bloom halo / star streaks)"""
    sc = scene()
    sc.use_nodes = True
    nt = sc.node_tree
    rl = nt.nodes.get('Render Layers') or nt.nodes.new('CompositorNodeRLayers')
    comp = nt.nodes.get('Composite') or nt.nodes.new('CompositorNodeComposite')
    src = chain if chain is not None else rl.outputs['Image']
    g = nt.nodes.new('CompositorNodeGlare')
    g.glare_type = kind
    g.quality = quality
    g.threshold = threshold
    g.mix = mix
    if kind == 'FOG_GLOW':
        g.size = size
    if kind == 'STREAKS':
        g.streaks = streaks
        g.angle_offset = math.radians(angle)
        g.fade = fade
    nt.links.new(src, g.inputs[0])
    nt.links.new(g.outputs[0], comp.inputs[0])
    return g.outputs[0]


def key(ob, path, frame, value, interp=None, index=-1):
    setattr_path(ob, path, value)
    ob.keyframe_insert(data_path=path, frame=frame, index=index)
    if interp:
        ad = ob.animation_data if hasattr(ob, 'animation_data') else None
        if ad and ad.action:
            for fc in ad.action.fcurves:
                if fc.data_path == path:
                    for kp in fc.keyframe_points:
                        kp.interpolation = interp


def setattr_path(ob, path, value):
    parts = path.split('.')
    tgt = ob
    for p in parts[:-1]:
        tgt = getattr(tgt, p)
    setattr(tgt, parts[-1], value)


def linear_fcurves(idblock):
    ad = getattr(idblock, 'animation_data', None)
    if ad and ad.action:
        for fc in ad.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.extrapolation = 'LINEAR'


def render(name, meta, variant=None):
    """render the frame range to WORK/name/[vK/]f_####.png and write meta.json for pack.py"""
    d = outdir(name)
    sc = scene()
    fd = d
    if variant is not None:
        fd = os.path.join(d, f'v{variant}')
        os.makedirs(fd, exist_ok=True)
        for f in os.listdir(fd):
            os.remove(os.path.join(fd, f))
    sc.render.filepath = os.path.join(fd, 'f_')
    meta = dict(meta)
    meta.setdefault('name', name)
    meta['src_frames'] = sc.frame_end - sc.frame_start + 1
    meta['frame_w'], meta['frame_h'] = sc.render.resolution_x, sc.render.resolution_y
    with open(os.path.join(d, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    bpy.ops.render.render(animation=True)


def frame_set_all(f):
    scene().frame_set(f)


# ------------------------------------------------------------------ geometry helpers
def ring_mesh(name, r0, r1, seg=96, z=0.0):
    """flat annulus in XY with UV: u = angle 0..1, v = radial 0 (inner) .. 1 (outer)"""
    verts, faces, uvs = [], [], []
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        verts += [(r0 * math.cos(a), r0 * math.sin(a), z), (r1 * math.cos(a), r1 * math.sin(a), z)]
    for i in range(seg):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    ob = mesh_obj(name, verts, faces)
    uv = ob.data.uv_layers.new(name='UV')
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            vi = ob.data.loops[li].vertex_index
            uv.data[li].uv = ((vi // 2) / seg, vi % 2)
    return ob


def ribbon_mesh(name, path, widths, normal_fn=None, closed=False):
    """strip along a polyline path (list of Vector). width per point; side vector from normal_fn(i, p, t)
    (defaults to tangent x Z). UV u along the path 0..1, v across 0..1"""
    n = len(path)
    verts, faces = [], []
    for i, p in enumerate(path):
        t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        side = normal_fn(i, p, t) if normal_fn else t.cross(Vector((0, 0, 1))).normalized()
        w = widths[i] if hasattr(widths, '__len__') else widths
        verts += [tuple(p - side * w * 0.5), tuple(p + side * w * 0.5)]
    for i in range(n - 1):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    ob = mesh_obj(name, verts, faces)
    uv = ob.data.uv_layers.new(name='UV')
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            vi = ob.data.loops[li].vertex_index
            uv.data[li].uv = ((vi // 2) / (n - 1), vi % 2)
    return ob


def uv_input(nt):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    return tc


def sep_xyz(nt, sock):
    s = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(sock, s.inputs[0])
    return s


# ------------------------------------------------------------------ Mantaflow: bake (4.0) / render (bpy 4.5)
# Ubuntu's blender 4.0.2 package can simulate Mantaflow (with manta_inittab_shim.so preloaded) but its
# Cycles segfaults on any OpenVDB volume; the official bpy wheel (4.5 LTS, PyPI) renders volumes fine but
# its Mantaflow bindings are broken.  So gas effects run twice: stage 'sim' in blender 4.0 bakes the
# cache (fluid_data_####.vdb) and writes domain.json; stage 'render' in bpy 4.5 imports the VDB sequence
# as a Volume object and renders it with Cycles.
SIM_STAGE = bpy.app.version < (4, 2, 0)


def cache_dir(name):
    d = os.path.join(WORK, '_cache_' + name)
    os.makedirs(d, exist_ok=True)
    return d


def bake_domain(name, dom, frames):
    """bake every fluid modifier of the current scene into WORK/_cache_name and record the domain
    transform (the VDB grids are in domain-local space)"""
    ds = dom.modifiers['fluid'].domain_settings
    with bpy.context.temp_override(object=dom, active_object=dom, selected_objects=[dom]):
        bpy.ops.fluid.bake_all()
    n = len(os.listdir(os.path.join(ds.cache_directory, 'data')))
    with open(os.path.join(cache_dir(name), 'domain.json'), 'w') as f:
        mn = [min((dom.matrix_world @ v.co)[i] for v in dom.data.vertices) for i in range(3)]
        json.dump({'min': mn, 'frames': list(frames), 'files': n}, f)
    print('BAKED', name, n, 'frames', flush=True)


def make_gas_domain(dom, name, res, frames):
    """add the fluid DOMAIN modifier last (after flows / force fields exist)"""
    md = dom.modifiers.new('fluid', 'FLUID')
    md.fluid_type = 'DOMAIN'
    ds = md.domain_settings
    ds.domain_type = 'GAS'
    ds.resolution_max = res
    ds.cache_directory = cache_dir(name)
    ds.cache_type = 'ALL'
    ds.cache_data_format = 'OPENVDB'
    ds.cache_frame_start, ds.cache_frame_end = frames
    ds.use_adaptive_timesteps = True
    ds.timesteps_max = 3
    ds.use_collision_border_top = False
    dom.hide_render = True
    return ds


def box(name, size, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return ob


def flow(ob, ftype='FIRE', fuel=1.0, temp=1.0, surf=0.6, vel=None, vel_norm=0.0, subframes=1, density=1.0,
         color=(1, 1, 1)):
    md = ob.modifiers.new('fluid', 'FLUID')
    md.fluid_type = 'FLOW'
    fs = md.flow_settings
    fs.flow_type = ftype
    fs.flow_behavior = 'INFLOW'
    fs.flow_source = 'MESH'
    fs.fuel_amount = fuel
    fs.temperature = temp
    fs.density = density
    fs.smoke_color = color
    fs.surface_distance = surf
    fs.subframes = subframes
    if vel is not None or vel_norm:
        fs.use_initial_velocity = True
        if vel is not None:
            fs.velocity_coord = vel
        fs.velocity_normal = vel_norm
    ob.hide_render = True
    return fs


def vdb_volume(name):
    """render stage: the baked cache as a Volume object (sequence), placed with the domain transform"""
    cd = cache_dir(name)
    info = json.load(open(os.path.join(cd, 'domain.json')))
    d = os.path.join(cd, 'data') + os.sep
    fs = sorted(f for f in os.listdir(d) if f.startswith('fluid_data_') and f.endswith('.vdb'))
    bpy.ops.object.volume_import(filepath=d + fs[0], directory=d, files=[{'name': f} for f in fs],
                                 use_sequence_detection=True)
    v = bpy.context.active_object
    v.name = 'Gas'
    v.data.frame_start = int(fs[0][11:15])
    v.data.sequence_mode = 'CLIP'
    # Mantaflow writes the grids in voxel-index space scaled by the cell size, origin at the domain's
    # min corner -> translate the volume there
    v.location = Vector(info['min'])
    return v


def volume_emission_mat(name, grid, strength, power=1.0, density_grid=None, density=0.0):
    """grayscale emission from a grid (fire 'flame' / 'temperature'), optional absorption-free density"""
    m, nt, out = nodes_mat(name)
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = grid
    v = at.outputs['Fac']
    if power != 1.0:
        v = math_node(nt, 'POWER', v, power).outputs[0]
    k = math_node(nt, 'MULTIPLY', v, strength)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs[0].default_value = (1, 1, 1, 1)
    nt.links.new(k.outputs[0], em.inputs[1])
    nt.links.new(em.outputs[0], out.inputs['Volume'])
    return m
