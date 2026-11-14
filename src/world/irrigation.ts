import * as T from 'three';
import type { Landscape } from './landscape';
/** Narrow open channels and covered road crossings use the same source graph. */
export function irrigationWorks(land: Landscape) {
  const water = new T.MeshStandardMaterial({color:0x526b62,roughness:.3,metalness:.1});
  for(const link of land.world.data.irrigation?.links ?? []) {
    if(link.covered) continue; // buried pipe: preserve the existing road surface
    const a=new T.Vector3(...link.points[0] as [number,number,number]), b=new T.Vector3(...link.points[1] as [number,number,number]);
    const length=a.distanceTo(b);if(length<.1)continue;
    const center=a.clone().add(b).multiplyScalar(.5);
    const direction=b.clone().sub(a).normalize();
    const mesh=new T.Mesh(new T.BoxGeometry(.5,.035,length),water);
    mesh.position.copy(center);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),direction);
    mesh.receiveShadow=true;land.scene.add(mesh);
  }
}
