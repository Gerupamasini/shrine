// Split the wheels out of a joined vehicle model.
//
// The kei truck's Blender source names its wheel assemblies (wheel_fl ...), and the joiner keeps them
// as nodes the game spins and steers. The procedural models (build.py) make each wheel from many small
// parts - tyre casing, rim barrel, beads, spokes, centre, lug nuts, tread grooves - that were joined into
// the body by material, so their wheels could neither turn nor steer. Here every connected piece of a
// primitive that lies wholly inside one wheel's cylinder (from designs.json: axles, track, radius, tyre
// width) moves to a node `wheel_<f|r><l|r>` at that wheel's centre, its vertices made relative to it.
// The body (whose wheel openings are cut wider than the tyre), the axle beam and the mud flaps span
// more than a wheel and stay where they are.

const NAMES = { "1,1": "wheel_fl", "1,-1": "wheel_fr", "0,1": "wheel_rl", "0,-1": "wheel_rr" };

/** Wheel centres and half extents (model space: +Z forward, +X the driver's left, Y up). */
export function wheelStations(d) {
  const R = d.r, tw = d.tire, x = d.w / 2 - tw * 0.55;
  const out = [];
  for (const [front, z] of [[0, d.frontAxle - d.wheelbase], [1, d.frontAxle]])
    for (const sign of [1, -1])
      out.push({ name: NAMES[`${front},${sign}`], center: [sign * x, R, z], half: [tw * 0.55 + 0.06, R * 1.03 + 0.006, R * 1.03 + 0.006] });
  return out;
}

export function splitWheels(doc, design) {
  const root = doc.getRoot(), scene = root.listScenes()[0], buffer = root.listBuffers()[0];
  if (root.listNodes().some((n) => /^wheel_/.test(n.getName()))) return 0;
  const stations = wheelStations(design);
  const parts = stations.map(() => []);
  let moved = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.listChildren().length) continue;
    const m = node.getWorldMatrix();
    const xf = (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    const rot = (v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"), idx = prim.getIndices();
      if (!pos || !idx) continue;
      const n = pos.getCount(), tris = idx.getArray(), world = new Float32Array(n * 3), v = [0, 0, 0];
      for (let i = 0; i < n; i++) world.set(xf(pos.getElement(i, v)), i * 3);
      // connected pieces: shared vertices, and vertices at the same place (split normals, seams)
      const parent = Int32Array.from({ length: n }, (_, i) => i);
      const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
      const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
      for (let t = 0; t < tris.length; t += 3) (unite(tris[t], tris[t + 1]), unite(tris[t], tris[t + 2]));
      const at = new Map();
      for (let i = 0; i < n; i++) {
        const key = `${Math.round(world[i * 3] * 1e4)},${Math.round(world[i * 3 + 1] * 1e4)},${Math.round(world[i * 3 + 2] * 1e4)}`;
        if (at.has(key)) unite(i, at.get(key)); else at.set(key, i);
      }
      const box = new Map();
      for (let i = 0; i < n; i++) {
        const r = find(i);
        let b = box.get(r);
        if (!b) box.set(r, (b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
        for (let c = 0; c < 3; c++) (b[c] = Math.min(b[c], world[i * 3 + c])), (b[c + 3] = Math.max(b[c + 3], world[i * 3 + c]));
      }
      const wheelOf = new Map();
      for (const [r, b] of box) {
        const k = stations.findIndex((s) => [0, 1, 2].every((c) => b[c] >= s.center[c] - s.half[c] && b[c + 3] <= s.center[c] + s.half[c]));
        if (k >= 0) wheelOf.set(r, k);
      }
      if (!wheelOf.size) continue;
      const keep = [], take = stations.map(() => []);
      for (let t = 0; t < tris.length; t += 3) {
        const k = wheelOf.get(find(tris[t]));
        (k === undefined ? keep : take[k]).push(tris[t], tris[t + 1], tris[t + 2]);
      }
      take.forEach((list, k) => {
        if (!list.length) return;
        // the piece as its own primitive, vertices relative to the wheel centre
        const remap = new Map(), order = [];
        for (const i of list) if (!remap.has(i)) (remap.set(i, order.length), order.push(i));
        const c = stations[k].center, np = doc.createPrimitive().setMaterial(prim.getMaterial());
        for (const sem of prim.listSemantics()) {
          const a = prim.getAttribute(sem), size = a.getElementSize(), arr = new Float32Array(order.length * size), e = [];
          order.forEach((i, j) => {
            let val = a.getElement(i, e);
            if (sem === "POSITION") val = xf(val).map((q, q3) => q - c[q3]);
            else if (sem === "NORMAL" || sem === "TANGENT") val = [...rot(val.slice(0, 3)), ...val.slice(3)];
            arr.set(val, j * size);
          });
          np.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(arr).setNormalized(false).setBuffer(buffer));
        }
        np.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(list, (i) => remap.get(i))).setBuffer(buffer));
        parts[k].push(np);
        moved += list.length / 3;
      });
      prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(keep)).setBuffer(buffer));
    }
  }
  stations.forEach((s, k) => {
    if (!parts[k].length) return;
    const mesh = doc.createMesh(s.name);
    parts[k].forEach((p) => mesh.addPrimitive(p));
    scene.addChild(doc.createNode(s.name).setMesh(mesh).setTranslation(s.center));
  });
  return moved;
}
