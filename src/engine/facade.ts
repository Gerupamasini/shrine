import * as T from "three";
import { addHook } from "./hooks";

/**
 * Building surfaces. One shader extension shared by every architecture material, with a branch per
 * kind of surface. Everything is computed per pixel from what the instanced GLBs already carry, so
 * no texture is added:
 *
 *  - `_occl`: sky occlusion baked per vertex by tools/architecture (dark soffits and wall heads
 *    under deep eaves, inner corners, the foot of a wall). It dims the image-based light only; the
 *    sun is left to the shadow maps.
 *  - object-space position: the model's local y is the height above the ground the building
 *    stands on (rain splash and damp at the foot of walls, mould on north faces).
 *  - the instance's position: a per-building seed, so the same model weathers, fades and is
 *    painted differently from house to house, and its textures are offset.
 *  - roof UVs are authored in metres (along the eave, up the slope): pan tiles and the standing
 *    seams of tin roofs are drawn as relief in the normal, with per-tile tone and lap shadows.
 *  - window "rooms": an interior mapped behind the glass (floor, ceiling, walls, shoji, lace
 *    curtains, a ceiling lamp that lights up at dusk). UV = (room type, floor height).
 *
 * (Unity: port as a shader graph sub-graph with the same inputs: a vertex attribute, the object
 *  position and an instance seed.)
 */
export type FacadeKind =
  | "base"
  | "plaster"
  | "clay"
  | "wood"
  | "siding"
  | "stone"
  | "concrete"
  | "tile"
  | "ridge"
  | "tin"
  | "thatch"
  | "metal"
  | "glass"
  | "room";

const KIND_DEFINE: Record<FacadeKind, string> = {
  base: "FC_BASE",
  plaster: "FC_PLASTER",
  clay: "FC_CLAY",
  wood: "FC_WOOD",
  siding: "FC_SIDING",
  stone: "FC_STONE",
  concrete: "FC_CONCRETE",
  tile: "FC_TILE",
  ridge: "FC_RIDGE",
  tin: "FC_TIN",
  thatch: "FC_THATCH",
  metal: "FC_METAL",
  glass: "FC_GLASS",
  room: "FC_ROOM",
};

const VERT_PARS = /* glsl */ `
attribute float _occl;
varying vec3 vFcObj;
varying vec3 vFcN;
varying vec3 vFcWN;
varying float vFcSeed;
varying float vFcOccl;
varying vec2 vFcUv;
#ifdef FC_ROOM
varying vec3 vFcCam;
#endif
`;

const VERT_UV = /* glsl */ `
{
  #if defined( USE_BATCHING )
    mat4 fcB = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
    vec3 fcI = vec3( fcB[ 3 ].x, fcB[ 3 ].y, fcB[ 3 ].z );
  #elif defined( USE_INSTANCING )
    vec3 fcI = vec3( instanceMatrix[ 3 ].x, instanceMatrix[ 3 ].y, instanceMatrix[ 3 ].z );
  #else
    vec3 fcI = vec3( 0.0 );
  #endif
  vFcSeed = fract( sin( dot( fcI.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vFcUv = uv;
  // the same model at another site starts its textures elsewhere
  vec2 fcOff = vec2( fract( vFcSeed * 7.13 ), fract( vFcSeed * 3.71 ) ) * 3.0;
  #ifdef USE_MAP
    vMapUv += fcOff;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv += fcOff;
  #endif
  #ifdef USE_AOMAP
    vAoMapUv += fcOff;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv += fcOff;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv += fcOff;
  #endif
}
`;

const VERT_POS = /* glsl */ `
vFcObj = transformed;
vFcN = objectNormal;
vFcOccl = _occl;
{
  mat4 fcM = modelMatrix;
  #if defined( USE_BATCHING )
    fcM = modelMatrix * batchingMatrix;
  #elif defined( USE_INSTANCING )
    fcM = modelMatrix * instanceMatrix;
  #endif
  vFcWN = normalize( mat3( fcM ) * objectNormal );
  #ifdef FC_ROOM
    vFcCam = ( inverse( fcM ) * vec4( cameraPosition, 1.0 ) ).xyz;
  #endif
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vFcObj;
varying vec3 vFcN;
varying vec3 vFcWN;
varying float vFcSeed;
varying float vFcOccl;
varying vec2 vFcUv;
#ifdef FC_ROOM
varying vec3 vFcCam;
#endif
float fcHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float fcNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( fcHash( i ), fcHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( fcHash( i + vec2( 0.0, 1.0 ) ), fcHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fcFbm( vec2 p ) {
  return fcNoise( p ) * 0.5 + fcNoise( p * 2.03 + 1.7 ) * 0.25 + fcNoise( p * 4.01 + 3.1 ) * 0.125 + fcNoise( p * 8.07 + 5.3 ) * 0.0625;
}
float fcLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec2 fcGrad = vec2( 0.0 );
float fcRough = 0.0;
`;

/** albedo weathering, after <map_fragment> */
const FRAG_ALBEDO = /* glsl */ `
{
  vec3 fcN = normalize( vFcN );
  float fcVert = 1.0 - abs( fcN.y );
  // along-wall coordinate and height on vertical faces
  vec2 fcW = abs( fcN.z ) > abs( fcN.x ) ? vec2( vFcObj.x, vFcObj.y ) : vec2( vFcObj.z, vFcObj.y );
  float fcExposed = 1.0 - smoothstep( 0.18, 0.62, vFcOccl );
  float fcNorth = smoothstep( 0.2, 0.9, -vFcWN.z );
  float fcS = vFcSeed;
  float fcDirty = 0.55 + 0.9 * fract( fcS * 5.37 );         // how long since the walls were cleaned
  float fcH = vFcObj.y;
  // rain splash and damp at the foot of walls (the local y of a model is its height above ground)
  float fcSplash = ( 1.0 - smoothstep( 0.0, 0.45 + 0.35 * fcNoise( fcW * vec2( 3.1, 1.3 ) + fcS * 11.0 ), fcH ) ) * fcVert;
  vec3 fcSoil = vec3( 0.55, 0.49, 0.42 );
  vec3 fcC = diffuseColor.rgb;

  #if defined( FC_PLASTER ) || defined( FC_CLAY ) || defined( FC_CONCRETE )
    // panels between posts were patched at different times: a small tone step per 0.9 m bay
    float fcBay = fcHash( vec2( floor( fcW.x / 0.91 ), floor( fcW.y / 2.6 ) ) + fcS * 13.0 );
    float fcMacro = fcFbm( fcW * vec2( 0.45, 0.8 ) + fcS * 17.0 );
    #ifdef FC_CLAY
      // clay plaster: earthy and uneven, from ochre to grey-brown
      fcC *= mix( vec3( 1.06, 0.98, 0.86 ), vec3( 0.86, 0.85, 0.82 ), fract( fcS * 3.3 ) );
      fcC *= 0.86 + 0.24 * fcMacro + 0.05 * ( fcBay - 0.5 );
    #else
      // lime plaster and mortar: warm white to light grey, a little chalky unevenness
      fcC *= mix( vec3( 1.0, 0.985, 0.95 ), vec3( 0.9, 0.905, 0.9 ), fract( fcS * 3.3 ) ) * ( 0.93 + 0.08 * fract( fcS * 9.1 ) );
      fcC *= 0.96 + 0.05 * fcMacro + 0.03 * ( fcBay - 0.5 );
    #endif
    // rain streaks run down from ledges on the walls the rain reaches
    float fcStreak = fcNoise( vec2( fcW.x * 9.0 + fcS * 50.0, fcW.y * 0.35 ) ) * fcNoise( vec2( fcW.x * 23.0, fcW.y * 0.8 + fcS * 7.0 ) );
    fcStreak = smoothstep( 0.18, 0.55, fcStreak ) * fcVert * fcExposed * fcDirty;
    fcC = mix( fcC, fcC * vec3( 0.74, 0.73, 0.7 ), fcStreak * 0.32 );
    // green-black mould on the damp, shaded north side, low down
    float fcMould = fcNorth * ( 1.0 - smoothstep( 0.2, 1.6, fcH ) ) * smoothstep( 0.35, 0.75, fcFbm( fcW * 2.2 + fcS * 5.0 ) ) * fcDirty;
    fcC = mix( fcC, fcC * vec3( 0.55, 0.62, 0.5 ), fcMould * 0.6 );
    fcC = mix( fcC, fcC * fcSoil, fcSplash * ( 0.55 + 0.3 * fcDirty ) );
    #ifdef FC_CONCRETE
      // the foundation: rain splash reaches higher on it and leaves a dark band
      fcC *= 0.92 + 0.12 * fcNoise( fcW * 1.7 + fcS * 3.0 );
    #endif
    fcRough += fcSplash * 0.08;
  #endif

  #if defined( FC_WOOD ) || defined( FC_SIDING )
    // cedar silvers where sun and rain reach it, stays brown under the eaves; some houses have
    // their boards stained dark (shibu-zumi, oil stain)
    float fcLum = fcLuma( fcC );
    float fcGrey = fcExposed * ( 0.25 + 0.6 * fract( fcS * 5.1 ) );
    fcC = mix( fcC, vec3( fcLum ) * vec3( 1.05, 1.0, 0.94 ) * 1.18, fcGrey * 0.6 );
    float fcStain = step( 0.62, fract( fcS * 2.71 ) );
    fcC = mix( fcC, fcC * vec3( 0.42, 0.38, 0.36 ), fcStain * 0.75 );
    #ifdef FC_SIDING
      // board to board: each siding board weathered a little differently
      float fcBoard = fcHash( vec2( floor( fcW.y / 0.19 ), floor( fcW.x / 3.6 ) ) + fcS * 7.0 );
      fcC *= 0.88 + 0.22 * fcBoard;
    #endif
    fcC = mix( fcC, fcC * fcSoil * 0.8, fcSplash * 0.7 );
    fcRough += fcGrey * 0.1;
  #endif

  #ifdef FC_STONE
    // moss on the tops of stones and on the damp north side, darker at the ground
    float fcMoss = ( smoothstep( 0.4, 0.9, fcN.y ) * 0.6 + fcNorth * 0.5 + fcSplash * 0.3 ) * smoothstep( 0.42, 0.72, fcFbm( vFcObj.xz * 1.7 + vFcObj.y * 0.8 + fcS * 9.0 ) );
    fcC = mix( fcC, vec3( 0.16, 0.2, 0.09 ) * ( 0.7 + 0.5 * fcLuma( fcC ) ), clamp( fcMoss, 0.0, 0.85 ) );
    fcC = mix( fcC, fcC * fcSoil, fcSplash * 0.5 );
  #endif

  #ifdef FC_METAL
    fcC = mix( fcC, fcC * fcSoil, fcSplash * 0.6 );
  #endif

  #ifdef FC_TILE
    // pan tiles (sangawara): 0.30 m wide waves, rows 0.24 m up the slope. Per-tile tone, the
    // shadowed lap under the row above, relief in the normal. Faded out where a tile is smaller
    // than a few pixels.
    {
      vec2 tu = vFcUv;
      float aa = 1.0 - smoothstep( 0.012, 0.05, max( fwidth( tu.x ), fwidth( tu.y ) ) );
      float tw = 0.30, tr = 0.24;
      vec2 cell = vec2( floor( tu.x / tw ), floor( tu.y / tr ) );
      float sx = fract( tu.x / tw ), sy = fract( tu.y / tr );
      float tone = fcHash( cell + fcS * 31.0 );
      float lap = smoothstep( 0.78, 0.97, sy );
      float trough = 0.5 - 0.5 * sin( 6.2831 * sx );
      // fired colour of the whole roof: silver-grey ibushi, blue-black or brown glazed tiles
      float pick = fract( fcS * 4.7 );
      vec3 roofTint = pick < 0.5 ? vec3( 1.0 ) : pick < 0.8 ? vec3( 0.62, 0.68, 0.8 ) : vec3( 0.86, 0.62, 0.5 );
      fcC *= roofTint;
      fcC *= mix( 1.0, ( 0.9 + 0.2 * tone ) * ( 1.0 - 0.5 * lap ) * ( 1.0 - 0.18 * trough ), aa );
      // grime and lichen gather towards the eaves and on the shaded slopes
      float eave = 1.0 - smoothstep( 0.0, 2.2, tu.y );
      fcC = mix( fcC, fcC * vec3( 0.78, 0.8, 0.7 ), ( eave * 0.5 + fcNorth * 0.35 ) * fcDirty * smoothstep( 0.3, 0.7, fcFbm( tu * 0.9 + fcS * 3.0 ) ) );
      float A = 0.03, tk = 0.026;
      float dhx = A * 6.2831 / tw * cos( 6.2831 * sx );
      float dhy = sy < 0.07 ? tk / ( tr * 0.07 ) : -tk / ( tr * 0.93 );
      fcGrad = vec2( dhx, dhy ) * aa;
    }
  #endif

  #ifdef FC_RIDGE
    // stacked ridge tiles (noshi-gawara): courses 7.5 cm high
    {
      float b = fract( vFcObj.y / 0.075 );
      float aa = 1.0 - smoothstep( 0.01, 0.04, fwidth( vFcObj.y ) );
      fcC *= mix( 1.0, mix( 0.55, 1.0, smoothstep( 0.0, 0.18, b ) ), aa * fcVert );
    }
  #endif

  #ifdef FC_TIN
    // standing-seam tin (kawara-bo buki): battens every 0.455 m down the slope, paint fading on
    // the sunny slopes, rust bleeding from the seams near the eaves
    {
      vec2 tu = vFcUv;
      float aa = 1.0 - smoothstep( 0.015, 0.06, fwidth( tu.x ) );
      float pw = 0.455;
      float sx = fract( tu.x / pw );
      float e = 0.03 / pw, w = 0.045 / pw;
      float dhx = ( sx < e ? 1.0 : sx > w && sx < w + e ? -1.0 : 0.0 ) * 0.035 / ( e * pw );
      fcGrad = vec2( dhx * 0.35, 0.0 ) * aa;
      float seam = sx < w + e ? 1.0 : 0.0;
      fcC *= mix( 1.0, mix( 0.95, 1.12, seam ), aa );
      float fade = clamp( vFcWN.y * 0.6 + 0.4, 0.0, 1.0 ) * ( 0.25 + 0.5 * fract( fcS * 6.1 ) );
      fcC = mix( fcC, vec3( fcLuma( fcC ) ) * vec3( 1.1, 1.05, 1.0 ), fade * 0.55 );
      float rust = smoothstep( 0.45, 0.8, fcNoise( vec2( tu.x * 7.0 + fcS * 20.0, tu.y * 0.6 ) ) ) * ( 1.0 - smoothstep( 0.0, 1.8, tu.y ) ) * fcDirty;
      fcC = mix( fcC, vec3( 0.2, 0.09, 0.04 ), rust * 0.55 );
      fcRough += rust * 0.2;
    }
  #endif

  #ifdef FC_THATCH
    // thatch greys with age; moss on the shaded slopes and along the eaves
    {
      float age = fract( fcS * 3.9 );
      fcC = mix( fcC, vec3( fcLuma( fcC ) ) * vec3( 0.95, 0.95, 0.92 ), 0.3 + 0.5 * age );
      fcC *= 0.85 + 0.25 * fcFbm( vFcUv * vec2( 0.8, 0.4 ) + fcS * 5.0 );
      float moss = ( fcNorth * 0.7 + ( 1.0 - smoothstep( 0.0, 1.5, vFcUv.y ) ) * 0.4 ) * smoothstep( 0.4, 0.75, fcFbm( vFcUv * 0.7 + fcS * 2.0 ) ) * age;
      fcC = mix( fcC, vec3( 0.13, 0.15, 0.07 ), clamp( moss, 0.0, 0.7 ) );
    }
  #endif

  #ifdef FC_ROOM
    fcC = vec3( 1.0 );
  #endif

  diffuseColor.rgb = fcC;
}
`;

/** the interior seen through a window: a box room per 3.6 m cell, traced in the plane's frame */
const FRAG_ROOM = /* glsl */ `
#ifdef FC_ROOM
{
  vec3 N = normalize( vFcN );
  vec3 Tn = normalize( cross( vec3( 0.0, 1.0, 0.0 ), N ) );
  vec3 V = normalize( vFcObj - vFcCam );
  vec3 rd = vec3( dot( V, Tn ), V.y, -dot( V, N ) );
  rd.z = max( rd.z, 1e-3 );
  // u = room type, + 10 where the room's lamp comes on at dusk
  float lit = step( 9.5, vFcUv.x );
  float type = floor( vFcUv.x - lit * 10.0 + 0.5 );
  float doma = step( 1.5, type ) * step( type, 2.5 );
  vec3 ro = vec3( dot( vFcObj, Tn ), vFcObj.y - vFcUv.y, 0.0 );
  float W = 3.64, H = mix( 2.4, 3.2, doma ), D = mix( 3.6, 4.6, doma );
  float cell = floor( ro.x / W );
  float rnd = fcHash( vec2( cell, type ) + vFcSeed * 97.0 );
  float rnd2 = fcHash( vec2( cell + 17.0, type ) + vFcSeed * 61.0 );
  float x0 = cell * W;
  // light coming in through the window (what a white card at the glass would receive) and the
  // ceiling lamp (the material's dusk emissive)
  // (sky light only: the sun's shadow pattern on the glass plane must not be painted into the room)
  vec3 Lin = reflectedLight.indirectDiffuse * 2.2;
  // fluorescent ring lamps (cool daylight white) in most rooms, a few warm bulbs
  vec3 lamp = lit * totalEmissiveRadiance * ( fcHash( vec2( cell, 5.0 ) + vFcSeed * 23.0 ) < 0.6 ? vec3( 0.82, 0.95, 1.18 ) : vec3( 1.1, 0.95, 0.75 ) );
  float tx = rd.x > 0.0 ? ( x0 + W - ro.x ) / rd.x : ( x0 - ro.x ) / min( rd.x, -1e-4 );
  float ty = rd.y > 0.0 ? ( H - ro.y ) / rd.y : -ro.y / min( rd.y, -1e-4 );
  float tz = D / rd.z;
  float t = max( min( min( tx, ty ), tz ), 0.0 );
  vec3 p = ro + rd * t;
  float lx = p.x - x0;
  vec3 alb;
  bool isLamp = false;
  if ( t == tz ) {
    // back wall: sliding paper doors (fusuma) below the lintel, plaster above; in the doma a
    // dark board wall
    float fx = fract( lx / 0.91 );
    float frame = step( fx, 0.025 ) + step( 0.975, fx );
    vec3 fus = mix( vec3( 0.62, 0.56, 0.44 ), vec3( 0.5, 0.52, 0.47 ), rnd2 ) * ( 0.94 + 0.08 * fcNoise( p.xy * 9.0 ) );
    alb = p.y < 1.8 ? mix( fus, vec3( 0.08, 0.06, 0.05 ), clamp( frame, 0.0, 1.0 ) ) : p.y < 1.9 ? vec3( 0.12, 0.08, 0.05 ) : vec3( 0.55, 0.5, 0.42 );
    alb = mix( alb, vec3( 0.07, 0.055, 0.045 ) * ( 0.8 + 0.4 * step( 0.5, fract( lx / 0.24 ) ) ), doma );
  } else if ( t == ty && rd.y < 0.0 ) {
    // floor: tatami with dark borders, the inner veranda's boards, the earthen floor of the doma
    vec2 f = vec2( lx, p.z );
    vec2 m = fract( f / vec2( 0.91, 1.82 ) );
    float heri = step( m.x, 0.03 ) + step( 0.97, m.x ) + step( m.y, 0.015 ) + step( 0.985, m.y );
    vec3 tatami = mix( vec3( 0.48, 0.42, 0.24 ), vec3( 0.42, 0.44, 0.26 ), rnd ) * ( 0.92 + 0.08 * sin( f.y * 600.0 ) );
    alb = mix( tatami, vec3( 0.05, 0.05, 0.05 ), clamp( heri, 0.0, 1.0 ) );
    if ( type < 0.5 && p.z < 0.9 ) alb = vec3( 0.34, 0.21, 0.12 ) * ( 0.85 + 0.25 * fcHash( vec2( floor( p.z / 0.11 ), 3.0 ) ) );
    alb = mix( alb, vec3( 0.11, 0.1, 0.09 ) * ( 0.8 + 0.4 * fcNoise( f * 3.0 ) ), doma );
  } else if ( t == ty ) {
    // ceiling boards, the round fluorescent lamp in the middle of the room
    alb = vec3( 0.36, 0.27, 0.17 ) * ( 0.85 + 0.2 * fcHash( vec2( floor( p.z / 0.45 ), cell ) ) );
    alb = mix( alb, vec3( 0.05, 0.04, 0.03 ), doma );
    vec2 lc = vec2( lx - W * 0.5, p.z - D * 0.5 );
    isLamp = length( lc ) < 0.24 && doma < 0.5;
  } else {
    // side walls: plaster between posts, the lintel at 1.8 m
    float post = step( p.z, 0.06 ) + step( D - 0.06, p.z );
    alb = mix( vec3( 0.58, 0.52, 0.42 ), vec3( 0.1, 0.07, 0.05 ), clamp( post + step( 1.8, p.y ) * step( p.y, 1.9 ), 0.0, 1.0 ) );
    alb = mix( alb, vec3( 0.08, 0.06, 0.05 ), doma );
  }
  vec3 lampPos = vec3( x0 + W * 0.5, H - 0.12, D * 0.5 );
  vec3 dl = lampPos - p;
  float fall = 1.0 / ( 1.0 + dot( dl, dl ) * 0.45 );
  vec3 day = Lin * ( 0.12 + 0.5 * exp( -p.z * 0.8 ) ) * ( t == ty && rd.y > 0.0 ? 0.5 : 1.0 );
  vec3 room = alb * ( day + lamp * ( 1.4 * fall + 0.1 ) );
  if ( isLamp ) room = lamp * 3.5 + Lin * 0.3;
  // inner veranda: a row of shoji 0.9 m in, some slid open
  if ( type < 0.5 ) {
    float ts = 0.9 / rd.z;
    if ( ts < t ) {
      vec3 q = ro + rd * ts;
      float qx = q.x - x0;
      float panel = floor( qx / 0.91 );
      float open = step( 0.55, fcHash( vec2( panel, cell ) + vFcSeed * 13.0 ) );
      if ( q.y > 1.8 ) {
        room = ( q.y < 1.9 ? vec3( 0.1, 0.07, 0.05 ) : vec3( 0.55, 0.5, 0.42 ) ) * ( Lin * 0.45 + lamp * 0.25 );
      } else if ( q.y > 0.0 && open < 0.5 ) {
        vec2 k = fract( vec2( qx / 0.3, q.y / 0.27 ) );
        float kumiko = step( k.x, 0.05 ) + step( k.y, 0.05 );
        vec3 paper = vec3( 0.8, 0.77, 0.7 ) * ( Lin * 0.5 + lamp * 1.1 );
        room = mix( paper, vec3( 0.18, 0.13, 0.08 ) * ( Lin * 0.5 + lamp * 0.3 ), clamp( kumiko, 0.0, 1.0 ) * 0.8 );
      }
    }
  }
  // lace curtains just behind the glass, drawn back by different amounts
  if ( type > 0.5 && doma < 0.5 ) {
    float tc = 0.1 / rd.z;
    vec3 q = ro + rd * tc;
    float u = ( q.x - x0 ) / W;
    float cl = 0.15 + 0.6 * rnd, cr = 0.1 + 0.5 * rnd2;
    float on = step( u, cl ) + step( 1.0 - cr, u );
    float fold = 0.75 + 0.25 * sin( q.x * 46.0 + sin( q.x * 7.0 ) * 2.0 );
    vec3 lace = vec3( 0.86, 0.85, 0.8 ) * fold * ( Lin * 0.55 + lamp * 0.8 );
    room = mix( room, lace, clamp( on, 0.0, 1.0 ) * 0.72 );
  }
  outgoingLight = room;
}
#endif
`;

const FRAG_AO = /* glsl */ `
#include <aomap_fragment>
#ifndef FC_NO_AO
{
  float fcAO = 1.0 - vFcOccl;
  reflectedLight.indirectDiffuse *= fcAO;
  reflectedLight.indirectSpecular *= fcAO * fcAO;
}
#endif
`;

/** glass: reflection over what lies behind, faded by Fresnel (blended ONE, ONE_MINUS_SRC_ALPHA) */
const FRAG_GLASS = /* glsl */ `
#include <opaque_fragment>
#ifdef FC_GLASS
{
  float nv = saturate( dot( normalize( normal ), normalize( vViewPosition ) ) );
  float F = 0.06 + 0.94 * pow( 1.0 - nv, 5.0 );
  float dust = 0.06 + 0.08 * fcNoise( vFcObj.xy * 3.0 + vFcObj.z * 2.0 + vFcSeed * 9.0 );
  fcGlassA = clamp( F + dust, 0.0, 1.0 );
  gl_FragColor = vec4( outgoingLight * ( 1.0 - vFcOccl * 0.6 ), fcGlassA );
}
#endif
`;

const FRAG_GLASS_FOG = /* glsl */ `
#ifdef FC_GLASS
  #ifdef USE_FOG
    gl_FragColor.rgb = applyAtmosphere( gl_FragColor.rgb / max( fcGlassA, 1e-3 ), vFogWorld ) * fcGlassA;
  #endif
#else
  #include <fog_fragment>
#endif
`;

/** look-development switches (tools/house-lab) */
export const facadeDebug = { noBakedAO: false };

export function applyFacade(m: T.MeshStandardMaterial, kind: FacadeKind) {
  // the baked occlusion carries the large-scale darkening; the texture's own AO only adds grain
  if (m.aoMap) m.aoMapIntensity = 0.45;
  const def = KIND_DEFINE[kind];
  const mm = m as T.MeshStandardMaterial & { defines?: Record<string, string> };
  mm.defines = { ...(mm.defines ?? {}), [def]: "", ...(facadeDebug.noBakedAO ? { FC_NO_AO: "" } : {}) };
  if (kind === "glass") {
    m.transparent = true;
    m.depthWrite = false;
    m.blending = T.CustomBlending;
    m.blendSrc = T.OneFactor;
    m.blendDst = T.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = T.ZeroFactor;
    m.blendDstAlpha = T.OneFactor;
  }
  addHook(m, "facade-" + kind, (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n" + VERT_UV)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_POS);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS + (kind === "glass" ? "float fcGlassA = 1.0;\n" : ""))
      // after the albedo (anchored on the next chunk: map_fragment may already be expanded)
      .replace("#include <color_fragment>", FRAG_ALBEDO + "\n#include <color_fragment>")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor + fcRough, 0.04, 1.0 );")
      .replace("#include <normal_fragment_maps>", T.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale;\n\tmapN.xy -= fcGrad;"))
      .replace("#include <aomap_fragment>", FRAG_AO)
      .replace("#include <opaque_fragment>", FRAG_ROOM + (kind === "glass" ? FRAG_GLASS : "#include <opaque_fragment>"))
      .replace("#include <fog_fragment>", kind === "glass" ? FRAG_GLASS_FOG : "#include <fog_fragment>");
  });
  return m;
}
