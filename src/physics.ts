import RAPIER from "@dimforge/rapier3d-compat";
import * as T from "three";
import type { Terrain, WorldData } from "./world";
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
  distance = 0;
  collisions = 0;
  static async create(data: WorldData, terrain: Terrain) {
    await RAPIER.init();
    return new Walker(data, terrain);
  }
  constructor(
    public data: WorldData,
    public terrain: Terrain,
  ) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const ground = terrain.geometry();
    const v = new Float32Array(ground.attributes.position.array);
    const idx = ground.index!.array;
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(v, new Uint32Array(idx)).setFriction(0.7),
    );
    ground.dispose();
    const box = (
      x: number,
      y: number,
      z: number,
      hx: number,
      hy: number,
      hz: number,
    ) =>
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z),
      );
    // Continuous invisible ramps below tread tops avoid capsule catches on 200 risers.
    for (let flight = 0; flight < 4; flight++) {
      const z = -flight * 27,
        y = flight * 9.5;
      const vertices = new Float32Array([
        -2.7,
        y,
        z,
        2.7,
        y,
        z,
        -2.7,
        y + 9.5,
        z - 24,
        2.7,
        y + 9.5,
        z - 24,
      ]);
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          vertices,
          new Uint32Array([0, 1, 2, 1, 3, 2]),
        ),
      );
      if (flight < 3) box(0, y + 9.5 - 0.15, z - 25.5, 2.7, 0.15, 1.5);
    }
    box(0, -0.15, 2.5, 2.7, 0.15, 2.5);
    box(0, 37.85, -129, 24, 0.15, 24);
    // Physical rail at the lookout edge, without sealing the view.
    box(21, 38.55, -106, 3.5, 0.55, 0.1);
    for (const p of data.objects) {
      if (!p.collider) continue;
      const [x, y, z] = p.position,
        s = p.scale[0];
      if (p.collider.type === "cylinder") {
        this.world.createCollider(
          RAPIER.ColliderDesc.cylinder(
            8 * s,
            (p.collider.radius ?? 0.4) * s,
          ).setTranslation(x, y + 8 * s, z),
        );
      } else {
        const h = p.collider.halfExtents ?? [4, 3, 3];
        box(x, y + h[1] * s, z, h[0] * s, h[1] * s, h[2] * s);
      }
    }
    // Torii pillars; lantern bases and shrine water basin.
    for (const p of data.objects.filter((o) => o.asset === "torii"))
      for (const side of [-1, 1])
        box(
          p.position[0] + side * 3.1 * p.scale[0],
          p.position[1] + 2.7,
          p.position[2],
          0.31,
          2.7,
          0.31,
        );
    for (const p of data.objects.filter(
      (o) =>
        o.asset === "lantern" ||
        o.asset === "komainu" ||
        o.asset === "temizuya",
    ))
      box(
        p.position[0],
        p.position[1] + 1,
        p.position[2],
        p.asset === "temizuya" ? 1.4 : 0.45,
        1,
        p.asset === "temizuya" ? 0.8 : 0.45,
      );
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 12),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.3).setFriction(0),
      this.body,
    );
    this.controller = this.world.createCharacterController(0.025);
    this.controller.enableAutostep(0.32, 0.25, true);
    this.controller.enableSnapToGround(0.55);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 3);
    this.controller.setMinSlopeSlideAngle(Math.PI / 2.5);
    this.teleport(data.landmarks.foot);
    this.world.step();
  }
  teleport(p: number[]) {
    this.body.setTranslation({ x: p[0], y: p[1] - 0.8, z: p[2] }, true);
    this.body.setNextKinematicTranslation({ x: p[0], y: p[1] - 0.8, z: p[2] });
    this.position.set(p[0], p[1], p[2]);
    this.vertical = 0;
  }
  move(direction: T.Vector3, dt: number, running: boolean) {
    const before = this.body.translation();
    if (this.free) {
      const p = {
        x: before.x + direction.x * dt * 16,
        y: before.y + direction.y * dt * 16,
        z: before.z + direction.z * dt * 16,
      };
      this.body.setTranslation(p, true);
      this.body.setNextKinematicTranslation(p);
      this.position.set(p.x, p.y + 0.8, p.z);
      return;
    }
    const speed = running ? 5.4 : 2.8;
    this.vertical = Math.max(this.vertical - 19 * dt, -22);
    const movement = {
      x: direction.x * speed * dt,
      y: this.vertical * dt,
      z: direction.z * speed * dt,
    };
    this.controller.computeColliderMovement(
      this.collider,
      movement,
      undefined,
      undefined,
      (c) => c.handle !== this.collider.handle,
    );
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded) this.vertical = 0;
    this.collisions = this.controller.numComputedCollisions();
    const p = {
      x: T.MathUtils.clamp(before.x + m.x, -590, 590),
      y: before.y + m.y,
      z: T.MathUtils.clamp(before.z + m.z, -590, 590),
    };
    this.body.setNextKinematicTranslation(p);
    this.world.timestep = dt;
    this.world.step();
    this.position.set(p.x, p.y + 0.8, p.z);
    this.distance += Math.hypot(m.x, m.z);
    this.speed = Math.hypot(m.x, m.z) / dt;
    if (p.y < -12) this.teleport(this.data.landmarks.foot);
  }
}
