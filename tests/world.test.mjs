import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const data = JSON.parse(fs.readFileSync("public/world/scene.json", "utf8"));
test("200 walkable risers form four 9.5m flights and three 3m landings", () => {
  assert.equal(data.steps.length, 200);
  for (let i = 0; i < 200; i++) {
    const s = data.steps[i];
    assert.equal(s.index, i + 1);
    assert.ok(Math.abs(s.y - (i + 1) * 0.19) < 1e-5);
    assert.ok(s.depth >= 0.45 && s.width >= 5);
    if (i) {
      const dz = data.steps[i - 1].z - s.z;
      assert.ok(Math.abs(dz - (i % 50 === 0 ? 3.48 : 0.48)) < 1e-5);
    }
  }
  assert.equal(data.steps.at(-1).y, 38);
  assert.equal(data.steps.at(-1).z, -105);
});
test("portable terrain is a complete 513² little-endian 16-bit heightmap", () => {
  const b = fs.readFileSync("public/world/heightmap.r16");
  assert.equal(b.length, 513 * 513 * 2);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < b.length; i += 2) {
    const h = (b.readUInt16LE(i) / 65535) * 256 - 8;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  assert.ok(min > -8 && max < 248);
  assert.ok(max > 100);
  const plateau =
    (b.readUInt16LE((Math.round((-129 / 1200 + 0.5) * 512) * 513 + 256) * 2) /
      65535) *
      256 -
    8;
  assert.ok(Math.abs(plateau - 38) < 0.02);
});
test("all scene model references resolve to complete glTF2 binary containers", () => {
  for (const p of data.objects) {
    const f = path.join("public/assets/models", p.asset + ".glb");
    const b = fs.readFileSync(f);
    assert.equal(b.subarray(0, 4).toString(), "glTF", f);
    assert.equal(b.readUInt32LE(4), 2);
    assert.equal(b.readUInt32LE(8), b.length);
    assert.ok(p.position.every(Number.isFinite));
    assert.ok(p.scale.every((v) => v > 0));
  }
  assert.equal(
    new Set(data.objects.map((p) => p.id)).size,
    data.objects.length,
  );
});
test("tree placement preserves the complete approach corridor", () => {
  for (const p of data.objects.filter(
    (p) => p.asset.startsWith("cedar") || p.asset === "broadleaf",
  )) {
    const [x, , z] = p.position;
    if (z < 0 && z > -105)
      assert.ok(Math.abs(x) >= 7.8, `${p.id} blocks steps`);
  }
});
test("material and audio payloads are real files, not remote runtime URLs", () => {
  for (const name of [
    "summer-insects-synth.wav",
    "wind-synth.wav",
    "stream-synth.wav",
  ]) {
    const b = fs.readFileSync("public/assets/audio/" + name);
    assert.equal(b.subarray(0, 4).toString(), "RIFF");
    assert.ok(b.length > 22050 * 50 * 2);
  }
  assert.ok(fs.statSync("public/assets/venice_sunset_1k.hdr").size > 1000000);
});
test("bookmarks do not teleport the player into houses or tree trunks", () => {
  for (const [name, p] of Object.entries(data.landmarks))
    for (const o of data.objects) {
      if (!o.collider) continue;
      const [x, , z] = o.position,
        scale = o.scale[0];
      if (o.collider.type === "box") {
        const h = o.collider.halfExtents;
        assert.ok(
          Math.abs(p[0] - x) > h[0] * scale + 0.3 ||
            Math.abs(p[2] - z) > h[2] * scale + 0.3,
          `${name} intersects ${o.id}`,
        );
      } else {
        assert.ok(
          Math.hypot(p[0] - x, p[2] - z) >
            (o.collider.radius ?? 0.4) * scale + 0.3,
          `${name} intersects ${o.id}`,
        );
      }
    }
});
test("trees leave the village road, river and farm houses clear", () => {
  const trees = data.objects.filter(
    (o) => o.asset.startsWith("cedar") || o.asset === "broadleaf",
  );
  for (const t of trees) {
    const [x, , z] = t.position;
    if (z >= 12 && z <= 365)
      assert.ok(Math.abs(x - (-32 + 18 * Math.sin(z * 0.015))) >= 5);
    if (z >= -15 && z <= 370)
      assert.ok(Math.abs(x - (83 + 9 * Math.sin(z * 0.025))) >= 6);
    for (const h of data.objects.filter((o) => o.collider?.type === "box")) {
      const e = h.collider.halfExtents,
        s = h.scale[0];
      assert.ok(
        Math.abs(x - h.position[0]) >= e[0] * s + 2.5 ||
          Math.abs(z - h.position[2]) >= e[2] * s + 2.5,
      );
    }
  }
});

const heightBytes = fs.readFileSync("public/world/heightmap.r16");
function heightAt(x, z) {
  const fx = (x / 1200 + 0.5) * 512,
    fz = (z / 1200 + 0.5) * 512,
    ix = Math.floor(fx),
    iz = Math.floor(fz),
    a = fx - ix,
    b = fz - iz;
  const h = (i, j) =>
    (heightBytes.readUInt16LE((j * 513 + i) * 2) / 65535) * 256 - 8;
  return (
    (h(ix, iz) * (1 - a) + h(ix + 1, iz) * a) * (1 - b) +
    (h(ix, iz + 1) * (1 - a) + h(ix + 1, iz + 1) * a) * b
  );
}
test("paddy interiors are horizontal and settlement pads sit above the floodplain", () => {
  for (const f of data.fields) {
    const [x, y, z] = f.center,
      [w, d] = f.size;
    for (const sx of [-1, 0, 1])
      for (const sz of [-1, 0, 1])
        assert.ok(
          Math.abs(heightAt(x + sx * (w / 2 - 3), z + sz * (d / 2 - 3)) - y) <
            0.035,
          `${f.id} cannot retain water`,
        );
  }
  for (const o of data.objects.filter((o) =>
    ["house", "metal-house", "thatch-house"].includes(o.asset),
  )) {
    const [x, y, z] = o.position;
    assert.ok(y - (1.1 + 0.003 * (360 - z)) > 1);
    assert.ok(Math.abs(heightAt(x, z) - y) < 0.035, `${o.id} unsupported`);
  }
});
test("river drains downstream without uphill water and stays below residential ground", () => {
  const p = data.river.centerline;
  for (let i = 1; i < p.length; i++) {
    assert.ok(p[i][2] > p[i - 1][2]);
    assert.ok(p[i][1] < p[i - 1][1]);
    assert.ok(heightAt(p[i][0], p[i][2]) < p[i][1] + 0.1);
  }
  for (const o of data.objects.filter((o) => o.asset.endsWith("house")))
    assert.ok(o.position[1] - (0.55 - 0.003 * o.position[2]) > 2);
});
test("botanical images are decodable PNG/JPEG payloads rather than Git LFS pointers", () => {
  for (const file of fs
    .readdirSync("public/assets/botanical")
    .filter((f) => /\.(png|jpg)$/.test(f))) {
    const b = fs.readFileSync("public/assets/botanical/" + file);
    assert.ok(b.length > 1000, file);
    assert.ok(
      file.endsWith(".png")
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : b[0] === 255 && b[1] === 216,
      file,
    );
  }
});

test('headwaters rise into a broad valley and the downstream outlet remains open',()=>{
 const rx=z=>83+9*Math.sin(z*.025);
 // Prevent the old narrow, almost sea-level incision through the northern mountains.
 assert.ok(heightAt(rx(-500),-500)>25);
 assert.ok(Math.abs(heightAt(rx(-500)+5,-500)-heightAt(rx(-500),-500))<8);
 assert.ok(heightAt(rx(550),550)<1);
});
