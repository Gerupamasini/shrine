// Development page: houses on a yard under the game's light, sky, shadows and post chain, for quick
// look development of building materials without loading the whole valley.
// Open /tools/house-lab/ on the dev server; tools/house-lab/shot.mjs drives it headless.
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { installAtmosphere, patchAtmosphere } from "../../src/engine/atmosphere";
import { Library } from "../../src/engine/library";
import { Lighting } from "../../src/engine/lighting";
import { Post } from "../../src/engine/post";
import { publicUrl } from "../../src/urls";
import { buildingMaterial, type DuskRamp } from "../../src/world/architecture";
import { facadeDebug } from "../../src/engine/facade";

installAtmosphere();
const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new T.WebGLRenderer({ canvas, antialias: false, stencil: false });
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.info.autoReset = false;
const scene = new T.Scene();
scene.fog = new T.FogExp2(0x000000, 0.001);
const camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 9000);
camera.rotation.order = "YXZ";
const lib = new Library(renderer);
const params = new URLSearchParams(location.search);
facadeDebug.noBakedAO = params.has("noao");
const scenejson = await fetch(publicUrl("world/scene.json")).then((r) => r.json());
const lighting = new Lighting(renderer, scene, camera, scenejson.environment);
await lighting.init("standard");
lib.finishers.push((m) => lighting.setupMaterial(m));
const post = new Post(renderer, scene, camera);
post.setQuality("standard");
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
post.setSize(innerWidth, innerHeight, 1);
camera.aspect = innerWidth / innerHeight;
camera.updateProjectionMatrix();

// yard: packed earth and gravel
const ground = new T.Mesh(new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), lib.pbr({ tex: "stony_dirt_path", size: 3, color: "#a89f90" }));
const uv = ground.geometry.attributes.uv;
for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 400, uv.getY(i) * 400);
ground.receiveShadow = true;
scene.add(ground);
const grass = new T.Mesh(new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), patchAtmosphere(lib.finish(new T.MeshStandardMaterial({ color: 0x2c3a1c, roughness: 1 }))));
grass.position.y = -0.02;
scene.add(grass);

const dusk: DuskRamp[] = [];
const mats = new Map<string, T.Material>();
const loader = new GLTFLoader();
// name:x:z:yawDeg
const list = (params.get("houses") ?? "minka-kawara_0:0:0:0,minka-kayabuki_0:22:0:0,minka-totan_1:-22:0:0,minka-kawara_1:0:-28:0,naya_0:16:-22:30,minka-kura_0:-14:-22:0,shop-yorozuya:36:-20:0").split(",");
await Promise.all(list.map(async (spec) => {
  const [name, x, z, yaw] = spec.split(":");
  const g = await loader.loadAsync(publicUrl(`assets/models/architecture/${name}.glb`));
  g.scene.updateMatrixWorld(true);
  const m = new T.Matrix4().compose(new T.Vector3(+x, 0, +z), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), T.MathUtils.degToRad(+yaw)), new T.Vector3(1, 1, 1));
  g.scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const src = o.material as T.Material;
    let mat = mats.get(src.name);
    if (!mat) { mat = buildingMaterial(lib, src.name, dusk) ?? lib.finish(src); mats.set(src.name, mat); }
    const mesh = new T.InstancedMesh(o.geometry, mat, 1);
    mesh.setMatrixAt(0, m.clone().multiply(o.matrixWorld));
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  });
}));
await lib.ready();
let yaw = 0, pitch = 0;
function setTime(h: number) {
  lighting.setTime(h);
  for (const d of dusk) {
    const [a, b, full] = d.ramp;
    d.m.emissiveIntensity = d.base + (full - d.base) * T.MathUtils.smoothstep(h, a, b);
  }
}
setTime(+(params.get("time") ?? 17.6));
const lab = {
  ready: true,
  view(x: number, y: number, z: number, az: number, p: number) {
    camera.position.set(x, y, z);
    yaw = -T.MathUtils.degToRad(az);
    pitch = T.MathUtils.degToRad(p);
    camera.rotation.set(pitch, yaw, 0);
    camera.updateMatrixWorld();
  },
  setTime,
  frames(n: number) {
    for (let i = 0; i < n; i++) {
      lighting.update();
      lighting.renderShadows();
      renderer.info.reset();
      post.draw(1 / 60);
    }
    return renderer.info.render;
  },
  sun: () => ({ az: lighting.azimuth, el: lighting.elevation }),
};
(window as unknown as { __lab: typeof lab }).__lab = lab;
lab.view(8, 1.6, 16, 0, -2);
const loop = () => { lab.frames(1); requestAnimationFrame(loop); };
if (!params.has("capture")) loop();
