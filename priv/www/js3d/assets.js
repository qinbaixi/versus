/* ==========================================================================
 * assets.js —— 加载 glTF 资源（全部本地提供，无 CDN）
 * ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const FILES = {
  male: 'assets/hero_male.glb',
  female: 'assets/hero_female.glb',
  mira: 'assets/mira.glb',
  kai: 'assets/kai.glb',
  anims: 'assets/hero_anims.glb',
  robot: 'assets/robot_expressive.glb',
  Hair_SimpleParted: 'assets/hair/Hair_SimpleParted.glb',
  Hair_BuzzedFemale: 'assets/hair/Hair_BuzzedFemale.glb',
  Hair_Buzzed: 'assets/hair/Hair_Buzzed.glb',
  Hair_Beard: 'assets/hair/Hair_Beard.glb',
  Hair_Buns: 'assets/hair/Hair_Buns.glb',
};

// 需要去除水平位移（root motion）的动作：位移由服务器坐标决定
const FLATTEN = new Set(['Hit_Knockback', 'Death01', 'LayToIdle', 'Roll', 'Shield_Dash_RM', 'Jump_Start', 'Jump_Land', 'Jump_Loop',
  'NinjaJump_Start', 'NinjaJump_Land', 'NinjaJump_Idle_Loop', 'OverhandThrow', 'Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C',
  'Sword_Attack', 'Melee_Hook', 'Punch_Cross', 'Punch_Jab', 'Hit_Chest', 'Hit_Head', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Push_Loop',
  'PickUp_Table', 'Walk_Carry_Loop', 'Sword_Dash_RM', 'Slide_Start', 'Melee_Hook_Rec', 'Sword_Regular_A_Rec', 'Sword_Regular_B_Rec']);

function flattenRootMotion(clip) {
  for (const tr of clip.tracks) {
    if (!/^(pelvis|root)\.position$/.test(tr.name)) continue;
    const v = tr.values;
    // 骨架为 Z 轴向上（Armature 旋转 -90°），pelvis 平移的 x/y 是水平面
    const x0 = v[0], y0 = v[1];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 1] = y0; }
  }
}

export async function loadAll(onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const keys = Object.keys(FILES);
  let done = 0;
  const res = await Promise.all(keys.map((k) => loader.loadAsync(FILES[k]).then((g) => {
    done++; if (onProgress) onProgress(done / keys.length);
    return g;
  })));
  const A = {};
  keys.forEach((k, i) => { A[k] = res[i]; });
  A.clips = {};
  for (const c of A.anims.animations) {
    if (FLATTEN.has(c.name)) flattenRootMotion(c);
    A.clips[c.name] = c;
  }
  A.robotClips = {};
  for (const c of A.robot.animations) A.robotClips[c.name] = c;
  return A;
}
