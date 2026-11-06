import type * as T from "three";

type Hook = (shader: T.WebGLProgramParametersWithUniforms, renderer: T.WebGLRenderer) => void;

/** Chain an onBeforeCompile hook and extend the program cache key. */
export function addHook(m: T.Material, key: string, hook: Hook) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    hook(s, r);
  };
  m.customProgramCacheKey = () => prevKey() + "|" + key;
  m.needsUpdate = true;
}
