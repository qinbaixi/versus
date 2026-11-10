# 美术资源来源与许可 / Asset Credits

All third-party assets used by the 3D frontend are **CC0 1.0 (public domain)** or MIT.
Licenses were verified from the LICENSE files shipped with the source repositories.

| File(s) | Asset | Author | License | Obtained from |
|---|---|---|---|---|
| `hero_male.glb`, `hero_female.glb` | Universal Base Characters (male / female base meshes, meshopt + webp compressed) | Quaternius (quaternius.com) | CC0 1.0 Universal (`LICENSE_UBC.txt`) | github.com/xDi8blox/bloodrite (`public/assets`) |
| `hero_anims.glb` | Universal Animation Library (UAL1/UAL2), trimmed to 21 clips, scale/leaf tracks removed, rotations quantized | Quaternius | CC0 1.0 Universal (`LICENSE_UAL.txt` / `LICENSE.md`) | github.com/xDi8blox/bloodrite, github.com/Dallolz/moorfall-assets |
| `hair/Hair_*.glb` | Universal Base Characters hair pack (SimpleParted, BuzzedFemale, Buzzed, Beard, Buns) | Quaternius | CC0 1.0 (`LICENSE.md`) | github.com/Dallolz/moorfall-assets |
| `mira.glb` | Mira, derived from the Universal Base Characters female mesh + skeleton; track jacket, track pants, sneakers, fingerless gloves, hair cap and boned ponytail modelled for this project in Blender (`tools/blender/mira_build.py`, source `tools/blender/mira.blend`) | Quaternius (base, CC0); clothing/hair: this project | CC0 1.0 (base); project assets | made here |
| `kai.glb` | Kai, derived from the Universal Base Characters male mesh + skeleton and the SimpleParted hair; open bomber jacket, tee, jeans, belt, sneakers, gloves/wraps, hair tufts and headband with boned tails modelled for this project in Blender (`tools/blender/kai_build.py`, source `tools/blender/kai.blend`) | Quaternius (base + hair, CC0); clothing: this project | CC0 1.0 (base); project assets | made here |
| `robot_expressive.glb` | RobotExpressive | Tomás Laulhé (Quaternius), modifications by Don McCurdy | CC0 1.0 | three.js examples (`examples/models/gltf/RobotExpressive`) |
| `../vendor/three/` | three.js r170 (core, GLTFLoader, SkeletonUtils, BufferGeometryUtils, meshopt decoder) | three.js authors / meshoptimizer (Arseny Kapoulkine) | MIT (`vendor/three/LICENSE`) | npm `three@0.170.0` |

Hero clothing for bruno / zed (vest, coat), the cap, bo staff, robot recolors
and robot add-ons (antenna, shoulder pads, backpack, boss core) are generated in code at runtime
(`js3d/heroes.js`, `js3d/paint.js`, `js3d/chars.js`). The street, signs and effects are procedural
(`js3d/world.js`, `js3d/fx.js`). All sign text is invented.

## VFX flipbooks (`vfx/*.webp`, `vfx/vfx.json`)

All flipbook sprite sheets are original project assets, **generated with Blender (Mantaflow fire/smoke
simulations, particle systems, emissive meshes, Cycles) by the project's own scripts** in
`tools/blender/vfx/` (`python3 tools/blender/vfx/build_all.py`), then gradient-mapped to toon colour bands
and packed into premultiplied-alpha WebP sheets by `tools/blender/vfx/pack.py` (numpy + Pillow).
No external textures, images or third-party art are used; every random choice is seeded.

| Tool | Use | License |
|---|---|---|
| Blender 4.0.2 (Ubuntu package) | Mantaflow baking, Cycles renders of particle / mesh effects | GPL-2.0-or-later (tool only; renders are ours) |
| Blender 4.5 LTS as a Python module (`bpy` wheel, PyPI) | Cycles renders of the baked OpenVDB smoke / fire caches | GPL-2.0-or-later (tool only) |
| numpy, Pillow | sheet packing, toon grading, WebP encoding | BSD / MIT-CMU |
