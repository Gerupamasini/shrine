import RAPIER from "@dimforge/rapier3d-compat";
import * as T from "three";
import type { World } from "./world/data";
import { isVehicle } from "./vehicles/specs";

const EYE = 1.62;
/** tree-trunk colliders: cell size (m) and the cells kept on every side of the walker or the car */
const TRUNK_CELL = 32, TRUNK_REACH = 3;
const HALF = 0.55, RADIUS = 0.3; // capsule: total 1.7 m

/**
 * First-person walker: kinematic capsule against the 16-bit heightfield, a
 * continuous ramp collider under each stair flight (so 200 risers never snag the
 * capsule), building/torii/lantern boxes and tree trunk cylinders.
 */
export class Walker {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  position = new T.Vector3();
  vertical = 0;
  grounded = false;
  free = false;
  speed = 0;
  bob = 0;
  /** horizontal velocity (m/s): kept through a jump so a running jump carries its momentum */
  vel = new T.Vector2();
  /** camera dip on landing, decays to 0 */
  landing = 0;
  private jumpBuffer = 0;
  private airTime = 0;
  private ascending = false;
  /** request a jump; honoured on the ground, shortly after leaving an edge, or on landing */
  jump() {
    this.jumpBuffer = 0.15;
  }
  static async create(w: World) {
    await RAPIER.init();
    return new Walker(w);
  }
  constructor(public w: World) {
    const { data, height } = w;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const n = height.n;
    const hf = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hf[i * n + j] = height.data[j * n + i];
    this.world.createCollider(RAPIER.ColliderDesc.heightfield(n - 1, n - 1, hf, { x: data.extent, y: 1, z: data.extent }).setFriction(0.8));
    const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0) =>
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      );
    // Stair ramps: plane through the step nosings of each flight + flat landings.
    const st = data.stair;
    const per = st.flight * st.tread + st.landing;
    for (let f = 0; f < 4; f++) {
      const x0 = st.x0 + f * per, x1 = x0 + st.flight * st.tread;
      const y0 = st.footY + f * st.flight * st.rise, y1 = y0 + st.flight * st.rise;
      const hw = st.width / 2;
      const v = new Float32Array([x0, y0 + 0.02, st.z - hw, x0, y0 + 0.02, st.z + hw, x1, y1 + 0.02, st.z - hw, x1, y1 + 0.02, st.z + hw]);
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(v, new Uint32Array([0, 1, 2, 1, 3, 2])));
      if (f < 3) box(x1 + st.landing / 2, y1 - 0.2, st.z, st.landing / 2 + 0.05, 0.2, hw);
      // side curbs keep walkers on the stair
      for (const s of [-1, 1]) {
        const len = Math.hypot(x1 - x0, y1 - y0) / 2;
        const ang = Math.atan2(y1 - y0, x1 - x0);
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(len, 0.35, 0.18)
            .setTranslation((x0 + x1) / 2, (y0 + y1) / 2 + 0.3, st.z + s * (hw + 0.2))
            .setRotation({ x: 0, y: 0, z: Math.sin(ang / 2), w: Math.cos(ang / 2) }),
        );
      }
    }
    // Precinct floor & stone forecourt.
    const p = data.precinct;
    box((p.x0 + p.x1) / 2, p.y - 0.25, (p.z0 + p.z1) / 2, (p.x1 - p.x0) / 2, 0.25, (p.z1 - p.z0) / 2);
    box((96 + st.x0) / 2, st.footY - 0.21, st.z, (st.x0 - 96) / 2, 0.25, 4.5);
    for (const o of data.objects) {
      if (isVehicle(o.asset)) continue; // the fleet creates colliders attached to each movable body
      const c = o.collider;
      if (!c) continue;
      const [x, y, z] = o.position, s = o.scale[0], yaw = o.rotation[1];
      if (c.type === "cylinder") {
        const hh = (c.height ?? 8) / 2;
        this.world.createCollider(RAPIER.ColliderDesc.cylinder(hh * s, (c.radius ?? 0.3) * s).setTranslation(x, y + hh * s, z));
      } else {
        const h = c.halfExtents ?? [1, 1, 1];
        box(x, y + h[1] * s, z, h[0] * s, h[1] * s, h[2] * s, yaw);
        // L-shaped farmhouse wing (magariya): local offset rotated by the house yaw
        const wing = o.wing as { offset: number[]; halfExtents: number[] } | undefined;
        if (wing) {
          const [ox, oz] = wing.offset, cs = Math.cos(yaw), sn = Math.sin(yaw);
          box(x + ox * cs + oz * sn, y + wing.halfExtents[1], z - ox * sn + oz * cs, wing.halfExtents[0], wing.halfExtents[1], wing.halfExtents[2], yaw);
        }
      }
      if (o.asset === "bridge") {
        // parapets along both edges of the deck (deck top = object y + 0.4)
        const span = (o.span as number) ?? 12, wd = (o.width as number) ?? 3.2;
        for (const side of [-1, 1]) box(x, y + 0.4 + 0.35, z + side * (wd / 2 - 0.1), span / 2, 0.35, 0.12, yaw);
      }
      if (o.asset === "road-bridge") {
        // low parapets along both sides of the road over the brook (deck top = object y + 0.5)
        const span = (o.span as number) ?? 3.5, wd = (o.width as number) ?? 9.4, cs = Math.cos(yaw), sn = Math.sin(yaw);
        for (const side of [-1, 1]) {
          const ox = side * (wd / 2 - 0.12);
          box(x + ox * cs, y + 0.5 + 0.35, z - ox * sn, 0.12, 0.35, span / 2 + 0.3, yaw);
        }
      }
      if (o.asset.startsWith("torii"))
        for (const side of [-1, 1]) {
          const off = 2.55 * s * side;
          box(x + Math.sin(yaw + Math.PI / 2) * off, y + 2.5, z + Math.cos(yaw + Math.PI / 2) * off, 0.32 * s, 2.5, 0.32 * s);
        }
    }
    // River revetments: the ground under a masonry wall and its cap is sunk out of sight (the
    // heightfield cannot hold a 1:0.4 wall), so each wall gets box colliders with their top flush
    // with the bank; earth banks and the washing-step ramps are ordinary terrain.
    {
      const rb = data.river.bed, rp = rb.points, w = rb.wallRun + rb.capWidth;
      const gaps = data.river.washSteps.map((s) => [s.z - 0.85, s.z + 0.85]);
      for (let i = 0; i < rp.length - 1; i++) {
        const a = rp[i], b = rp[i + 1];
        for (const [side, ei, ti] of [[-1, 6, 4], [1, 7, 5]] as const) {
          if (a[ei] >= 0.5 || b[ei] >= 0.5) continue;
          // pieces of this segment outside the washing-step openings (east bank only)
          let pieces: [number, number][] = [[0, 1]];
          if (side > 0)
            for (const [g0, g1] of gaps) {
              const t0 = (g0 - a[1]) / (b[1] - a[1]), t1 = (g1 - a[1]) / (b[1] - a[1]);
              pieces = pieces.flatMap(([p0, p1]) => [[p0, Math.min(p1, t0)], [Math.max(p0, t1), p1]] as [number, number][]).filter(([p0, p1]) => p1 - p0 > 0.03);
            }
          for (const [p0, p1] of pieces) {
            const at = (t: number) => ({ x: a[0] + (b[0] - a[0]) * t + side * (a[2] + (b[2] - a[2]) * t + w / 2), z: a[1] + (b[1] - a[1]) * t });
            const q0 = at(p0), q1 = at(p1);
            const top = (a[3] + b[3]) / 2 + 0.02, low = Math.min(a[ti], b[ti]) - 0.4;
            const len = Math.hypot(q1.x - q0.x, q1.z - q0.z);
            box((q0.x + q1.x) / 2, (top + low) / 2, (q0.z + q1.z) / 2, w / 2, (top - low) / 2, len / 2 + 0.02, Math.atan2(q1.x - q0.x, q1.z - q0.z));
          }
        }
      }
    }
    // Lookout fence (low rail, the view stays open).
    const lk = data.landmarks.lookout;
    box(lk[0] - 4, p.y + 0.5, lk[2] + 4.5, 7, 0.5, 0.08, Math.PI / 4);
    // Tree trunks, every tree: radius at eye height measured from the tree models (scale 1), so
    // the walker cannot step into a trunk and see it from inside. Listed per 32 m cell and only
    // those around the walker (or the car being driven) are in the physics world, see streamTrunks.
    const TRUNK: Record<string, number> = { sugi: 0.38, hinoki: 0.34, akamatsu: 0.34, broadleaf: 0.3, keyaki: 0.46, bamboo: 0.06 };
    for (const [kind, rows] of Object.entries(w.trees)) {
      const r = TRUNK[kind] ?? 0.3;
      for (const t of rows) {
        const [x, y, z, sc] = t;
        const key = Walker.cell(Math.floor(x / TRUNK_CELL), Math.floor(z / TRUNK_CELL));
        let c = this.trunks.get(key);
        if (!c) this.trunks.set(key, (c = { rows: [], colliders: null }));
        c.rows.push(x, y, z, r * sc);
      }
    }
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 10, 0));
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setFriction(0), this.body);
    this.controller = this.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.35, 0.2, true);
    this.controller.enableSnapToGround(0.5);
    this.controller.setMaxSlopeClimbAngle(T.MathUtils.degToRad(48));
    this.controller.setMinSlopeSlideAngle(T.MathUtils.degToRad(55));
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.teleport(data.landmarks.foot);
    this.world.step();
  }
  /** tree trunks by 32 m cell; `colliders` while the cell is in the physics world */
  private trunks = new Map<number, { rows: number[]; colliders: RAPIER.Collider[] | null }>();
  private trunkAt = { i: 1e9, j: 1e9 };
  private static cell(i: number, j: number) {
    return (j + 1024) * 2048 + i + 1024;
  }
  /**
   * Keep the trunk colliders of the cells around (x, z) - TRUNK_REACH cells on every side (at least
   * 96 m) - in the physics world and drop those further away. Every step of the world cost time in
   * proportion to all its colliders: with all 120,000 trunks it was ~11 ms a step (Node, this
   * container), with the trunks around the walker ~0.1 ms. Called before every step with the walker
   * or the active car; colliders near it are exactly the ones they always were.
   */
  streamTrunks(x: number, z: number) {
    const ci = Math.floor(x / TRUNK_CELL), cj = Math.floor(z / TRUNK_CELL);
    if (ci === this.trunkAt.i && cj === this.trunkAt.j) return;
    this.trunkAt = { i: ci, j: cj };
    for (let j = cj - TRUNK_REACH; j <= cj + TRUNK_REACH; j++)
      for (let i = ci - TRUNK_REACH; i <= ci + TRUNK_REACH; i++) {
        const c = this.trunks.get(Walker.cell(i, j));
        if (!c || c.colliders) continue;
        c.colliders = [];
        for (let k = 0; k < c.rows.length; k += 4) {
          const [tx, ty, tz, r] = [c.rows[k], c.rows[k + 1], c.rows[k + 2], c.rows[k + 3]];
          c.colliders.push(this.world.createCollider(RAPIER.ColliderDesc.cylinder(3, r).setTranslation(tx, ty + 3, tz)));
        }
      }
    // (one cell of slack before a cell is dropped: no add/remove churn on a cell border)
    for (const [key, c] of this.trunks) {
      if (!c.colliders) continue;
      const i = (key % 2048) - 1024, j = Math.floor(key / 2048) - 1024;
      if (Math.abs(i - ci) <= TRUNK_REACH + 1 && Math.abs(j - cj) <= TRUNK_REACH + 1) continue;
      for (const col of c.colliders) this.world.removeCollider(col, false);
      c.colliders = null;
    }
  }
  /** trunk colliders in the physics world now (for the profile and the tests) */
  get trunkColliders() {
    let n = 0;
    for (const c of this.trunks.values()) n += c.colliders?.length ?? 0;
    return n;
  }
  /** p = [x, eyeY, z, ...] */
  teleport(p: number[]) {
    this.streamTrunks(p[0], p[2]);
    const ground = this.w.height.sample(p[0], p[2]);
    const y = Math.max(p[1] - EYE, ground) + HALF + RADIUS + 0.02;
    this.body.setTranslation({ x: p[0], y, z: p[2] }, true);
    this.body.setNextKinematicTranslation({ x: p[0], y, z: p[2] });
    this.position.set(p[0], y - HALF - RADIUS + EYE, p[2]);
    this.vertical = 0;
    this.vel.set(0, 0);
    this.world.step();
  }
  move(dir: T.Vector3, dt: number, run: boolean) {
    const b = this.body.translation();
    if (this.free) {
      const v = run ? 40 : 12;
      const p = { x: b.x + dir.x * v * dt, y: b.y + dir.y * v * dt, z: b.z + dir.z * v * dt };
      this.body.setTranslation(p, true);
      this.body.setNextKinematicTranslation(p);
      this.position.set(p.x, p.y - HALF - RADIUS + EYE, p.z);
      return;
    }
    const speed = run ? 7.8 : 1.45;
    // ground: responsive acceleration; air: momentum with a little steering
    const accel = this.grounded ? 12 : 1.6;
    const k = Math.min(1, accel * dt);
    this.vel.x += (dir.x * speed - this.vel.x) * k;
    this.vel.y += (dir.z * speed - this.vel.y) * k;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    if (this.jumpBuffer > 0 && (this.grounded || this.airTime < 0.12) && !this.ascending) {
      // ~0.95 m apex; running jumps clear about 6.5 m
      this.vertical = 4.3;
      this.ascending = true;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.controller.disableSnapToGround();
    }
    if (this.grounded && !this.ascending) this.vertical = -0.5;
    else this.vertical = Math.max(this.vertical - 9.81 * dt, -30);
    if (this.ascending && this.vertical <= 0) this.ascending = false;
    const fallSpeed = -this.vertical;
    const desired = { x: this.vel.x * dt, y: this.vertical * dt, z: this.vel.y * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, undefined, (c) => c.handle !== this.collider.handle);
    const m = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded() && !this.ascending;
    if (this.grounded) {
      if (!wasGrounded) {
        this.landing = Math.min(1, Math.max(0, fallSpeed - 1.5) / 5);
        this.controller.enableSnapToGround(0.5);
      }
    } else if (this.ascending && m.y < this.vertical * dt * 0.5) {
      this.vertical = Math.min(this.vertical, 0); // bumped the head (eaves, branches)
    }
    this.landing = Math.max(0, this.landing - dt * 3.5);
    const half = this.w.data.extent / 2 - 2;
    const p = { x: T.MathUtils.clamp(b.x + m.x, -half, half), y: b.y + m.y, z: T.MathUtils.clamp(b.z + m.z, -half, half) };
    // never sink below the heightfield (fast falls, teleports)
    const g = this.w.height.sample(p.x, p.z) + HALF + RADIUS;
    if (p.y < g - 0.6) p.y = g;
    this.body.setNextKinematicTranslation(p);
    this.streamTrunks(p.x, p.z);
    this.world.timestep = dt;
    this.world.step();
    const horiz = Math.hypot(m.x, m.z) / dt;
    this.speed = horiz;
    this.bob += horiz * dt * 1.9;
    this.position.set(p.x, p.y - HALF - RADIUS + EYE, p.z);
  }
}
