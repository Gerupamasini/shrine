import RAPIER from "@dimforge/rapier3d-compat";
import * as T from "three";
import type { Placement } from "../world/data";
import type { VehicleSpec } from "./specs";

export type DriveInput = { throttle: number; steer: number; brake: boolean };
export const REST_INPUT: DriveInput = { throttle: 0, steer: 0, brake: true };

/** Physics owns position, speed, suspension and steering; rendering reads this state. */
export class VehicleSimulation {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly home: T.Vector3;
  readonly homeRotation: T.Quaternion;
  readonly wheels: { name: string; x: number; z: number }[] = [];
  steering = 0;
  braking = true;
  occupied = false;
  hasDriven = false;
  distance = 0;
  constructor(readonly world: RAPIER.World, readonly placement: Placement, readonly spec: VehicleSpec) {
    this.home = new T.Vector3(...placement.position).add(new T.Vector3(0, spec.centerHeight, 0));
    this.homeRotation = new T.Quaternion().setFromAxisAngle(T.Object3D.DEFAULT_UP, placement.rotation[1]);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.home.x, this.home.y, this.home.z).setRotation(this.homeRotation)
      .setLinearDamping(.16).setAngularDamping(1.1).setCcdEnabled(true)
      .setAdditionalMassProperties(spec.mass, { x: 0, y: 0, z: 0 }, {
        x: spec.mass * (spec.length ** 2 + spec.height ** 2) / 12,
        y: spec.mass * (spec.length ** 2 + spec.width ** 2) / 12,
        z: spec.mass * (spec.width ** 2 + spec.height ** 2) / 12,
      }, { x: 0, y: 0, z: 0, w: 1 }));
    // Separate underbody and cab proxies allow the empty bed to remain empty.
    world.createCollider(RAPIER.ColliderDesc.cuboid(spec.width / 2 - .035, .18, spec.length / 2)
      .setTranslation(0, .50 - spec.centerHeight, 0).setDensity(0).setFriction(.65), this.body);
    const cabBack = spec.id === "kei-truck" ? .32 : -.8;
    world.createCollider(RAPIER.ColliderDesc.cuboid(spec.width / 2 - .07, (spec.height - .70) / 2, (spec.length / 2 - cabBack - .15) / 2)
      .setTranslation(0, (spec.height + .70) / 2 - spec.centerHeight, (spec.length / 2 + cabBack - .15) / 2)
      .setDensity(0).setFriction(.5), this.body);
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    for (const [axle, z] of [["f", spec.frontAxle], ["r", spec.frontAxle - spec.wheelbase]] as const) {
      for (const [side, sign] of [["l", 1], ["r", -1]] as const) {
        const i = this.wheels.length, x = sign * spec.track / 2;
        this.wheels.push({ name: `wheel_${axle}${side}`, x, z });
        this.controller.addWheel({ x, y: spec.radius + spec.suspension - spec.centerHeight, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspension, spec.radius);
        this.controller.setWheelSuspensionStiffness(i, 35);
        this.controller.setWheelSuspensionCompression(i, 4.4);
        this.controller.setWheelSuspensionRelaxation(i, 4.5);
        this.controller.setWheelMaxSuspensionTravel(i, .14);
        this.controller.setWheelMaxSuspensionForce(i, 18000);
        this.controller.setWheelFrictionSlip(i, 2.8);
        this.controller.setWheelSideFrictionStiffness(i, 1.8);
      }
    }
  }
  get rotation() { const q = this.body.rotation(); return new T.Quaternion(q.x, q.y, q.z, q.w); }
  get position() {
    const p = this.body.translation();
    return new T.Vector3(p.x, p.y, p.z).sub(new T.Vector3(0, this.spec.centerHeight, 0).applyQuaternion(this.rotation));
  }
  get speed() {
    const v = this.body.linvel(), forward = new T.Vector3(0, 0, 1).applyQuaternion(this.rotation);
    return v.x * forward.x + v.y * forward.y + v.z * forward.z;
  }
  localPoint(p: T.Vector3) { return p.applyQuaternion(this.rotation).add(this.position); }
  enter() {
    this.occupied = true;
    this.hasDriven = true;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  park() {
    this.occupied = false;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    this.braking = true;
  }
  reset() {
    this.body.setTranslation(this.home, true);
    this.body.setRotation(this.homeRotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steering = 0;
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  beforeStep(dt: number, input: DriveInput, walkerCollider: RAPIER.Collider) {
    const speed = this.speed;
    // Reduce steering at speed to keep lateral acceleration manageable on narrow village roads.
    const limit = Math.min(.56, Math.atan(4 * this.spec.wheelbase / (speed * speed + 1)));
    this.steering = T.MathUtils.damp(this.steering, input.steer * limit, 7, dt);
    const changingDirection = Math.abs(speed) > .45 && input.throttle * speed < 0;
    this.braking = input.brake || changingDirection;
    const capped = input.throttle > 0 ? speed > 16.7 : speed < -4.2;
    const force = this.braking || capped ? 0 : input.throttle * this.spec.mass * 1.65;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, i < 2 ? this.steering : 0);
      this.controller.setWheelEngineForce(i, i >= 2 ? force : 0);
      this.controller.setWheelBrake(i, this.braking ? 100 : input.throttle === 0 ? 6 : 0);
    }
    this.controller.updateVehicle(dt, undefined, undefined, c => c.parent()?.handle !== this.body.handle && c.handle !== walkerCollider.handle);
  }
}
