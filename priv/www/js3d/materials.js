/* ==========================================================================
 * materials.js —— 卡通渲染材质：分段明暗（toon ramp）+ 边缘光 + 屏幕空间等宽描边（反向外壳）
 * ========================================================================== */
import * as THREE from 'three';

/** 全局共享 uniform：描边像素宽度 / 画布分辨率 / 边缘光颜色 */
export const SHARED = {
  outlineWidth: { value: 1.6 },
  resolution: { value: new THREE.Vector2(1920, 1080) },
  rimColor: { value: new THREE.Color(0x8fb8ff) },
  rimStrength: { value: 0.55 },
};

let _ramp = null;
/** 4 段色阶贴图（暗部不至于全黑，便于夜景里看清角色） */
export function toonRamp() {
  if (_ramp) return _ramp;
  const steps = [70, 135, 205, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; });
  _ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter;
  _ramp.generateMipmaps = false;
  _ramp.needsUpdate = true;
  return _ramp;
}

/**
 * 卡通材质：MeshToonMaterial + 菲涅尔边缘光 + 受击闪白（uFlash）
 * @param {object} o  three 材质参数
 * @param {object} [fx] 共享的 {flash:{value}, tint:{value}} uniform，用于整只角色同时闪白/变色
 */
export function toon(o, fx) {
  const m = new THREE.MeshToonMaterial(Object.assign({ gradientMap: toonRamp() }, o));
  const flash = (fx && fx.flash) || { value: 0 };
  const tint = (fx && fx.tint) || { value: new THREE.Color(0, 0, 0) };
  m.userData.fx = { flash, tint };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlash = flash;
    sh.uniforms.uTint = tint;
    sh.uniforms.uRim = SHARED.rimColor;
    sh.uniforms.uRimK = SHARED.rimStrength;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlash; uniform vec3 uTint; uniform vec3 uRim; uniform float uRimK;')
      .replace('#include <opaque_fragment>', `
        {
          vec3 vdir = normalize(vViewPosition);
          float fr = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 3.0);
          outgoingLight += uRim * smoothstep(0.35, 0.75, fr) * uRimK * (0.4 + 0.6 * diffuseColor.rgb);
          outgoingLight += uTint;
          outgoingLight = mix(outgoingLight, vec3(1.0), uFlash);
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'nktoon';
  return m;
}

const OUTLINE_VS = `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
uniform float uWidth;
uniform vec2 uRes;
uniform float uScale;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vec4 clip = projectionMatrix * mvPosition;
  vec3 vn = normalize(normalMatrix * objectNormal);
  vec2 d = (projectionMatrix * vec4(vn, 0.0)).xy;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0);
  clip.xy += d * uWidth * uScale * clip.w * 2.0 / uRes;
  gl_Position = clip;
  #include <fog_vertex>
}`;
const OUTLINE_FS = `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
  #include <fog_fragment>
}`;

/** 屏幕空间描边材质（背面外扩）。scale 为相对宽度倍数 */
export function outline(scale = 1, color = 0x06030c) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uScale: { value: scale },
    }]),
    vertexShader: OUTLINE_VS, fragmentShader: OUTLINE_FS,
    side: THREE.BackSide, fog: true,
  });
}

/** 给网格加描边：克隆一个共享几何/骨骼的外壳网格 */
export function addOutline(mesh, scale = 1, color) {
  const mat = outline(scale, color);
  mat.uniforms.uWidth = SHARED.outlineWidth;
  mat.uniforms.uRes = SHARED.resolution;
  let o;
  if (mesh.isSkinnedMesh) {
    o = new THREE.SkinnedMesh(mesh.geometry, mat);
    o.bind(mesh.skeleton, mesh.bindMatrix);
  } else {
    o = new THREE.Mesh(mesh.geometry, mat);
  }
  o.name = mesh.name + '_outline';
  o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
  o.frustumCulled = false;
  o.castShadow = false;
  o.userData.isOutline = true;
  mesh.parent.add(o);
  return o;
}
