import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { Sky } from "three/addons/objects/Sky.js";
import { Materials } from "./materials";
import { Terrain, type WorldData, type Placement, seeded } from "./world";

type TreeBatch = {
  mesh: T.InstancedMesh;
  entries: Placement[];
  lod: number;
  isBroad: boolean;
};
export class Landscape {
  scene = new T.Scene();
  materials: Materials;
  sun = new T.DirectionalLight(0xffe0ac, 3.5);
  hemi = new T.HemisphereLight(0xd3dfed, 0x75765c, 3.2);
  sky = new Sky();
  treeBatches: TreeBatch[] = [];
  treeClock = 0;
  quality = "standard";
  water: T.Mesh;
  windGrass: T.MeshStandardMaterial;
  models = new Map<string, T.Group>();
  terrainMesh: T.Mesh;
  riverLine: T.Vector3[] = [];
  constructor(
    public renderer: T.WebGLRenderer,
    public data: WorldData,
    public terrain: Terrain,
  ) {
    this.materials = new Materials(renderer);
    const s = this.scene;
    s.fog = new T.FogExp2(0xa6b4b3, 0.0022);
    s.background = new T.Color("#b8cad0");
    const ground = this.materials.get("moss").clone();
    ground.vertexColors = true;
    this.terrainMesh = new T.Mesh(terrain.geometry(), ground);
    this.terrainMesh.receiveShadow = true;
    s.add(this.terrainMesh);
    this.sky.scale.setScalar(450000);
    s.add(this.sky);
    s.add(this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -65;
    this.sun.shadow.camera.right = 65;
    this.sun.shadow.camera.top = 65;
    this.sun.shadow.camera.bottom = -65;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.normalBias = 0.07;
    this.sun.shadow.bias = -0.00015;
    this.setTime(18);
    this.paths();
    this.water = this.river();
    this.windGrass = this.vegetation();
    this.paddies();
    this.wires();
    this.details();
  }
  setTime(time: number) {
    const h = time - 17,
      elevation = T.MathUtils.degToRad(14 - h * 6.5),
      azimuth = T.MathUtils.degToRad(263 + h * 5);
    const pos = new T.Vector3().setFromSphericalCoords(
      1,
      Math.PI / 2 - elevation,
      azimuth,
    );
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.003;
    u.mieDirectionalG.value = 0.83;
    u.sunPosition.value.copy(pos);
    this.sun.position
      .copy(pos.multiplyScalar(260))
      .add(new T.Vector3(0, 20, -50));
    this.sun.target.position.set(0, 20, -50);
    this.sun.intensity = T.MathUtils.lerp(3.5, 0.5, h / 2);
    this.sun.color.setHSL(0.105 - h * 0.018, 0.34 + h * 0.1, 0.82);
    this.hemi.intensity = T.MathUtils.lerp(3.6, 1.6, h / 2);
    this.renderer.toneMappingExposure = T.MathUtils.lerp(1.1, 0.85, h / 2);
    (this.scene.fog as T.FogExp2).color.setHSL(
      0.55 - h * 0.055,
      0.12,
      0.68 - h * 0.06,
    );
  }
  async load(onProgress: (n: number) => void) {
    const hdr = await new RGBELoader().loadAsync(
      "/assets/venice_sunset_1k.hdr",
    );
    const pmrem = new T.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(hdr);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.55;
    hdr.dispose();
    pmrem.dispose();
    const loader = new GLTFLoader();
    const names = [
      ...new Set(this.data.objects.map((o) => o.asset)),
      "rock",
      "cedar-low",
      "cedar-far",
      "broadleaf-low",
      "broadleaf-far",
    ];
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        const gltf = await loader.loadAsync(`/assets/models/${name}.glb`);
        gltf.scene.traverse((o) => {
          if (o instanceof T.Mesh) {
            const old = o.material as T.MeshStandardMaterial;
            o.material = this.materials.get(old.name);
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.models.set(name, gltf.scene);
        onProgress(++done / names.length);
      }),
    );
    const nonTrees = this.data.objects.filter(
      (o) => !o.asset.startsWith("cedar") && o.asset !== "broadleaf",
    );
    for (const name of new Set(nonTrees.map((o) => o.asset)))
      this.batchModel(
        name,
        nonTrees.filter((o) => o.asset === name),
      );
    const trees = this.data.objects.filter(
      (o) => o.asset.startsWith("cedar") || o.asset === "broadleaf",
    );
    for (const name of ["cedar0", "cedar1", "cedar2", "broadleaf"]) {
      const entries = trees.filter((o) => o.asset === name);
      for (let lod = 0; lod < 3; lod++) {
        const asset =
          lod === 0
            ? name
            : (name === "broadleaf" ? "broadleaf" : "cedar") +
              (lod === 1 ? "-low" : "-far");
        this.batchModel(asset, entries, lod, name === "broadleaf");
      }
    }
    const r = seeded(345);
    const stones: Placement[] = [];
    for (let i = 0; i < 130; i++) {
      const z = -20 + r() * 380,
        x = 83 + 9 * Math.sin(z * 0.025) + (r() - 0.5) * 7;
      stones.push({
        id: `river-rock-${i}`,
        asset: "rock",
        position: [x, this.terrain.sample(x, z) + 0.1, z],
        rotation: [0, r() * 6.28, 0],
        scale: [0.2 + r() * 0.7, 0.2 + r() * 0.7, 0.2 + r() * 0.7],
      });
    }
    this.batchModel("rock", stones);
    this.updateTrees(new T.Vector3(0, 2, 12));
  }
  batchModel(
    name: string,
    entries: Placement[],
    lod?: number,
    isBroad = false,
  ) {
    const source = this.models.get(name)!;
    source.updateMatrixWorld(true);
    const matrix = new T.Matrix4(),
      q = new T.Quaternion(),
      e = new T.Euler(),
      v = new T.Vector3();
    source.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const m = new T.InstancedMesh(o.geometry, o.material, entries.length);
      m.name = name + ":" + o.name;
      m.castShadow = lod === undefined || lod === 0;
      m.receiveShadow = true;
      m.frustumCulled = lod === undefined;
      for (let i = 0; i < entries.length; i++) {
        const p = entries[i];
        e.set(p.rotation[0], p.rotation[1], p.rotation[2]);
        q.setFromEuler(e);
        matrix.compose(
          new T.Vector3(...(p.position as [number, number, number])),
          q,
          v.fromArray(p.scale),
        );
        matrix.multiply(o.matrixWorld);
        m.setMatrixAt(i, matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      if (lod !== undefined)
        this.treeBatches.push({ mesh: m, entries, lod, isBroad });
      else m.computeBoundingSphere();
      this.scene.add(m);
    });
  }
  updateTrees(camera: T.Vector3) {
    const matrix = new T.Matrix4(),
      q = new T.Quaternion(),
      p3 = new T.Vector3(),
      scale = new T.Vector3();
    for (const b of this.treeBatches) {
      let visible = 0;
      const near = this.quality === "low" ? 22 : 58,
        mid = this.quality === "low" ? 90 : 190,
        far = this.quality === "low" ? 280 : 410;
      for (const p of b.entries) {
        const d = p3.fromArray(p.position).distanceTo(camera);
        const target = d < near ? 0 : d < mid ? 1 : d < far ? 2 : 3;
        if (target !== b.lod) continue;
        q.setFromAxisAngle(T.Object3D.DEFAULT_UP, p.rotation[1]);
        scale.fromArray(p.scale);
        matrix.compose(p3, q, scale);
        b.mesh.setMatrixAt(visible++, matrix);
      }
      b.mesh.count = visible;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
    }
  }
  paths() {
    const geo: T.BufferGeometry[] = [];
    const temp = new T.Mesh(new T.BoxGeometry(), this.materials.get("stone"));
    const add = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
    ) => {
      temp.geometry = new T.BoxGeometry(w, h, d);
      temp.position.set(x, y, z);
      temp.updateMatrix();
      geo.push(temp.geometry.clone().applyMatrix4(temp.matrix));
    };
    for (const st of this.data.steps) {
      add(st.width, 0.22, 0.5, 0, st.y - 0.11, st.z + 0.24);
      for (const s of [-1, 1])
        add(0.38, 0.55, 0.49, s * 2.9, st.y - 0.1, st.z + 0.24);
    }
    for (let i = 1; i <= 3; i++)
      add(5.4, 0.24, 3, 0, i * 9.5 - 0.12, -i * 27 + 1.5);
    add(5.4, 0.24, 5, 0, -0.12, 2.5);
    add(48, 0.35, 48, 0, 37.83, -129);
    // central stone paving inside a gravel courtyard
    const m = new T.Mesh(mergeGeometries(geo), this.materials.get("stone"));
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    const courtyard = this.materials.get("soil").clone();
    courtyard.map = courtyard.map!.clone();
    courtyard.map.repeat.set(15, 15);
    courtyard.normalMap = courtyard.normalMap!.clone();
    courtyard.normalMap.repeat.set(15, 15);
    courtyard.roughnessMap = courtyard.roughnessMap!.clone();
    courtyard.roughnessMap.repeat.set(15, 15);
    const gravel = new T.Mesh(new T.PlaneGeometry(47, 47), courtyard);
    gravel.rotation.x = -Math.PI / 2;
    gravel.position.set(0, 38.02, -129);
    gravel.receiveShadow = true;
    this.scene.add(gravel);
    const path = new T.Mesh(
      new T.PlaneGeometry(4.4, 30),
      this.materials.get("stone"),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 38.05, -119);
    path.receiveShadow = true;
    this.scene.add(path);
    const roadPts: T.Vector3[] = [];
    for (let z = 12; z < 365; z += 3) {
      const x = -32 + 18 * Math.sin(z * 0.015);
      roadPts.push(new T.Vector3(x, this.terrain.sample(x, z) + 0.055, z));
    }
    this.ribbon(
      roadPts,
      4,
      new T.MeshStandardMaterial({ color: 0x696b5c, roughness: 1 }),
    );
    const footPts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20,
        x = -32 * t + 18 * Math.sin(28 * 0.015) * t,
        z = 8 + 20 * t;
      footPts.push(new T.Vector3(x, this.terrain.sample(x, z) + 0.06, z));
    }
    this.ribbon(footPts, 3, this.materials.get("soil"));
  }
  ribbon(points: T.Vector3[], width: number, material: T.Material) {
    const pos: number[] = [],
      uv: number[] = [],
      idx: number[] = [];
    points.forEach((p, i) => {
      pos.push(p.x - width / 2, p.y, p.z, p.x + width / 2, p.y, p.z);
      uv.push(0, i * 0.25, 1, i * 0.25);
      if (i < points.length - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, material);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }
  river() {
    const pts = [];
    for (let z = -15; z <= 370; z += 3) {
      const x = 83 + 9 * Math.sin(z * 0.025);
      pts.push(new T.Vector3(x, this.terrain.sample(x, z) + 0.55, z));
    }
    this.riverLine = pts;
    this.ribbon(
      pts.map((p) => p.clone().add(new T.Vector3(0, -0.47, 0))),
      5.5,
      this.materials.get("stone"),
    );
    const mat = new T.MeshPhysicalMaterial({
      color: 0x527f72,
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.66,
      clearcoat: 0.35,
      envMapIntensity: 0.25,
      clearcoatRoughness: 0.15,
      normalMap: this.materials.loader.load("/assets/water-normal.png"),
      normalScale: new T.Vector2(0.2, 0.13),
      depthWrite: false,
    });
    mat.normalMap!.wrapS = mat.normalMap!.wrapT = T.RepeatWrapping;
    const water = this.ribbon(pts, 4.5, mat);
    for (const side of [-1, 1])
      this.ribbon(
        pts.map((p) => p.clone().add(new T.Vector3(side * 2.9, 0.12, 0))),
        0.7,
        this.materials.get("stone"),
      );
    // Narrow timber bridge across the stream.
    const bridge = new T.Mesh(
      new T.BoxGeometry(10, 0.3, 3),
      this.materials.get("wood"),
    );
    bridge.position.set(
      83 + 9 * Math.sin(115 * 0.025),
      this.terrain.sample(83, 115) + 0.75,
      115,
    );
    bridge.castShadow = bridge.receiveShadow = true;
    this.scene.add(bridge);
    return water;
  }
  vegetation() {
    const rand = seeded(883);
    const geo = new T.BufferGeometry();
    const pos = [
      -0.055, 0, 0, 0.055, 0, 0, 0.015, 0.75, 0.04, -0.03, 0, -0.04, 0.03, 0,
      0.04, -0.05, 0.53, 0.13, 0, 0, -0.04, 0, 0, 0.04, 0.22, 0.59, 0,
    ];
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({
      color: 0x5f7041,
      roughness: 1,
      side: T.DoubleSide,
    });
    this.animateGrass(mat);
    const mesh = new T.InstancedMesh(geo, mat, 6500);
    const matrix = new T.Matrix4(),
      q = new T.Quaternion();
    for (let i = 0; i < 6500; i++) {
      let x, z;
      if (i < 4200) {
        z = -rand() * 108;
        x = (rand() < 0.5 ? -1 : 1) * (3.2 + rand() * 8);
      } else {
        z = rand() * 330 + 10;
        x =
          -32 +
          18 * Math.sin(z * 0.015) +
          (rand() < 0.5 ? -1 : 1) * (3 + rand() * 5);
      }
      let y = this.terrain.sample(x, z) + 0.04;
      if (Math.abs(x) < 4 && z < 0) y = this.stairY(z) - 0.05;
      matrix.compose(
        new T.Vector3(x, y, z),
        q.setFromAxisAngle(T.Object3D.DEFAULT_UP, rand() * 6.28),
        new T.Vector3(
          0.6 + rand() * 0.6,
          0.35 + rand() * 0.8,
          0.6 + rand() * 0.6,
        ),
      );
      mesh.setMatrixAt(i, matrix);
    }
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    return mat;
  }
  animateGrass(mat: T.MeshStandardMaterial) {
    const wind = this.materials.wind;
    mat.onBeforeCompile = (s) => {
      s.uniforms.windTime = wind;
      s.vertexShader = "uniform float windTime;\n" + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n transformed.x += sin(windTime*1.6 + instanceMatrix[3].x*.4+instanceMatrix[3].z*.2)*position.y*position.y*.1;",
      );
    };
    mat.customProgramCacheKey = () => "grass-wind-v1";
  }
  stairY(z: number) {
    const d = T.MathUtils.clamp(-z, 0, 105),
      f = Math.min(3, Math.floor(d / 27));
    return (
      f * 9.5 + Math.min(50, Math.ceil(Math.max(0, d - f * 27) / 0.48)) * 0.19
    );
  }
  paddies() {
    const before = new Set(this.scene.children);
    const fieldMat = new T.MeshStandardMaterial({
      color: 0x4f6234,
      roughness: 0.98,
      envMapIntensity: 0.15,
    });
    const rand = seeded(617),
      pos: number[] = [];
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * Math.PI * 2,
        x = Math.cos(a) * 0.05,
        z = Math.sin(a) * 0.05;
      pos.push(
        x - 0.028,
        0,
        z,
        x + 0.028,
        0,
        z,
        x + Math.cos(a) * 0.11,
        0.78 + rand() * 0.13,
        z + Math.sin(a) * 0.11,
      );
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({
      color: 0x66843b,
      roughness: 1,
      envMapIntensity: 0.25,
      side: T.DoubleSide,
    });
    this.animateGrass(mat);
    const count = this.data.fields.length * 22 * 26;
    const rice = new T.InstancedMesh(g, mat, count);
    let i = 0;
    const matrix = new T.Matrix4(),
      q = new T.Quaternion();
    for (const f of this.data.fields) {
      const [x, , z] = f.center,
        [w, d] = f.size;
      const pts = [];
      for (let j = 0; j <= 20; j++) {
        const zz = z - d / 2 + (j * d) / 20;
        pts.push(new T.Vector3(x, this.terrain.sample(x, zz) + 0.05, zz));
      }
      this.ribbon(pts, w, fieldMat);
      for (const s of [-1, 1]) {
        this.ribbon(
          pts.map((p) =>
            p.clone().add(new T.Vector3(s * (w / 2 + 0.35), 0.13, 0)),
          ),
          0.65,
          this.materials.get("soil"),
        );
      }
      for (let r = 0; r < 26; r++)
        for (let c = 0; c < 22; c++) {
          const xx =
              x - w / 2 + 0.7 + (c * (w - 1.4)) / 21 + (rand() - 0.5) * 0.12,
            zz = z - d / 2 + 0.8 + (r * (d - 1.6)) / 25;
          matrix.compose(
            new T.Vector3(xx, this.terrain.sample(xx, zz) + 0.08, zz),
            q.setFromAxisAngle(T.Object3D.DEFAULT_UP, rand() * 6.28),
            new T.Vector3(1, 0.83 + rand() * 0.3, 1),
          );
          rice.setMatrixAt(i++, matrix);
        }
    }
    rice.receiveShadow = true;
    rice.computeBoundingSphere();
    this.scene.add(rice);
    const batches = new Map<T.Material, T.BufferGeometry[]>();
    for (const object of [...this.scene.children]) {
      if (before.has(object) || object === rice || !(object instanceof T.Mesh))
        continue;
      const mat = object.material as T.Material;
      object.updateMatrixWorld();
      const gs = batches.get(mat) || [];
      gs.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
      batches.set(mat, gs);
      this.scene.remove(object);
      object.geometry.dispose();
    }
    for (const [mat, gs] of batches) {
      const mesh = new T.Mesh(mergeGeometries(gs), mat);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      gs.forEach((g) => g.dispose());
    }
  }
  wires() {
    const poles = this.data.objects.filter((o) => o.asset === "pole");
    const mat = new T.LineBasicMaterial({ color: 0x34382f });
    for (let i = 1; i < poles.length; i++)
      for (const s of [-0.9, 0, 0.9]) {
        const a = poles[i - 1].position,
          b = poles[i].position,
          pts = [];
        for (let j = 0; j <= 20; j++) {
          const t = j / 20;
          pts.push(
            new T.Vector3(
              T.MathUtils.lerp(a[0], b[0], t) + s,
              T.MathUtils.lerp(a[1], b[1], t) +
                8.4 -
                Math.sin(t * Math.PI) * 0.65,
              T.MathUtils.lerp(a[2], b[2], t),
            ),
          );
        }
        this.scene.add(
          new T.Line(new T.BufferGeometry().setFromPoints(pts), mat),
        );
      }
  }
  details() {
    // Moss seams, fallen leaves, stones: merged and instanced rather than individual draw calls.
    const rand = seeded(87);
    const g = new T.CircleGeometry(0.065, 5);
    g.rotateX(-Math.PI / 2);
    const mat = new T.MeshStandardMaterial({
      color: 0x655132,
      roughness: 1,
      side: T.DoubleSide,
    });
    const m = new T.InstancedMesh(g, mat, 1700),
      mx = new T.Matrix4(),
      q = new T.Quaternion();
    for (let i = 0; i < 1700; i++) {
      const z = -rand() * 105,
        x = (rand() - 0.5) * 5.2,
        y = this.stairY(z) + 0.013;
      mx.compose(
        new T.Vector3(x, y, z),
        q.setFromAxisAngle(T.Object3D.DEFAULT_UP, rand() * 6.28),
        new T.Vector3(1, 1, rand() + 0.5),
      );
      m.setMatrixAt(i, mx);
    }
    m.receiveShadow = true;
    m.computeBoundingSphere();
    this.scene.add(m);
    // lookout bench and simple unobtrusive rail
    for (const x of [18, 24]) {
      const b = new T.Mesh(
        new T.BoxGeometry(0.2, 1.1, 0.2),
        this.materials.get("wood"),
      );
      b.position.set(x, 38.6, -106);
      this.scene.add(b);
    }
    const rail = new T.Mesh(
      new T.BoxGeometry(6.5, 0.12, 0.14),
      this.materials.get("wood"),
    );
    rail.position.set(21, 39.1, -106);
    this.scene.add(rail);
  }
  update(dt: number, time: number, position: T.Vector3) {
    this.materials.wind.value = time;
    this.treeClock += dt;
    if (this.treeClock > 0.5) {
      this.treeClock = 0;
      this.updateTrees(position);
    }
    const mat = this.water.material as T.MeshPhysicalMaterial;
    if (mat.normalMap) {
      mat.normalMap.offset.y = time * 0.017;
      mat.normalMap.offset.x = time * 0.009;
    }
  }
  setQuality(q: string) {
    this.quality = q;
    const dpr =
      q === "low"
        ? 1
        : q === "high"
          ? Math.min(devicePixelRatio, 1.5)
          : Math.min(devicePixelRatio, 1.25);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q !== "low";
    this.sun.shadow.mapSize.setScalar(q === "high" ? 4096 : 2048);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
