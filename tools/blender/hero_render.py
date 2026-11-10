"""Preview renders of tools/blender/<hero>.blend (turntable + animation poses from hero_anims).

  blender --background --python tools/blender/hero_render.py -- HERO OUTDIR [turntable] [poses] [head]
Poses are sampled from hero_anims.glb (decoded to $HERO_WORK/anims_plain.glb) on the hero's own armature,
retargeted like the game does (local rotations by bone name). Env: POSES=label,.. (filter), KICK=0 (skip
the kick / uppercut renders), COLOR_TYPE, ENGINE.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hero_common import *

BASE = {'mira': 'female_plain.glb', 'kai': 'male_plain.glb'}
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
hero = args[0] if args else 'mira'
out = args[1] if len(args) > 1 else f'{WORK}/r_{hero}'
what = set(args[2:]) or {'turntable', 'poses', 'head'}
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend_path(hero))
arm = bpy.data.objects['Armature']
setup_render((700, 1000))
eng = os.environ.get('ENGINE')
if eng: setup_render((700, 1000), eng)

def hide_extra():
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent is not arm: o.hide_render = True

if 'turntable' in what:
    for yaw in (0, 45, 90, 135, 180, 270):
        camera((0, 0.02, 0.9), yaw, ortho=1.95)
        render(f'{out}/turn_{yaw:03d}.png')
if 'head' in what:
    for yaw in (20, 90, 160):
        camera((0, 0.05, 1.58), yaw, ortho=0.5)
        render(f'{out}/head_{yaw:03d}.png')

POSES = [  # (clip, time in seconds, label)
    ('Idle_Loop', 0.0, 'idle'), ('Jog_Fwd_Loop', 0.15, 'run'), ('Punch_Jab', 0.3, 'jab'),
    ('Melee_Hook', 0.22, 'hook'), ('NinjaJump_Start', 0.25, 'crouch'), ('NinjaJump_Idle_Loop', 0.2, 'jumptuck'),
    ('Sword_Attack', 0.62, 'swing'), ('Hit_Knockback', 0.4, 'knock'), ('Death01', 1.2, 'down'),
]
import json, struct
from mathutils import Quaternion
A = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # glTF Y-up -> Blender Z-up

def gltf_rest_nodes(path):
    """base-body node rest transforms (Blender space): local matrices, world matrices, parent names"""
    b = open(path, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
    J = json.loads(b[20:20 + n]); nodes = J['nodes']
    par = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []): par[c] = i
    loc = {}
    for i, nd in enumerate(nodes):
        t = nd.get('translation', [0, 0, 0]); r = nd.get('rotation', [0, 0, 0, 1]); sc_ = nd.get('scale', [1, 1, 1])
        Lg = Matrix.LocRotScale(Vector(t), Quaternion((r[3], r[0], r[1], r[2])), Vector(sc_))
        loc[i] = A @ Lg @ A.inverted()
    world = {}
    def W(i):
        if i not in world: world[i] = (W(par[i]) if i in par else Matrix()) @ loc[i]
        return world[i]
    names = {i: nd.get('name') for i, nd in enumerate(nodes)}
    return ({names[i]: loc[i] for i in loc}, {names[i]: W(i) for i in loc}, {names[i]: (names[par[i]] if i in par else None) for i in loc})

def apply_clip_pose(empties, rest, clip, t):
    """hero_anims.glb has no skin: its bones import as empties with one action per node.
    Like the game's name-based retarget: take each node's LOCAL rotation from the clip (translation only
    for root/pelvis) and keep the hero's own bone offsets; then convert node frames to Blender bone frames."""
    sc = bpy.context.scene
    for n, e in empties.items():
        e.animation_data_create()
        e.animation_data.action = bpy.data.actions.get(f'{clip}_{n}')
    sc.frame_set(int(round(1 + t * sc.render.fps)))
    bpy.context.view_layer.update()
    FL, FW, FP = rest
    aw = arm.matrix_world; aw_inv = aw.inverted()
    Wn = {}
    def walk(b):
        n = b.name
        if n not in FL: return                    # added bones (ponytail, headband tails): keep rest (child of Head)
        e = empties.get(n)
        if e is not None:
            le = (e.parent.matrix_world.inverted() @ e.matrix_world) if e.parent else e.matrix_world
            rot = le.to_quaternion()
            tr = le.to_translation() if n in ('root', 'pelvis') else FL[n].to_translation()
            L = Matrix.LocRotScale(tr, rot, None)
        else:
            L = FL[n]
        pw = Wn[b.parent.name] if b.parent else (FW[FP[n]] if FP.get(n) else Matrix())
        Wn[n] = pw @ L
        C = FW[n].inverted() @ (aw @ b.matrix_local)
        arm.pose.bones[n].matrix = aw_inv @ Wn[n] @ C
        bpy.context.view_layer.update()
        for c in b.children: walk(c)
    for b in arm.data.bones:
        if b.parent is None: walk(b)

if 'poses' in what:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=WORK + '/anims_plain.glb')
    new = set(bpy.data.objects) - before
    bone_names = {b.name for b in arm.data.bones}
    empties = {}
    for o in new:
        o.hide_render = True
        base = o.name.split('.')[0]
        if base in bone_names: empties[base] = o
    for e in empties.values():
        if e.animation_data: e.animation_data.action = None
    bpy.context.view_layer.update()
    rest = gltf_rest_nodes(f'{WORK}/{BASE[hero]}')
    setup_render((700, 1000))
    def aim(name, d, w=1.0):
        pb = arm.pose.bones[name]
        M = arm.matrix_world @ pb.matrix
        cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
        q = cur.rotation_difference(Vector(d).normalized())
        q = Quaternion().slerp(q, w)
        R = q.to_matrix().to_4x4() @ Matrix.Translation(-M.to_translation())
        pb.matrix = arm.matrix_world.inverted() @ Matrix.Translation(M.to_translation()) @ R @ M
        bpy.context.view_layer.update()
    def kick_pose(high):
        apply_clip_pose(empties, rest, 'Idle_Loop', 0.0)
        # same recipe as the game's high/mid kick (js3d/anim.js KICKS): lean back, chamber->extend, guard up
        sp = arm.pose.bones['spine_01']
        M = arm.matrix_world @ sp.matrix
        sp.matrix = arm.matrix_world.inverted() @ Matrix.Translation(M.to_translation()) @ Matrix.Rotation(-0.35 if high else -0.2, 4, 'X') @ Matrix.Translation(-M.to_translation()) @ M
        bpy.context.view_layer.update()
        fwd, up = Vector((0, -1, 0)), Vector((0, 0, 1))
        ext = (fwd * 0.84 + up * 0.55) if high else (fwd * 1.0 + up * 0.12)
        aim('thigh_r', ext); aim('calf_r', ext + up * 0.05); aim('foot_r', fwd * 0.55 + up * 0.85 if high else fwd * 0.9 + up * 0.45)
        aim('thigh_l', Vector((0.05, 0.12, -1))); aim('calf_l', Vector((0.0, 0.3, -1)))
        aim('upperarm_l', Vector((0.3, -0.5, -0.4))); aim('lowerarm_l', Vector((0.0, -0.4, 0.9)))
        aim('upperarm_r', Vector((-0.3, -0.5, -0.4))); aim('lowerarm_r', Vector((0.0, -0.4, 0.9)))
    def turn_bone(n, axis, ang):
        pb = arm.pose.bones[n]; M = arm.matrix_world @ pb.matrix; t_ = M.to_translation()
        pb.matrix = arm.matrix_world.inverted() @ Matrix.Translation(t_) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-t_) @ M
        bpy.context.view_layer.update()
    def uppercut_pose():
        # like js3d/anim.js kai cb3: dipped knees -> rising rear-hand uppercut, body twisted into the punch
        apply_clip_pose(empties, rest, 'Idle_Loop', 0.0)
        turn_bone('pelvis', 'Z', 0.35); turn_bone('spine_01', 'X', 0.2); turn_bone('spine_02', 'Z', 0.25)
        up, fwd = Vector((0, 0, 1)), Vector((0, -1, 0))
        aim('upperarm_r', fwd * 0.75 + up * 0.75 + Vector((0.2, 0, 0))); aim('lowerarm_r', up * 1.0 + fwd * 0.12)
        aim('upperarm_l', Vector((0.35, -0.55, -0.55))); aim('lowerarm_l', Vector((-0.1, -0.5, 0.85)))
        aim('thigh_r', Vector((-0.05, -0.35, -1))); aim('calf_r', Vector((0, 0.1, -1)))
        aim('thigh_l', Vector((0.08, 0.3, -1))); aim('calf_l', Vector((0, 0.45, -1)))
    if os.environ.get('KICK', '1') == '1':
        uppercut_pose()
        for yaw in (90, 30, 270):
            camera((0, -0.1, 0.95), yaw, ortho=2.1)
            render(f'{out}/uppercut_{yaw:03d}.png')
        for high in (True, False):
            kick_pose(high)
            for yaw in (90, 30, 270):
                camera((0, -0.15, 0.95), yaw, ortho=2.1)
                render(f'{out}/kick_{"high" if high else "mid"}_{yaw:03d}.png')
            camera((-0.1, -0.15, 0.95), 60, ortho=0.7)
            render(f'{out}/kick_{"high" if high else "mid"}_hip.png')
    sel = os.environ.get('POSES')
    for clip, t, label in POSES:
        if sel and label not in sel.split(','): continue
        apply_clip_pose(empties, rest, clip, t)
        for yaw in (90, 30):
            camera((0, 0.0, 0.9), yaw, ortho=2.1)
            render(f'{out}/pose_{label}_{yaw:03d}.png')
