import "./style.css";
import * as T from "three";
import { installAtmosphere } from "./engine/atmosphere";
import { Post } from "./engine/post";
import type { Quality } from "./engine/lighting";
import { loadWorld } from "./world/data";
import { Landscape } from "./world/landscape";
import { populate } from "./world/populate";
import { Walker } from "./physics";
import { Soundscape } from "./audio";
import { VillageMap } from "./map";
import { VehicleFleet } from "./vehicles/fleet";
import { DrivingHud } from "./vehicles/hud";

installAtmosphere();
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const canvas = $<HTMLCanvasElement>("world");
const enter = $<HTMLButtonElement>("enter");
enter.disabled = true;
const params = new URLSearchParams(location.search);
let quality = (params.get("quality") as Quality) || "standard";
const camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 9000);
camera.rotation.order = "YXZ";
const audio = new Soundscape();
let renderer: T.WebGLRenderer, land: Landscape, walker: Walker, post: Post;
let vehicles: VehicleFleet;
let yaw = Math.PI / 2, pitch = 0, started = false, locked = false, settingsOpen = false, mapOpen = false, ready = false;
/** the walk is on hold while the settings panel or the map sheet is open */
const paused = () => settingsOpen || mapOpen;
let villageMap: VillageMap | null = null;
let elapsed = 0, fps = 0, frames = 0, measure = 0, acc = 0, timeOfDay = 18;
const keys = new Set<string>();
const drivingHud = new DrivingHud($("vehicle-hud"));

function fail(e: unknown) {
  console.error(e);
  $("error").hidden = false;
  $("error").textContent = "風景を開始できませんでした。" + (e instanceof Error ? e.message : String(e));
  $("loading").textContent = "読み込みに失敗しました";
}
function pixelRatio() {
  const b = { low: 0.75, standard: 1, high: 1.5 }[quality];
  return Math.min(devicePixelRatio, b);
}
function resize() {
  if (!renderer) return;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight, pixelRatio());
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
function requestLook() {
  if (!ready) return;
  try {
    const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => undefined);   // no pointer lock: the mouse still looks around without it
  } catch {
    /* pointer lock unavailable: drag to look */
  }
}
function setSettings(open: boolean) {
  settingsOpen = open;
  keys.clear();
  $("settings").hidden = !open;
  if (open) document.exitPointerLock();
  $("resume").hidden = true;
}
function audioLabel() {
  const t = audio.muted || !audio.context ? "オフ" : "オン";
  $("audio").textContent = t;
  $("sound-short").textContent = "♪ " + t;
}
async function toggleAudio() {
  try {
    if (!audio.context) await audio.start();
    else audio.setMuted(!audio.muted);
  } catch (e) {
    console.error(e);
  }
  audioLabel();
}
$("audio").onclick = toggleAudio;
$("sound-short").onclick = toggleAudio;
enter.onclick = () => {
  started = true;
  $("welcome").hidden = true;
  document.body.classList.add("exploring");
  requestLook();
  audio
    .start()
    .then(() => {
      audioLabel();
      // arriving at six o'clock: the chime sounds a little after the walk begins
      if (timeOfDay >= 17.98 && timeOfDay < 18.3) audio.chime(towerPoint(), 16);
    })
    .catch(console.error);
};
canvas.onclick = () => started && !paused() && requestLook();
$("settings-button").onclick = () => setSettings(!settingsOpen);
$("close-settings").onclick = () => setSettings(false);
addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  $("crosshair").hidden = !locked;
  $("resume").hidden = true;
  keys.clear();
});
// Looking around: the mouse turns the view as it moves over the scene, no click needed (a click
// still locks the pointer for unlimited turning). Without the lock the cursor stops at the edge of
// the window, so resting it near the left or right edge keeps turning that way.
let dragging = false;
const hover = { x: 0.5, y: 0.5, inside: false };
canvas.addEventListener("pointerdown", () => (dragging = true));
addEventListener("pointerup", () => (dragging = false));
const overUi = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("#settings, #welcome, #map, #minimap, button, input, select, a, label");
addEventListener("mousemove", (e) => {
  if (!started || paused()) return;
  hover.x = e.clientX / innerWidth;
  hover.y = e.clientY / innerHeight;
  hover.inside = !overUi(e.target);
  if (locked || dragging || hover.inside) {
    if (vehicles?.active) { vehicles.look(e.movementX, e.movementY); return; }
    yaw -= e.movementX * 0.0018;
    pitch = T.MathUtils.clamp(pitch - e.movementY * 0.0018, -1.45, 1.45);
  }
});
document.addEventListener("mouseleave", () => (hover.inside = false));
addEventListener("blur", () => (hover.inside = false));
function edgeTurn(dt: number) {
  if (vehicles?.active) return;
  if (locked || !hover.inside || !started || paused()) return;
  const EDGE = 0.06;
  const l = 1 - Math.min(hover.x / EDGE, 1), r = 1 - Math.min((1 - hover.x) / EDGE, 1);
  yaw += (l * l - r * r) * 1.7 * dt;
}
let bookmark: number[] | null = null;
function setFree(v: boolean) {
  if (vehicles?.active) { $<HTMLInputElement>("free").checked = false; return; }
  if (v && !walker.free) bookmark = walker.position.toArray();
  walker.free = v;
  if (!v && bookmark) walker.teleport(bookmark);
  $<HTMLInputElement>("free").checked = v;
}
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input,select")) return;
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (ready && started && !paused() && !walker.free) {
    if (e.code === "KeyE") {
      if (vehicles.active) {
        const q = vehicles.active.sim.rotation;
        if (vehicles.exit()) { yaw = new T.Euler().setFromQuaternion(q, "YXZ").y + Math.PI; pitch = 0; }
      } else vehicles.enter();
      keys.clear(); updateCamera(0); updateVehicleHud();
    }
    if (e.code === "KeyV" && vehicles.active) { vehicles.toggleView(); updateCamera(0); updateVehicleHud(); }
    if (e.code === "KeyR" && vehicles.active) { vehicles.reset(); keys.clear(); updateCamera(0); }
  }
  if (e.code === "KeyF" && ready) setFree(!walker.free);
  if (e.code === "Space" && ready && started && !walker.free && !paused() && !vehicles.active) walker.jump();
  if (e.code === "KeyM" && ready && started && !settingsOpen) villageMap?.toggle();
  if (e.code === "KeyH") document.body.classList.toggle("hide-ui");
  if (e.code === "Escape") {
    keys.clear();
    if (mapOpen) villageMap?.toggle(false);
    else if (settingsOpen) setSettings(false);
    else if (started) setSettings(true);
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && vehicles?.active) { keys.clear(); setSettings(true); }
});
$<HTMLInputElement>("free").onchange = (e) => setFree((e.target as HTMLInputElement).checked);
function clockLabel(h: number) {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
// the village radio plays its evening chime at 18:00 (from the PA horns on the fire lookout)
function towerPoint() {
  const o = land?.world.data.objects.find((x) => x.asset === "hinomi");
  return o ? new T.Vector3(o.position[0], o.position[1] + 11, o.position[2]) : new T.Vector3(90, 18, 70);
}
function setTime(h: number) {
  if (timeOfDay < 18 && h >= 18 && h < 18.4) audio.chime(towerPoint(), 1.5);
  timeOfDay = h;
  land.setTime(h);
  $("time-value").textContent = clockLabel(h);
  $("clock").textContent = clockLabel(h);
  $<HTMLInputElement>("time").value = String(Math.round(h * 60));
}
$<HTMLInputElement>("time").oninput = (e) => setTime(+(e.target as HTMLInputElement).value / 60);
function setQuality(q: Quality) {
  quality = q;
  land.setQuality(q);
  post.setQuality(q);
  $<HTMLSelectElement>("quality").value = q;
  resize();
}
$<HTMLSelectElement>("quality").onchange = (e) => setQuality((e.target as HTMLSelectElement).value as Quality);
$<HTMLInputElement>("diagnostics").onchange = (e) => ($("stats").hidden = !(e.target as HTMLInputElement).checked);
$("open-map").onclick = () => started && villageMap?.toggle(true);
// minimap on/off, remembered in this browser (storage may be unavailable: then it just defaults to on)
const miniBox = $<HTMLInputElement>("show-minimap");
const setMini = (on: boolean) => {
  miniBox.checked = on;
  document.body.classList.toggle("no-minimap", !on);
  try {
    localStorage.setItem("natsukage.minimap", on ? "1" : "0");
  } catch {
    /* private mode */
  }
};
try {
  if (localStorage.getItem("natsukage.minimap") === "0") setMini(false);
} catch {
  /* private mode */
}
miniBox.onchange = () => setMini(miniBox.checked);
function goto(name: string) {
  const l = land.world.data.landmarks[name];
  if (!l) return;
  vehicles?.leaveForTravel();
  walker.teleport(l);
  yaw = -T.MathUtils.degToRad(l[3] ?? 0); // compass azimuth -> camera yaw (forward = -Z at yaw 0)
  pitch = T.MathUtils.degToRad(l[4] ?? 0);
  keys.clear();
  updateCamera(0);
}
document.querySelectorAll<HTMLButtonElement>("[data-place]").forEach((b) => (b.onclick = () => (goto(b.dataset.place!), setSettings(false))));

function updateCamera(dt: number) {
  if (vehicles?.updateCamera(camera, dt)) return;
  edgeTurn(dt);
  camera.position.copy(walker.position);
  if (!walker.free && walker.grounded && walker.speed > 0.2) camera.position.y += Math.sin(walker.bob * Math.PI * 2) * 0.018 * Math.min(1, walker.speed / 1.5);
  if (!walker.free) camera.position.y -= Math.sin(Math.min(1, walker.landing) * Math.PI) * 0.12;
  camera.rotation.set(pitch, yaw, 0);
  void dt;
}
const PLACES: [string, string, (p: T.Vector3) => boolean][] = [
  ["見晴らし", "村を見下ろす、境内の外れ。", (p) => p.y > 40 && p.z > -22],
  ["山上の神社", "杉木立に包まれた、静かな境内。", (p) => p.y > 40],
  ["表参道の石段", "", (p) => p.x > 120 && p.x < 205 && Math.abs(p.z + 40) < 6],
  ["麓の鳥居", "山へと続く、二百段。", (p) => p.x > 92 && p.x <= 124 && Math.abs(p.z + 40) < 14],
  ["川のほとり", "堰の水音と、土手の道。", (p) => Math.abs(p.x - riverX(p.z)) < 16],
  ["山里の集落", "田んぼを渡る、晩夏の風。", () => true],
];
function riverX(z: number) {
  const pts = land.world.data.river.bed.points;
  const i = T.MathUtils.clamp(Math.round((z - pts[0][1]) / (pts[1][1] - pts[0][1])), 0, pts.length - 1);
  return pts[i][0];
}
function placeName(): [string, string] {
  const p = walker.position;
  for (const [name, cap, test] of PLACES)
    if (test(p)) {
      if (name === "表参道の石段") {
        const st = land.world.data.stair;
        const n = Math.round((p.y - EYE_OFFSET - st.footY) / st.rise);
        return [name, `${T.MathUtils.clamp(n, 0, st.steps)} / ${st.steps} 段　木陰を抜けて。`];
      }
      return [name, cap];
    }
  return ["", ""];
}
const EYE_OFFSET = 1.62;
function visitVehicle() {
  if (!ready) return;
  if (walker.free) setFree(false);
  const car = vehicles.visitNearest();
  if (car) { const p = car.sim.position.clone().sub(walker.position); yaw = Math.atan2(-p.x, -p.z); pitch = -.12; }
  keys.clear(); setSettings(false); updateCamera(0); updateVehicleHud();
}
$("find-vehicle").onclick = visitVehicle;
function updateVehicleHud() {
  const active = vehicles.active;
  document.body.classList.toggle("driving", !!active);
  $("vehicle-hud").hidden = !started || paused() || !active;
  $("vehicle-prompt").hidden = !started || paused() || !!active || !vehicles.nearest();
  if (active) {
    const speed = active.sim.speed;
    if (Math.abs(speed) < .3 && vehicles.message === "停車してから E で降りる") vehicles.message = "";
    drivingHud.update(speed, active.sim.distance);
    $("vehicle-view").textContent = vehicles.view === "first" ? "一人称" : "三人称";
    $("vehicle-notice").textContent = vehicles.message;
  }
}
function intent() {
  const d = new T.Vector3(
    (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    walker.free ? (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0) : 0,
    (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0),
  );
  if (d.lengthSq() > 0) d.normalize();
  if (walker.free) d.applyEuler(new T.Euler(pitch, yaw, 0, "YXZ"));
  else d.applyAxisAngle(T.Object3D.DEFAULT_UP, yaw);
  return d;
}
function frame(dt: number, wall: number) {
  elapsed += dt;
  if (!ready) return;
  acc = Math.min(acc + dt, 0.2);
  while (acc >= 1 / 60) {
    simulationStep(1 / 60);
    acc -= 1 / 60;
  }
  updateCamera(dt);
  vehicles.sync(); updateVehicleHud();
  const heading = vehicles.active ? new T.Euler().setFromQuaternion(vehicles.active.sim.rotation, "YXZ").y + Math.PI : yaw;
  villageMap?.update(walker.position.x, walker.position.z, heading, performance.now());
  land.update(dt, elapsed);
  audio.update(camera, land.world, timeOfDay);
  post.updateRays(camera, land.lighting.sunDir, land.lighting.elevation, quality);
  renderer.info.reset();
  post.draw(dt);
  measure += wall;
  frames++;
  if (measure > 0.7) {
    fps = Math.round(frames / measure);
    frames = measure = 0;
    const [n, c] = placeName();
    $("place-name").textContent = n;
    $("place-caption").textContent = c;
    const info = renderer.info.render;
    $("stats").textContent = `${fps} fps · ${quality}\n${info.triangles.toLocaleString()} tris / ${info.calls} calls\n${camera.position
      .toArray()
      .map((v) => v.toFixed(1))
      .join(", ")}\n${walker.free ? "FREE" : walker.grounded ? "GROUNDED" : "AIR"} · ${audio.status}`;
  }
}
function simulationStep(dt: number) {
  if (vehicles.active) {
    if (!started || paused()) return;
    vehicles.step(dt, {
      throttle: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
      steer: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
      brake: keys.has("Space"),
    });
  } else walker.move(started && !paused() ? intent() : new T.Vector3(), dt, keys.has("ShiftLeft") || keys.has("ShiftRight"));
}
let last = performance.now();
const CAPTURE = params.has("capture");
function loop(t: number) {
  if (CAPTURE) return; // capture mode renders only on explicit request (offline review)
  const wall = (t - last) / 1000, dt = Math.min(wall, 0.1);
  last = t;
  try {
    frame(dt, wall);
  } catch (e) {
    ready = false;
    fail(e);
  }
  requestAnimationFrame(loop);
}
async function boot() {
  renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    ready = false;
    fail(Error("WebGL context lost"));
  });
  const progress = (p: number, label: string) => ($("loading").textContent = `${label}　${Math.round(p * 100)}%`);
  progress(0.01, "地形データを読み込んでいます");
  const world = await loadWorld();
  land = new Landscape(renderer, camera, world);
  land.quality = quality;
  land.lib.setCoverage(quality !== "low");   // alpha-to-coverage needs the MSAA that "low" goes without
  post = new Post(renderer, land.scene, camera);
  post.setQuality(quality);
  resize();
  const physics = Walker.create(world);
  await land.load(progress);
  await populate(land, progress);
  walker = await physics;
  vehicles = new VehicleFleet(land, walker);
  progress(.96, "車両を準備しています");
  await vehicles.load();
  progress(0.98, "仕上げています");
  await land.lib.ready();
  const start = params.get("place") ?? "foot";
  goto(start);
  setTime(params.has("time") ? +params.get("time")! : world.data.environment.defaultTime);
  // compile shaders before the first visible frame
  land.update(0, 0);
  renderer.compile(land.scene, camera);
  // the village map: places to go are the destinations of the settings panel
  const places = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-place]"))
    .map((b) => ({ key: b.dataset.place!, name: b.textContent!.trim(), l: world.data.landmarks[b.dataset.place!] }))
    .filter((p) => p.l)
    .map((p) => ({ key: p.key, name: p.name, x: p.l[0], z: p.l[2] }));
  villageMap = new VillageMap(places, (key) => goto(key), (open) => {
    mapOpen = open;
    keys.clear();
    if (open) {
      document.exitPointerLock();
      setSettings(false);
    }
  });
  villageMap.load().catch((e) => console.warn("map unavailable", e));
  ready = true;
  enter.disabled = false;
  $("loading").textContent = "準備ができました";
  (window as unknown as { __satoyama: unknown }).__satoyama = {
    get ready() {
      return ready;
    },
    get state() {
      return {
        position: walker.position.toArray(),
        groundHeight: world.height.sample(walker.position.x, walker.position.z),
        grounded: walker.grounded,
        free: walker.free,
        triangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
        fps,
        audio: audio.status,
        steps: world.data.steps.length,
        time: timeOfDay,
        place: placeName()[0],
        vehicle: vehicles.state,
      };
    },
    teleport: (name: string) => goto(name),
    look: (y: number, p: number) => {
      yaw = y;
      pitch = p;
      updateCamera(0);
    },
    lookCompass: (az: number, p: number) => {
      yaw = -T.MathUtils.degToRad(az);
      pitch = T.MathUtils.degToRad(p);
      updateCamera(0);
    },
    walk: (x: number, z: number, n: number, run = false) => {
      const d = new T.Vector3(x, 0, z);
      if (d.lengthSq()) d.normalize();
      for (let i = 0; i < n; i++) walker.move(d, 1 / 60, run);
      updateCamera(0);
      return walker.position.toArray();
    },
    place: (x: number, y: number, z: number) => { vehicles.leaveForTravel(); walker.teleport([x, y, z]); },
    visitVehicle,
    /** Deterministic stepping uses the same keyboard, pause and physics path as live play. */
    advance: (n: number) => {
      for (let i = 0; i < n; i++) simulationStep(1 / 60);
      vehicles.sync(); updateCamera(0); updateVehicleHud();
      return vehicles.state;
    },
    get vehicleSystem() { return vehicles; },
    jumpWalk: (x: number, z: number, n: number, run = true) => {
      const d = new T.Vector3(x, 0, z);
      if (d.lengthSq()) d.normalize();
      let peak = -1e9;
      const y0 = walker.position.y;
      walker.jump();
      for (let i = 0; i < n; i++) {
        walker.move(d, 1 / 60, run);
        peak = Math.max(peak, walker.position.y - y0);
      }
      updateCamera(0);
      return { position: walker.position.toArray(), peak, grounded: walker.grounded };
    },
    setFree: (v: boolean) => setFree(v),
    setTime,
    /** test hooks for the soundscape (headless checks) */
    startAudio: () => audio.start(),
    chime: () => audio.chime(towerPoint(), 0),
    setQuality,
    renderFrames: (n: number) => {
      for (let i = 0; i < n; i++) {
        vehicles.sync(); updateVehicleHud();
        updateCamera(0);
        land.update(1 / 60, (elapsed += 1 / 60));
        post.updateRays(camera, land.lighting.sunDir, land.lighting.elevation, quality);
        renderer.info.reset();
        post.draw(1 / 60);
      }
      const heading = vehicles.active ? new T.Euler().setFromQuaternion(vehicles.active.sim.rotation, "YXZ").y + Math.PI : yaw;
      villageMap?.update(walker.position.x, walker.position.z, heading, performance.now(), true);
      return renderer.info.render.triangles;
    },
    /** main-pass triangle estimate per system (before frustum culling), shadow casters separately */
    breakdown: () => {
      const out: Record<string, { tris: number; shadow: number }> = {};
      land.scene.traverse((o) => {
        const m = o as T.Mesh;
        if (!m.isMesh || !m.visible) return;
        const g = m.geometry;
        const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const inst = (m as T.InstancedMesh).isInstancedMesh ? (m as T.InstancedMesh).count : (g as T.InstancedBufferGeometry).isInstancedBufferGeometry ? (g as T.InstancedBufferGeometry).instanceCount : 1;
        const mat = m.material as T.Material;
        const key = m.name ? m.name.replace(/_\d+(_lod\d)?$/, "$1").replace(/^(architecture|props)\/.*/, "$1") : (mat.customProgramCacheKey?.() ?? "").split("|").pop() || mat.type;
        const e = (out[key] ??= { tris: 0, shadow: 0 });
        e.tris += per * inst;
        if (m.castShadow) e.shadow += per * inst;
      });
      return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].tris - a[1].tris).map(([k, v]) => [k, { tris: Math.round(v.tris), shadow: Math.round(v.shadow) }]));
    },
    get scene() {
      return land.scene;
    },
    /** lighting/post objects, for tuning from the console */
    get land() {
      return land;
    },
    get post() {
      return post;
    },
    get camera() {
      return camera;
    },
    get world() {
      return world.data;
    },
  };
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
  });
}
boot().catch(fail);
