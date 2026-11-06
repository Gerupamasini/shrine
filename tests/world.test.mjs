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
test('trees leave the village road, river and farm houses clear',()=>{const trees=data.objects.filter(o=>o.asset.startsWith('cedar')||o.asset==='broadleaf');for(const t of trees){const [x,,z]=t.position;if(z>=12&&z<=365)assert.ok(Math.abs(x-(-32+18*Math.sin(z*.015)))>=5);if(z>=-15&&z<=370)assert.ok(Math.abs(x-(83+9*Math.sin(z*.025)))>=6);for(const h of data.objects.filter(o=>o.collider?.type==='box')){const e=h.collider.halfExtents,s=h.scale[0];assert.ok(Math.abs(x-h.position[0])>=e[0]*s+2.5||Math.abs(z-h.position[2])>=e[2]*s+2.5)}}});
