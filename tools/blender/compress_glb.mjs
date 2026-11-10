// Meshopt-compress an exported hero glb (mira.glb, kai.glb) in place (the game's GLTFLoader has the meshopt decoder).
// Usage: copy next to node_modules with @gltf-transform/* + meshoptimizer (ESM ignores NODE_PATH), then: node compress_glb.mjs priv/www/assets/kai.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
const [, , file] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(file, doc);
console.log('compressed', file);
