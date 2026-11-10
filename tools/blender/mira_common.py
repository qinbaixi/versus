"""Shared helpers for the mira Blender scripts (Blender 4.0, run with --background).

Inputs are the plain (decoded) glbs written by decode_glb.mjs into $MIRA_WORK
(default: /tmp/mira_work):  female_plain.glb, hair_plain.glb, anims_plain.glb.
Blender 4.0's glTF importer needs numpy; if the system Blender has none, put a
numpy for its Python on PYTHONPATH.
"""
import bpy, os, math
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
WORK = os.environ.get('MIRA_WORK', '/tmp/mira_work')
BLEND = os.path.join(HERE, 'mira.blend')
OUT_GLB = os.path.join(REPO, 'priv', 'www', 'assets', 'mira.glb')

# toon palette (sRGB hex) — slot names are what the game looks up
PALETTE = {
    'mira_skin':    '#c98a62',
    'mira_jacket':  '#2662d9',
    'mira_trim':    '#173f99',
    'mira_stripes': '#f4f6ff',
    'mira_zipper':  '#cfd4e2',
    'mira_pants':   '#1f4fb8',
    'mira_shoes':   '#f2f2f6',
    'mira_sole':    '#6ff0ff',
    'mira_laces':   '#173f99',
    'mira_gloves':  '#26222a',
    'mira_wrap':    '#6ff0ff',
    'mira_hair':    '#5a1830',
    'mira_tie':     '#6ff0ff',
}


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


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# ---------------------------------------------------------------- rendering
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
    for o in objs:
        if o.type != 'MESH':
            continue
        dg = bpy.context.evaluated_depsgraph_get()
        me = o.evaluated_get(dg).to_mesh()
        n += sum(len(p.vertices) - 2 for p in me.polygons)
        o.evaluated_get(dg).to_mesh_clear()
    return n
