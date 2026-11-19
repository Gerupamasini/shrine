import { surfaceAt } from '../world/surface';
import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Landscape } from "../world/landscape";
import type { Walker } from "../physics";
import { publicUrl } from "../urls";
import { isVehicle, vehicleSpecs } from "./specs";
import { VehicleSimulation, type DriveInput } from "./simulation";

type Vehicle = { sim: VehicleSimulation; root: T.Group; high: T.Group; low: T.Group; far: T.Group; wheels: (T.Object3D | undefined)[]; lowWheels: (T.Object3D | undefined)[]; steering?: T.Object3D };

/** LOD distances: the full model beside the car, the reduced one across a yard, then a one-draw
 *  vertex-coloured shell (about 1,500 triangles); none beyond the last. */
const NEAR = 12, MID = 35, HIDE = 320;

export class VehicleFleet {
  readonly cars: Vehicle[] = [];
  active: Vehicle | null = null;
  view: "first" | "third" = "third";
  lookYaw = 0;
  lookPitch = 0;
  /** heading the chase camera follows (lags the car's, so a turn shows) and the last mouse look */
  private camYaw = 0;
  private lookIdle = 0;
  message = "";
  private snapCamera = true;
  constructor(readonly land: Landscape, readonly walker: Walker) {}
  async load() {
    const placements = this.land.world.data.objects.filter(o => isVehicle(o.asset));
    const loader = new GLTFLoader(), templates = new Map<string, [T.Group, T.Group, T.Group]>();
    const finished = new Set<T.Material>();
    await Promise.all([...new Set(placements.map(o => o.asset))].map(async id => {
      const models = await Promise.all(["", "-lod1", "-lod2"].map(suffix => loader.loadAsync(publicUrl(`assets/models/architecture/${id}${suffix}.glb`))));
      for (const g of models) g.scene.traverse(o => {
        if (!(o instanceof T.Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (!finished.has(m)) { this.land.lib.finish(m); finished.add(m); } if (m.transparent) m.depthWrite = false; });
        o.castShadow = !mats.every(m => m.transparent); o.receiveShadow = true;
      });
      templates.set(id, [models[0].scene, models[1].scene, models[2].scene]);
    }));
    for (const p of placements) {
      const sim = new VehicleSimulation(this.walker.world, p, vehicleSpecs.get(p.asset)!);
      const [a, b, c] = templates.get(p.asset)!, high = a.clone(true), low = b.clone(true), far = c.clone(true), root = new T.Group();
      root.name = `driveable/${p.id}`; root.add(high, low, far); high.visible = low.visible = false;
      const car: Vehicle = { sim, root, high, low, far, wheels: sim.wheels.map(w => high.getObjectByName(w.name)), lowWheels: sim.wheels.map(w => low.getObjectByName(w.name)), steering: high.getObjectByName("steering_wheel") };
      this.cars.push(car); this.land.scene.add(root);
    }
    this.walker.world.step();
    this.sync();
  }
  private door(car: Vehicle, side = -1) {
    return car.sim.localPoint(new T.Vector3(side * (car.sim.spec.width / 2 + .55), 1.1, car.sim.spec.frontAxle - .35));
  }
  nearest() {
    if (this.walker.free || this.active) return null;
    return this.cars.filter(car => {
      const door = this.door(car);
      if (door.distanceTo(this.walker.position) > 2.8) return false;
      const ray = door.clone().sub(this.walker.position), distance = ray.length();
      const hit = this.walker.world.castRay(new RAPIER.Ray(this.walker.position, ray.normalize()), distance, true,
        undefined, undefined, this.walker.collider, car.sim.body);
      return !hit;
    }).sort((a, b) => this.door(a).distanceToSquared(this.walker.position) - this.door(b).distanceToSquared(this.walker.position))[0] ?? null;
  }
  enter(car = this.nearest()) {
    if (!car || this.active || this.walker.free) return false;
    this.active = car; car.sim.enter(); this.walker.body.setEnabled(false);
    this.lookYaw = this.lookPitch = 0; this.snapCamera = true; this.message = "";
    this.sync(); return true;
  }
  /** Candidate exits must have walkable ground and an empty full-height capsule. */
  exitPoint(car: Vehicle) {
    for (const [side, z] of [[-1, .6], [1, .6], [-1, -.6], [1, -.6]]) {
      const p = car.sim.localPoint(new T.Vector3(side * (car.sim.spec.width / 2 + .8), 2.5, z));
      const hit = this.walker.world.castRayAndGetNormal(new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }), 5, true,
        undefined, undefined, this.walker.collider, car.sim.body);
      if (!hit || hit.normal.y < .65) continue;
      const ground = p.y - hit.timeOfImpact;
      const blocked = this.walker.world.intersectionWithShape({ x: p.x, y: ground + .90, z: p.z }, { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Capsule(.55, .30), undefined, undefined, this.walker.collider);
      if (!blocked) return new T.Vector3(p.x, ground + 1.66, p.z);
    }
    return null;
  }
  exit() {
    const car = this.active;
    if (!car) return false;
    if (car.sim.body.linvel().x ** 2 + car.sim.body.linvel().z ** 2 > .8 ** 2) { this.message = "停車してから E で降りる"; return false; }
    const p = this.exitPoint(car);
    if (!p) { this.message = "降りる場所がありません。少し移動してください"; return false; }
    car.sim.park(); this.active = null; this.walker.body.setEnabled(true); this.walker.teleport(p.toArray());
    this.message = ""; this.sync(); return true;
  }
  /** Settings/map travel leaves the vehicle parked at its current location. */
  leaveForTravel() {
    if (!this.active) return;
    this.active.sim.park(); this.active = null; this.walker.body.setEnabled(true); this.message = "";
  }
  visitNearest() {
    this.leaveForTravel();
    const cars = [...this.cars].sort((a, b) => a.sim.position.distanceToSquared(this.walker.position) - b.sim.position.distanceToSquared(this.walker.position));
    for (const car of cars) { const p = this.exitPoint(car); if (p) { this.walker.teleport(p.toArray()); return car; } }
    return null;
  }
  toggleView() { this.view = this.view === "third" ? "first" : "third"; this.lookYaw = this.lookPitch = 0; this.snapCamera = true; }
  look(dx: number, dy: number) {
    this.lookIdle = 0;
    this.lookYaw = T.MathUtils.clamp(this.lookYaw - dx * .0018, -2.3, 2.3);
    this.lookPitch = T.MathUtils.clamp(this.lookPitch - dy * .0018, -.7, .65);
  }
  reset() { if (this.active) { this.active.sim.reset(); this.snapCamera = true; this.message = ""; this.sync(); } }
  step(dt: number, input: DriveInput) {
    if (!this.active) return;
    const previous = this.active.sim.position;
    const ground = surfaceAt(this.land.world.data, this.active.sim.position.x, this.active.sim.position.z);
    this.active.sim.beforeStep(dt, input, this.walker.collider, ground);
    // (the tree trunks around the car are the ones in the physics world while it is driven)
    this.walker.streamTrunks(this.active.sim.position.x, this.active.sim.position.z);
    this.walker.world.timestep = dt; this.walker.world.step();
    const p = this.active.sim.position, half = this.land.world.data.extent / 2 - 3;
    this.active.sim.distance += Math.hypot(p.x - previous.x, p.z - previous.z);
    if (Math.abs(p.x) > half || Math.abs(p.z) > half || p.y < -40) this.reset();
    this.sync();
  }
  sync() {
    for (const car of this.cars) {
      const s = car.sim; car.root.position.copy(s.position); car.root.quaternion.copy(s.rotation);
      if (s.hasDriven) {
        car.wheels.forEach((wheel, i) => {
          if (!wheel) return;
          wheel.position.y = s.spec.radius + s.spec.suspension - (s.controller.wheelSuspensionLength(i) ?? s.spec.suspension);
          wheel.quaternion.setFromAxisAngle(T.Object3D.DEFAULT_UP, i < 2 ? s.steering : 0)
            .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(-1, 0, 0), s.controller.wheelRotation(i) ?? 0));
          car.lowWheels[i]?.position.copy(wheel.position);
          car.lowWheels[i]?.quaternion.copy(wheel.quaternion);
        });
        if (car.steering) car.steering.rotation.z = -s.steering * 3;
      }
      const d2 = car === this.active ? 0 : car.root.position.distanceToSquared(this.land.camera.position);
      car.high.visible = d2 < NEAR ** 2; car.low.visible = d2 >= NEAR ** 2 && d2 < MID ** 2; car.far.visible = d2 >= MID ** 2;
      car.root.visible = d2 < HIDE ** 2;
    }
    if (this.active) {
      this.walker.position.copy(this.active.sim.localPoint(new T.Vector3(...this.active.sim.spec.eye)));
      this.walker.speed = 0; this.walker.grounded = false;
    }
  }
  updateCamera(camera: T.PerspectiveCamera, dt: number) {
    const car = this.active;
    if (!car) { if (camera.fov !== 55) { camera.fov = 55; camera.near = .1; camera.updateProjectionMatrix(); } return false; }
    const speed = Math.abs(car.sim.speed), fast = Math.min(speed, 22) / 22;
    // a little wider at speed, so the road ahead and its edges stay in view
    const fov = Math.round(((this.view === "first" ? 68 : 60) + fast * 6) * 4) / 4;
    if (camera.fov !== fov) { camera.fov = fov; camera.near = .04; camera.updateProjectionMatrix(); }
    // the look recentres by itself once the mouse has been still for a moment while driving
    this.lookIdle += dt;
    if (this.lookIdle > 1.2 && speed > 3) { const k = Math.exp(-1.6 * dt); this.lookYaw *= k; this.lookPitch *= k; }
    if (this.view === "first") {
      camera.position.copy(this.walker.position);
      camera.quaternion.copy(car.sim.rotation).multiply(new T.Quaternion().setFromEuler(new T.Euler(this.lookPitch, Math.PI + this.lookYaw, 0, "YXZ")));
    } else {
      // Chase camera on the car's heading only (its pitch and roll on a bumpy track do not swing the
      // view), lagging it a little through a turn; further back and looking further ahead at speed.
      const fwd = new T.Vector3(0, 0, 1).applyQuaternion(car.sim.rotation).setY(0).normalize();
      const heading = Math.atan2(fwd.x, fwd.z);
      if (this.snapCamera || dt === 0) this.camYaw = heading;
      else {
        const d = Math.atan2(Math.sin(heading - this.camYaw), Math.cos(heading - this.camYaw));
        this.camYaw += d * (1 - Math.exp(-3.5 * dt));
      }
      const target = car.sim.position.clone().add(new T.Vector3(0, 1.05, 0)).addScaledVector(fwd, .35 + fast * 2.5);
      const offset = new T.Vector3(0, 2.1 + fast * .5 + this.lookPitch * 3, -(6.3 + fast * 1.6)).applyAxisAngle(T.Object3D.DEFAULT_UP, this.camYaw + this.lookYaw);
      const len = offset.length(), direction = offset.clone().normalize();
      const hit = this.walker.world.castShape(target, { x: 0, y: 0, z: 0, w: 1 }, direction, new RAPIER.Ball(.20), 0, len, true,
        undefined, undefined, this.walker.collider, car.sim.body);
      const desired = target.clone().addScaledVector(direction, hit ? Math.max(.25, hit.time_of_impact - .15) : len);
      camera.position.lerp(desired, this.snapCamera || dt === 0 ? 1 : 1 - Math.exp(-10 * dt));
      camera.lookAt(target);
    }
    this.snapCamera = false; return true;
  }
  get state() {
    return { active: this.active?.sim.placement.id ?? null, view: this.view, speed: this.active?.sim.speed ?? 0,
      steering: this.active?.sim.steering ?? 0, position: this.active?.sim.position.toArray() ?? null,
      cars: this.cars.map(c => ({ id: c.sim.placement.id, model: c.sim.spec.id, position: c.sim.position.toArray(), wheels: c.wheels.filter(Boolean).length })) };
  }
}
