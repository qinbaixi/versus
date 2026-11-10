"""Build every Neon Knuckles scene asset.

    blender --background --python tools/blender/scene/build_all.py            # everything
    blender --background --python tools/blender/scene/build_all.py -- props   # one kit (+ atlas)
    NK_NOPREVIEW=1 ...                                                         # skip Cycles previews

Outputs: priv/www/assets/scene/{atlas.png, atlas_e.png, asphalt.png, <kit>.glb}
Previews (Cycles CPU): $NK_PREVIEW (default /mnt/project-files/neon-knuckles-v5/scene)/kit_<kit>.png
"""
import os, sys, importlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas
import nklib

KITS = {
    'props': ('kit_props', dict(per=13, rows=2)),
    'town': ('kit_town', dict(per=5, rows=1)),
    'docks': ('kit_docks', dict(per=6, rows=2)),
    'factory': ('kit_factory', dict(per=6, rows=2)),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    want = [a for a in argv if a in KITS] or list(KITS)
    os.makedirs(nklib.OUT, exist_ok=True)
    sigf = os.path.join(nklib.OUT, 'atlas_layout.txt')
    sig = atlas.signature()
    old = open(sigf).read().strip() if os.path.exists(sigf) else ''
    if old != sig and len(want) < len(KITS):
        print('atlas layout changed -> rebuilding every kit')
        want = list(KITS)
    t = time.time()
    atlas.build(nklib.OUT)
    print('atlas built in %.1fs' % (time.time() - t))
    for k in want:
        modname, popt = KITS[k]
        mod = importlib.import_module(modname)
        nklib.reset()
        parts = mod.build()
        objs = []
        tris = 0
        for p in parts:
            objs.append(p.to_object(**getattr(p, 'props', {})))
            tris += p.tris()
            print('  %-18s %6d tris' % (p.name, p.tris()))
        print('kit', k, len(parts), 'objects', tris, 'tris')
        nklib.export_glb(objs, os.path.join(nklib.OUT, k + '.glb'))
        if not os.environ.get('NK_NOPREVIEW'):
            nklib.preview(objs, os.path.join(nklib.PREVIEW, 'kit_%s.png' % k), **popt)
    with open(sigf, 'w') as f:
        f.write(sig + '\n')


main()
