import * as T from "three";

/**
 * Aerial perspective shared by every material: exponential height fog with
 * analytic integration along the view ray, extinction + in-scattering where the
 * in-scattered colour is warmer towards the sun (Henyey-Greenstein lobe).
 *
 * Three's fog chunks are replaced once, globally. Materials that should be
 * affected must receive the shared uniforms via `Atmosphere.patch(material)`.
 * (Unity: reimplement as a height fog / volumetric fog override.)
 */
export const atmosphereUniforms = {
  uFogDensity: { value: 0.0016 },
  uFogHeightFalloff: { value: 0.012 },
  uFogBaseY: { value: 0.0 },
  uFogAmbient: { value: new T.Color(0.55, 0.62, 0.72) },
  uFogSun: { value: new T.Color(1.0, 0.72, 0.45) },
  uSunDir: { value: new T.Vector3(0, 0.1, -1) },
  uFogMaxOpacity: { value: 0.88 },
  /** ground-hugging humid haze over the valley floor (scale height ~17 m) */
  uGroundDensity: { value: 0.0011 },
  uGroundFalloff: { value: 0.06 },
  uGroundBase: { value: 4.0 },
  uTime: { value: 0 },
};

let installed = false;
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  // Foliage: wrapped diffuse + light transmitted through thin leaves (back/forward scatter).
  // Only materials that define FOLIAGE are affected. (Unity: SpeedTree/HDRP translucency.)
  T.ShaderChunk.lights_physical_pars_fragment = T.ShaderChunk.lights_physical_pars_fragment
    .replace(
      "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;",
      `#ifdef FOLIAGE
\tfloat dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.45 ) / 1.45 );
#else
\tfloat dotNL = saturate( dot( geometryNormal, directLight.direction ) );
#endif
\tvec3 irradiance = dotNL * directLight.color;`,
    )
    .replace(
      "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );",
      `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
#ifdef FOLIAGE
\t{
\t\tfloat back = saturate( dot( -geometryNormal, directLight.direction ) );
\t\tfloat fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 4.0 );
\t\treflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3( 0.72, 1.0, 0.42 ) * ( back * 0.25 + fwd * 1.1 ) * RECIPROCAL_PI;
\t}
#endif`,
    );
  if (!T.ShaderChunk.lights_physical_pars_fragment.includes("FOLIAGE")) console.warn("foliage lighting patch failed");
  // Tree foliage cards carry crown-shaped normals (pointing out of the crown volume), not the
  // normal of the card. Flipping them on back faces, as three.js does for double-sided
  // materials, turned half the cards of every crown inside-out: the sunlit side of a tree came
  // out patchy and the shaded side caught light. Materials with CROWN_NORMALS keep the normal.
  T.ShaderChunk.normal_fragment_begin = T.ShaderChunk.normal_fragment_begin.replace(
    "normal *= faceDirection;",
    "#ifndef CROWN_NORMALS\n\t\tnormal *= faceDirection;\n\t#endif",
  );
  if (!T.ShaderChunk.normal_fragment_begin.includes("CROWN_NORMALS")) console.warn("crown normal patch failed");
  T.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
  T.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  {
    vec4 fogWP = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      fogWP = batchingMatrix * fogWP;
    #endif
    #ifdef USE_INSTANCING
      fogWP = instanceMatrix * fogWP;
    #endif
    vFogWorld = ( modelMatrix * fogWP ).xyz;
  }
#endif`;
  T.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
  uniform float uFogDensity;
  uniform float uFogHeightFalloff;
  uniform float uFogBaseY;
  uniform vec3 uFogAmbient;
  uniform vec3 uFogSun;
  uniform vec3 uSunDir;
  uniform float uFogMaxOpacity;
  uniform float uGroundDensity, uGroundFalloff, uGroundBase;
  vec3 applyAtmosphere( vec3 col, vec3 worldPos ) {
    vec3 ray = worldPos - cameraPosition;
    float dist = length( ray );
    vec3 dir = ray / max( dist, 1e-4 );
    float k = uFogHeightFalloff;
    float h0 = cameraPosition.y - uFogBaseY;
    float dy = ray.y;
    float kd = k * dy;
    float integ = abs( kd ) > 1e-4 ? ( 1.0 - exp( -kd ) ) / kd : 1.0 - 0.5 * kd;
    float tau = uFogDensity * exp( -k * h0 ) * dist * integ;
    {
      // second, low layer: same analytic integral with a short scale height
      float k2 = uGroundFalloff;
      float kd2 = k2 * dy;
      float integ2 = abs( kd2 ) > 1e-4 ? ( 1.0 - exp( -kd2 ) ) / kd2 : 1.0 - 0.5 * kd2;
      tau += uGroundDensity * exp( -k2 * max( cameraPosition.y - uGroundBase, -10.0 ) ) * dist * integ2;
    }
    float ext = exp( -tau );
    float mu = dot( dir, uSunDir );
    float g = 0.72;
    float hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * mu, 1.5 ) * 0.0796;
    float sunAmt = clamp( hg * 1.4, 0.0, 1.0 ) * smoothstep( -0.08, 0.05, uSunDir.y );
    vec3 inscatter = uFogAmbient + uFogSun * sunAmt;
    float a = min( 1.0 - ext, uFogMaxOpacity );
    return mix( col, inscatter, a );
  }
#endif`;
  T.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere( gl_FragColor.rgb, vFogWorld );
#endif`;
}

/** Add the shared atmosphere uniforms to a built-in material (chains existing hooks). */
export function patchAtmosphere<M extends T.Material>(m: M): M {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    Object.assign(s.uniforms, atmosphereUniforms);
    prev.call(m, s, r);
  };
  return m;
}
