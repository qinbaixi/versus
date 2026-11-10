// Decode a meshopt/quantized/webp glb into a plain glb Blender 4.0 can import.
// Usage: copy next to node_modules with @gltf-transform/*, meshoptimizer, sharp (ESM ignores NODE_PATH), then: node decode_glb.mjs in.glb out.glb
// (packages: @gltf-transform/core@4 extensions@4 functions@4, meshoptimizer, sharp)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
const [, , inp, out] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'].includes(ext.extensionName)) ext.dispose();
}
await doc.transform(dequantize(), textureCompress({ encoder: sharp, targetFormat: 'png' }));
await io.write(out, doc);
console.log('wrote', out);
