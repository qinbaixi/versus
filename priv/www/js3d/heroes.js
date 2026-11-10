/* ==========================================================================
 * heroes.js —— 四名主角的外观定义：服装涂装规则 + 头发 + 配件
 *   基础人体：Quaternius Universal Base Characters（CC0）
 * ========================================================================== */
import { C } from './paint.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 体型参考（男模，米）：颈 ~1.55，肩 ~1.45，腰 ~1.05，胯 ~0.85，膝 ~0.5，踝 ~0.08
function beltY(B) { return B.pelvis.y + 0.07; }

/** 通用：鞋（鞋底、鞋带区、侧条） */
function shoe(c, main, sole, accent) {
  if (c.y < 0.028) return { c: sole, d: 0.1, id: 31 };
  if (accent && Math.abs(c.n[0]) > 0.75 && c.y < 0.075 && c.y > 0.035) return { c: accent, d: 0.15, id: 32 };
  return { c: main, d: 0.25, id: 30 };
}

export const HERO_DEFS = {
  // ---------------------------------------------------------------- 凯：红夹克 + 白头带
  kai: {
    // 建模版本：assets/kai.glb（tools/blender/kai_build.py）—— 敞开的飞行员夹克 + T 恤 + 牛仔裤 + 头带（两条飘带骨骼链）
    model: 'kai',
    chains: [['headband_l1', 'headband_l2'], ['headband_r1', 'headband_r2']],
    chainOpts: { grav: 700, damp: 0.86, stiff: 0.18, maxAng: 1.1 },
    mats: {
      kai_skin: { skin: true },
      kai_jacket: { color: '#d3262e' }, kai_trim: { color: '#9c1820' }, kai_zipper: { color: '#34363f' },
      kai_tee: { color: '#f2efe8' }, kai_jeans: { color: '#2b3a63' }, kai_seam: { color: '#1f2a4a' },
      kai_belt: { color: '#2a2020' }, kai_buckle: { color: '#cfd4e2' },
      kai_shoes: { color: '#f2f2f6' }, kai_sole: { color: '#c8323a' }, kai_accent: { color: '#d3262e' },
      kai_gloves: { color: '#26222a' }, kai_wrap: { color: '#f0f0f0' },
      kai_hair: { color: '#1a1216', outline: 0.8 }, kai_band: { color: '#f4f4f4', outline: 0.8 },
    },
    // 以下为旧的“涂装”版本参数（建模版本不使用，保留以便对比）
    base: 'male', height: 1.0, hair: 'Hair_SimpleParted', hairColor: '#1a1216', browColor: '#1a1216',
    paint(c) {
      const B = c.B, by = beltY(B);
      const red = C('#d3262e'), redD = C('#9c1820'), white = C('#f2efe8'), jeans = C('#2b3a63'), jeansD = C('#1f2a4a');
      switch (c.g) {
        case 'head': return null;
        case 'neck': return (c.y < B.neck_01.y + 0.02 && c.z < 0.0) ? { c: redD, d: 0.2, id: 2 } : null;   // 后领
        case 'chest': case 'belly': {
          if (c.y < by + 0.02 && c.g === 'belly') return { c: redD, d: 0.2, id: 3 };    // 夹克下摆
          // 前襟敞开：露出白 T 恤
          if (c.z > 0 && Math.abs(c.x) < 0.075 + (B.spine_03.y + 0.12 - c.y) * 0.08) return { c: white, d: 0.45, id: 4 };
          return { c: red, d: 0.4, id: 1 };
        }
        case 'pelvis':
          if (c.y > by - 0.035) return { c: C('#2a2020'), d: 0.2, id: 6 };   // 皮带
          return { c: jeans, d: 0.5, id: 7 };
        case 'uarm': return { c: red, d: 0.4, id: 1 };
        case 'farm':
          if (c.t < 0.38) return { c: red, d: 0.4, id: 1 };
          if (c.t < 0.46) return { c: redD, d: 0.3, id: 3 };                   // 卷起的袖口
          return null;
        case 'hand': return c.t < 0.15 ? { c: C('#f0f0f0'), d: 0.2, id: 9 } : { c: C('#26222a'), d: 0.3, id: 8 };   // 护腕 + 半指手套
        case 'finger': return null;
        case 'thigh': return { c: jeans, d: 0.5, id: 7 };
        case 'calf': return c.t > 0.86 ? { c: jeansD, d: 0.3, id: 10 } : { c: jeans, d: 0.5, id: 7 };
        case 'foot': return shoe(c, white, C('#c8323a'), C('#d3262e'));
      }
      return null;
    },
    acc: {},
  },

  // ---------------------------------------------------------------- 米拉：蓝色运动服 + 高马尾
  mira: {
    // 建模版本：assets/mira.glb（tools/blender/mira_build.py）—— 真实服装几何 + 头发 + 马尾骨骼链
    model: 'mira', chain: ['ponytail_1', 'ponytail_2', 'ponytail_3', 'ponytail_4', 'ponytail_5'],
    mats: {
      mira_skin: { skin: true },
      mira_jacket: { color: '#2662d9' }, mira_trim: { color: '#173f99' }, mira_stripes: { color: '#f4f6ff' },
      mira_zipper: { color: '#cfd4e2' }, mira_pants: { color: '#1f4fb8' },
      mira_shoes: { color: '#f2f2f6' }, mira_sole: { color: '#6ff0ff', emissive: '#1a6a80' }, mira_laces: { color: '#173f99' },
      mira_gloves: { color: '#26222a' }, mira_wrap: { color: '#6ff0ff', emissive: '#2aa8d0' },
      mira_hair: { color: '#5a1830', outline: 0.8 }, mira_tie: { color: '#6ff0ff', emissive: '#3ad8ff', outline: 0.6 },
    },
    // 以下为旧的“涂装”版本参数（建模版本不使用，保留以便对比）
    base: 'female', height: 0.97, hair: 'Hair_BuzzedFemale', hairColor: '#5a1830', browColor: '#3a0f1e',
    paint(c) {
      const B = c.B;
      const blue = C('#2662d9'), blueD = C('#173f99'), white = C('#f4f6ff'), cyan = C('#6ff0ff');
      const stripeArm = c.n[1] > 0.72;                                   // 手臂上缘白条（T 姿势下）
      const stripeLeg = Math.abs(c.n[0]) > 0.8 && c.n[0] * c.x > 0;       // 裤腿外侧白条
      switch (c.g) {
        case 'head': return null;
        case 'neck': return c.y < B.neck_01.y + 0.045 ? { c: white, d: 0.2, id: 2 } : null;   // 立领
        case 'chest': case 'belly':
          if (c.z > 0 && Math.abs(c.x) < 0.007) return { c: C('#d8dce8'), d: 0.1, id: 5 };  // 拉链
          if (c.g === 'belly' && c.y < B.spine_01.y + 0.02) return { c: blueD, d: 0.2, id: 3 }; // 下摆罗纹
          if (c.y > B.spine_03.y + 0.06 && Math.abs(c.x) > 0.1) return { c: white, d: 0.3, id: 4 }; // 肩部拼色
          return { c: blue, d: 0.4, id: 1 };
        case 'pelvis':
          if (c.y > B.pelvis.y + 0.035) return { c: white, d: 0.2, id: 6 };   // 松紧腰
          return { c: blue, d: 0.45, id: 7 };
        case 'uarm': return stripeArm ? { c: white, d: 0.2, id: 4 } : { c: blue, d: 0.4, id: 1 };
        case 'farm':
          if (c.t > 0.86) return { c: blueD, d: 0.2, id: 3 };                 // 袖口
          return stripeArm ? { c: white, d: 0.2, id: 4 } : { c: blue, d: 0.4, id: 1 };
        case 'hand': case 'finger': return c.g === 'hand' && c.t < 0.12 ? { c: cyan, d: 0.1, id: 9 } : null; // 发光腕带
        case 'thigh': return stripeLeg ? { c: white, d: 0.2, id: 4 } : { c: blue, d: 0.45, id: 7 };
        case 'calf':
          if (c.t > 0.88) return { c: blueD, d: 0.2, id: 10 };
          return stripeLeg ? { c: white, d: 0.2, id: 4 } : { c: blue, d: 0.45, id: 7 };
        case 'foot': return shoe(c, white, cyan, C('#2662d9'));
      }
      return null;
    },
    acc: {},
  },

  // ---------------------------------------------------------------- 布鲁诺：黄色工装背心 + 鸭舌帽 + 大胡子
  bruno: {
    base: 'male', height: 1.06, bulk: 0.018, hair: 'Hair_Buzzed', beard: 'Hair_Beard', hairColor: '#2a1a10', browColor: '#2a1a10',
    skinMul: [0.86, 0.72, 0.62],
    paint(c) {
      const B = c.B, by = beltY(B);
      const yel = C('#f2b818'), yelD = C('#b8820e'), refl = C('#d8dde6'), grey = C('#5d5f6c'), brown = C('#6a4a2e'), brownD = C('#4a321e');
      switch (c.g) {
        case 'head': return null;
        case 'neck': return null;
        case 'chest': case 'belly': {
          // 背心下的灰色背心衫（肩部露出）
          const sh = c.y > B.spine_03.y + 0.13 && Math.abs(c.x) > 0.11;
          if (sh) return { c: grey, d: 0.45, id: 2 };
          if (c.g === 'belly' && c.y < by + 0.03) return { c: grey, d: 0.45, id: 2 };
          const band = Math.abs(c.y - (B.spine_02.y + 0.02)) < 0.022;       // 反光条
          if (band) return { c: refl, d: 0.1, id: 5, e: 0.2 };
          if (c.z > 0 && Math.abs(c.x) < 0.012) return { c: C('#3a3a3a'), d: 0.2, id: 6 }; // 拉链
          return { c: yel, d: 0.4, id: 1 };
        }
        case 'pelvis':
          if (c.y > by - 0.03) return { c: C('#1c1a18'), d: 0.15, id: 7 };
          return { c: brown, d: 0.5, id: 8 };
        case 'uarm': case 'farm': return null;                                  // 露出的粗壮手臂
        case 'hand': case 'finger': return c.g === 'hand' && c.t < 0.2 ? { c: C('#e8e2d2'), d: 0.3, id: 9 } : { c: C('#d9d2bd'), d: 0.35, id: 9 }; // 白色缠手布
        case 'thigh': return (Math.abs(c.n[0]) > 0.75 && c.n[0] * c.x > 0 && c.t > 0.35 && c.t < 0.6) ? { c: brownD, d: 0.3, id: 10 } : { c: brown, d: 0.5, id: 8 }; // 工装口袋
        case 'calf': return c.t > 0.55 ? { c: C('#3a2616'), d: 0.35, id: 11 } : { c: brown, d: 0.5, id: 8 };   // 工装靴筒
        case 'foot': return shoe(c, C('#3a2616'), C('#141010'), null);
      }
      return null;
    },
    acc: { cap: '#262a33', capBrim: '#f2b818' },
  },

  // ---------------------------------------------------------------- 泽德：绿色长风衣 + 白发 + 长棍
  zed: {
    base: 'male', height: 1.03, hair: 'Hair_Buns', hairColor: '#e6e6f0', browColor: '#dcdce8',
    skinMul: [0.74, 0.58, 0.48],
    paint(c) {
      const B = c.B, by = beltY(B);
      const grn = C('#2c8a48'), grnD = C('#1b5a2e'), gold = C('#d8c27a'), black = C('#202228');
      switch (c.g) {
        case 'head': return null;
        case 'neck': return c.y < B.neck_01.y + 0.07 ? { c: grnD, d: 0.25, id: 2 } : null;  // 高领
        case 'chest': case 'belly':
          if (Math.abs(c.y - (by + 0.01)) < 0.03) return { c: gold, d: 0.25, id: 3 };       // 腰带
          if (c.z > 0 && Math.abs(c.x) < 0.02 + Math.max(0, c.y - B.spine_03.y) * 0.4) return { c: C('#141418'), d: 0.35, id: 6 }; // 黑色内衬 V 领
          if (c.z > 0 && Math.abs(Math.abs(c.x) - 0.05) < 0.006 && c.y > by) return { c: gold, d: 0.1, id: 7 };  // 盘扣
          return { c: grn, d: 0.4, id: 1 };
        case 'pelvis': return c.y > by - 0.02 ? { c: gold, d: 0.25, id: 3 } : { c: grn, d: 0.4, id: 1 };
        case 'uarm': return { c: grn, d: 0.4, id: 1 };
        case 'farm':
          if (c.t > 0.78) return { c: gold, d: 0.2, id: 4 };   // 金色袖口
          return { c: grn, d: 0.4, id: 1 };
        case 'hand': case 'finger': return { c: C('#2a2a30'), d: 0.35, id: 8 };   // 黑手套
        case 'thigh': return { c: black, d: 0.5, id: 9 };
        case 'calf': return c.t > 0.45 ? { c: C('#121216'), d: 0.35, id: 10 } : { c: black, d: 0.5, id: 9 };
        case 'foot': return shoe(c, C('#121216'), C('#3a3a44'), null);
      }
      return null;
    },
    acc: { coat: '#2c8a48', coatLining: '#141418', staff: '#9a6a36' },
  },
};
