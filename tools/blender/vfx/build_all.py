#!/usr/bin/env python3
"""Build every Neon Knuckles flipbook VFX sheet (system python3 with numpy + Pillow).

    python3 tools/blender/vfx/build_all.py                 # everything
    python3 tools/blender/vfx/build_all.py hit_spark ...   # only these manifest names
    VFX_REUSE_BAKE=1 ...                                   # keep existing Mantaflow caches (look-dev)
    VFX_PACK_ONLY=1 ...                                    # just re-pack already rendered frames

Pipeline per effect:  fx_<group>.py builds the scene from scratch (seeded) ->
  [gas effects] stage 'sim'   : Ubuntu blender 4.0.2 + LD_PRELOAD manta_inittab_shim.so bakes Mantaflow
                                ($VFX_WORK/_cache_<name>/data/fluid_data_####.vdb)
                stage 'render': official bpy 4.5 LTS wheel imports the VDB sequence, Cycles renders
  [other]       blender 4.0.2 Cycles renders particles / emissive meshes directly
  -> $VFX_WORK/<name>/[vK/]f_####.png + meta.json -> pack.py -> priv/www/assets/vfx/<name>.webp + vfx.json
     + contact sheet in $VFX_PREVIEW.

Requirements (all open source):
  apt:  blender (4.0.2), gcc, python3.12-dev (for the shim), python3.11 + venv
  pip:  python3.11 -m venv /tmp/nk_bpy && /tmp/nk_bpy/bin/pip install bpy==4.5.* numpy==1.26.4
        (numpy must be 1.x for the bpy ABI);  point BPY_PYTHON at that interpreter.
Why two Blenders: the distro 4.0.2 build aborts in Mantaflow under Python 3.12 (fixed by the shim) and
segfaults in Cycles on any OpenVDB volume; the PyPI bpy module renders volumes but its Mantaflow
bindings are broken.  Everything rendered is generated here: no external textures or art.
Env: VFX_WORK (default /tmp/nk_vfx), VFX_PREVIEW, BLENDER (default blender), BPY_PYTHON, VFX_JOBS.
"""
import os, sys, subprocess, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.setdefault('VFX_WORK', '/tmp/nk_vfx')
BLENDER = os.environ.get('BLENDER', 'blender')
BPY = os.environ.get('BPY_PYTHON', '/tmp/nk_bpy/bin/python')
SHIM = os.path.join(WORK, 'manta_inittab_shim.so')

# manifest name -> (script, args, uses Mantaflow)
EFFECTS = {
    'hit_spark': ('fx_hit.py', ['spark'], False),
    'hit_heavy': ('fx_hit.py', ['heavy'], False),
    'elec_spark': ('fx_energy.py', ['elec'], False),
    'super_flash': ('fx_energy.py', ['flash'], False),
    'speed_lines': ('fx_energy.py', ['speed'], False),
    'kai_fire_spiral': ('fx_fire.py', ['spiral'], True),
    'kai_fire_burst': ('fx_fire.py', ['burst'], True),
    'mira_wind_ring': ('fx_wind.py', ['ring'], False),
    'mira_wind_slash': ('fx_wind.py', ['slash'], False),
    'bruno_shockwave': ('fx_ground.py', ['shock'], False),
    'bruno_crack': ('fx_ground.py', ['crack'], False),
    'bruno_dust_blast': ('fx_smoke.py', ['dust_blast'], True),
    'dust_puff': ('fx_smoke.py', ['dust_puff'], True),
    'smoke_puff': ('fx_smoke.py', ['smoke_puff'], True),
    'zed_staff_disc': ('fx_staff.py', ['disc'], False),
    'zed_thrust': ('fx_staff.py', ['thrust'], False),
}


def shim():
    if os.path.exists(SHIM):
        return
    os.makedirs(WORK, exist_ok=True)
    inc = subprocess.check_output(['python3.12-config', '--includes'], text=True).split()
    ld = subprocess.check_output(['python3.12-config', '--ldflags', '--embed'], text=True).split()
    subprocess.check_call(['gcc', '-shared', '-fPIC', '-O2', *inc, '-o', SHIM,
                           os.path.join(HERE, 'manta_inittab_shim.c'), '-ldl', *ld])


def run(cmd, env=None, log=None):
    t = time.time()
    r = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    bad = [l for l in r.stdout.splitlines() if 'Traceback' in l or 'Error:' in l or 'Fatal' in l]
    if log:
        with open(log, 'w') as f:
            f.write(r.stdout)
    print(f'  {" ".join(os.path.basename(c) for c in cmd[:3])} {" ".join(cmd[-1:])}: {time.time() - t:.0f}s'
          + (f'  !! {bad[:3]}' if bad else ''), flush=True)


def build(name):
    script, args, gas = EFFECTS[name]
    path = os.path.join(HERE, script)
    log = os.path.join(WORK, f'log_{name}')
    if os.environ.get('VFX_PACK_ONLY') != '1':
        if gas:
            cache = os.path.join(WORK, f'_cache_{name}')
            if not (os.environ.get('VFX_REUSE_BAKE') == '1' and os.path.isdir(cache)):
                env = dict(os.environ, LD_PRELOAD=SHIM)
                run([BLENDER, '--background', '--python', path, '--', *args], env, log + '_sim.txt')
            run([BPY, path, '--', *args], None, log + '_render.txt')
        else:
            run([BLENDER, '--background', '--python', path, '--', *args], None, log + '.txt')
    subprocess.check_call([sys.executable, os.path.join(HERE, 'pack.py'), name])


def main():
    want = [a for a in sys.argv[1:] if a in EFFECTS] or list(EFFECTS)
    shim()
    jobs = int(os.environ.get('VFX_JOBS', '2'))
    with ThreadPoolExecutor(jobs) as ex:
        list(ex.map(build, want))
    tot = sum(os.path.getsize(os.path.join(HERE, '..', '..', '..', 'priv', 'www', 'assets', 'vfx', f'{n}.webp'))
              for n in EFFECTS if os.path.exists(os.path.join(HERE, '..', '..', '..', 'priv', 'www', 'assets', 'vfx', f'{n}.webp')))
    print(f'total sheets: {tot / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
