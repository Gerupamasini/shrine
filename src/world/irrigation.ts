import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Landscape } from './landscape';
/** Narrow open channels and covered road crossings use the same source graph. The open links are
 *  merged into one mesh (one draw; they were a mesh and a draw call each, a few hundred). */
export function irrigationWorks(land: Landscape) {
  const water = land.lib.finish(new T.MeshStandardMaterial({ color: 0x526b62, roughness: .3, metalness: .1 }));
  const parts: T.BufferGeometry[] = [];
  const m = new T.Matrix4(), q = new T.Quaternion(), one = new T.Vector3(1, 1, 1);
  for (const link of land.world.data.irrigation?.links ?? []) {
    if (link.covered) continue; // buried pipe: preserve the existing road surface
    const a = new T.Vector3(...link.points[0] as [number, number, number]), b = new T.Vector3(...link.points[1] as [number, number, number]);
    const length = a.distanceTo(b); if (length < .1) continue;
    const center = a.clone().add(b).multiplyScalar(.5);
    const direction = b.clone().sub(a).normalize();
    q.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
    parts.push(new T.BoxGeometry(.5, .035, length).applyMatrix4(m.compose(center, q, one)));
  }
  const merged = parts.length ? mergeGeometries(parts, false) : null;
  if (!merged) return;
  const mesh = new T.Mesh(merged, water);
  mesh.name = 'irrigation-links';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  land.scene.add(mesh);
}
