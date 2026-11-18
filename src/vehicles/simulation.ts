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
  /** smoothed driver input: a key press winds the wheel on over a fraction of a second and it
   *  comes back to centre when released (analog input follows almost directly) */
  steerInput = 0;
  throttleInput = 0;
  /** seconds spent on the side or the roof (the car is set back on its wheels after a moment) */
  tipped = 0;
  braking = true;
  occupied = false;
  hasDriven = false;
  distance = 0;
  constructor(readonly world: RAPIER.World, readonly placement: Placement, readonly spec: VehicleSpec) {
    this.home = new T.Vector3(...placement.position).add(new T.Vector3(0, spec.centerHeight, 0));
    this.homeRotation = new T.Quaternion().setFromAxisAngle(T.Object3D.DEFAULT_UP, placement.rotation[1]);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.home.x, this.home.y, this.home.z).setRotation(this.homeRotation)
      // (light damping: the resistance that grows with speed is the taper on the engine below)
      .setLinearDamping(.05).setAngularDamping(1.1).setCcdEnabled(true)
      // (a car at rest under its brakes must not fall asleep: the wheel forces would not wake it)
      .setCanSleep(false)
      // (the mass sits low, as in a real car with its engine and frame under the floor: a centre of
      // mass at the body origin, 0.6-0.7 m up, rolled the narrow kei cars over on a kerb)
      .setAdditionalMassProperties(spec.mass, { x: 0, y: -0.18, z: 0 }, {
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
    this.steering = this.steerInput = this.throttleInput = 0;
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  /** Back on its wheels where it lies, facing the way it was heading. */
  rightInPlace() {
    const f = new T.Vector3(0, 0, 1).applyQuaternion(this.rotation);
    const yaw = Math.atan2(f.x, f.z), p = this.body.translation();
    this.body.setTranslation({ x: p.x, y: p.y + 0.9, z: p.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.tipped = 0;
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  /** top speed: 70 km/h for the kei cars, 80 for the others */
  get topSpeed() { return this.spec.mass < 1000 ? 19.4 : 22.2; }
  beforeStep(dt: number, input: DriveInput, walkerCollider: RAPIER.Collider, surface: 'asphalt' | 'gravel' | 'grass' = 'asphalt') {
    const speed = this.speed;
    // Steering input: a key winds the wheel on at 3.5 units/s and lets it back at 6/s (a tap is a
    // small correction, holding it a full turn); analog input passes almost straight through.
    const digital = Math.abs(input.steer) === 1 || input.steer === 0;
    const toward = Math.abs(input.steer) > Math.abs(this.steerInput) && Math.sign(input.steer) !== -Math.sign(this.steerInput) ? 3.5 : 6;
    this.steerInput = digital ? approach(this.steerInput, input.steer, toward * dt) : T.MathUtils.damp(this.steerInput, input.steer, 14, dt);
    this.throttleInput = approach(this.throttleInput, input.throttle, (Math.abs(input.throttle) > Math.abs(this.throttleInput) ? 2.6 : 6) * dt);
    // The lock is limited by the sideways grip the speed allows (about 0.5 g): full lock in a yard,
    // a few degrees on the prefectural road, so a held key cannot throw the car into a spin.
    const v2 = Math.max(speed * speed, 1);
    const limit = Math.min(.58, Math.atan(this.spec.wheelbase * 5.2 / v2));
    // Input +1 is the driver's right. Vehicles face local +Z, so a right
    // turn is negative rotation about +Y (positive rotation turns left).
    this.steering = T.MathUtils.damp(this.steering, -this.steerInput * limit, 9, dt);
    const changingDirection = Math.abs(speed) > .45 && input.throttle * speed < 0;
    this.braking = input.brake || changingDirection;
    const capped = input.throttle > 0 ? speed > this.topSpeed : speed < -4.2;
    // power falls off towards the top speed (no surge at the end of a straight)
    const taper = input.throttle > 0 ? T.MathUtils.clamp(1.15 - speed / this.topSpeed, .3, 1) : 1;
    // Stability: the yaw rate the wheels ask for, against the one the body has. A slide (the body
    // turning faster than the wheels steer, or the other way) is damped with a torque about the
    // vertical and the engine is eased off until the tyres grip again.
    const w = this.body.angvel(), up = new T.Vector3(0, 1, 0).applyQuaternion(this.rotation);
    const wanted = speed * Math.tan(this.steering) / this.spec.wheelbase;
    const slide = w.y - wanted;
    const iy = this.spec.mass * (this.spec.length ** 2 + this.spec.width ** 2) / 12;
    if (Math.abs(speed) > 2 && up.y > .7) this.body.applyTorqueImpulse({ x: 0, y: -slide * iy * 4.0 * dt, z: 0 }, true);
    const grip = T.MathUtils.clamp(1.4 - Math.abs(slide) * 1.6, .35, 1);
    // and the roll (an anti-roll bar): past ~5 degrees the body is pushed back towards its wheels,
    // and its rocking is damped (soft springs let a tall kei truck lean 20 degrees in a hard turn)
    const lean = Math.acos(T.MathUtils.clamp(up.y, -1, 1));
    if (lean > .08 && lean < 1.4) {
      const axis = new T.Vector3(0, 1, 0).cross(up).normalize().multiplyScalar(-(lean - .08) * this.spec.mass * 9 * dt);
      this.body.applyTorqueImpulse({ x: axis.x, y: 0, z: axis.z }, true);
    }
    if (up.y > .5) {
      const ir = this.spec.mass * (this.spec.width ** 2 + this.spec.height ** 2) / 12;
      this.body.applyTorqueImpulse({ x: -w.x * ir * 3 * dt, y: 0, z: -w.z * ir * 3 * dt }, true);
    }
    // on its side or roof and nearly still for a moment: set it back on its wheels
    this.tipped = up.y < .45 && Math.abs(speed) < 2.5 ? this.tipped + dt : 0;
    if (this.tipped > 1.2) this.rightInPlace();
    const pull = this.throttleInput > 0 ? (this.spec.mass < 1000 ? 2.3 : 2.6) : 1.65;     // m/s² at low speed
    const force = this.braking || capped ? 0 : this.throttleInput * this.spec.mass * pull * taper * grip;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelFrictionSlip(i, surface === 'asphalt' ? 2.8 : surface === 'gravel' ? 2.2 : 1.8);
      this.controller.setWheelSteering(i, i < 2 ? this.steering : 0);
      this.controller.setWheelEngineForce(i, i >= 2 ? force : 0);
      this.controller.setWheelBrake(i, this.braking ? 100 : input.throttle === 0 ? (surface === 'asphalt' ? 6 : surface === 'gravel' ? 9 : 14) : (surface === 'grass' ? 3 : 0));
    }
    this.controller.updateVehicle(dt, undefined, undefined, c => c.parent()?.handle !== this.body.handle && c.handle !== walkerCollider.handle);
  }
}

function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
