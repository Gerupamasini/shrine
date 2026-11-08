import * as T from "three";
import { Library } from "../engine/library";
import { Lighting, type Quality } from "../engine/lighting";
import { atmosphereUniforms } from "../engine/atmosphere";
import type { World } from "./data";
import { Terrain } from "./terrain";

export type System = { update?(dt: number, t: number, cam: T.PerspectiveCamera): void; setQuality?(q: Quality): void; setTime?(hours: number): void };

export class Landscape {
  scene = new T.Scene();
  lib: Library;
  lighting: Lighting;
  terrain: Terrain;
  systems: System[] = [];
  quality: Quality = "standard";
  wind = { value: 0 };
  constructor(
    public renderer: T.WebGLRenderer,
    public camera: T.PerspectiveCamera,
    public world: World,
  ) {
    this.lib = new Library(renderer);
    // dummy fog object enables USE_FOG; colours come from the atmosphere uniforms
    this.scene.fog = new T.FogExp2(0x000000, 0.001);
    this.lighting = new Lighting(renderer, this.scene, camera, world.data.environment);
    this.terrain = new Terrain(this.lib, world.data, world.height);
  }
  async load(progress: (p: number, label: string) => void) {
    progress(0.05, "空と光を整えています");
    await this.lighting.init(this.quality);
    this.lib.finishers.push((m) => this.lighting.csm.setupMaterial(m));
    progress(0.15, "地形を読み込んでいます");
    await this.terrain.build(this.quality);
    this.scene.add(this.terrain.group);
    this.setTime(this.world.data.environment.defaultTime);
  }
  add(s: System) {
    this.systems.push(s);
    s.setQuality?.(this.quality);
    s.setTime?.(this.hours);
  }
  hours = 18;
  setTime(h: number) {
    this.hours = h;
    this.lighting.setTime(h);
    for (const s of this.systems) s.setTime?.(h);
  }
  setQuality(q: Quality) {
    this.quality = q;
    this.lib.setCoverage(q !== "low");
    this.lighting.setShadowQuality(q);
    for (const s of this.systems) s.setQuality?.(q);
  }
  update(dt: number, t: number) {
    this.wind.value = t;
    atmosphereUniforms.uTime.value = t;
    this.lighting.update();
    this.terrain.update(this.camera.position, this.quality);
    for (const s of this.systems) s.update?.(dt, t, this.camera);
  }
}
