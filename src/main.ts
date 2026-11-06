import "./style.css";
import * as T from "three";
import { loadWorld } from "./world";
import { Landscape } from "./scene";
import { Walker } from "./physics";
import { Soundscape } from "./audio";
const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;
const canvas = $<HTMLCanvasElement>("world"),
  enter = $<HTMLButtonElement>("enter");
enter.disabled = true;
const audio = new Soundscape();
let renderer: T.WebGLRenderer, land: Landscape, walker: Walker;
const camera = new T.PerspectiveCamera(
  65,
  innerWidth / innerHeight,
  0.08,
  1800,
);
camera.rotation.order = "YXZ";
let yaw = 0,
  pitch = 0.08,
  started = false,
  locked = false,
  settings = false,
  ready = false,
  elapsed = 0;
const keys = new Set<string>();
let frameCount = 0,
  fps = 0,
  measureTime = 0;
let fixedAccumulator = 0;
function error(e: unknown) {
  console.error(e);
  $("error").hidden = false;
  $("error").textContent =
    "風景を開始できませんでした。" +
    (e instanceof Error ? e.message : String(e));
  $("loading").textContent = "読み込みに失敗しました";
}
function resize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
function requestLook() {
  if (!ready) return;
  try {
    const result = canvas.requestPointerLock();
    result?.catch(() => {
      $("resume").textContent = "画面をドラッグして視点を動かせます";
    });
  } catch {}
}
function setSettings(open: boolean) {
  settings = open;
  $("settings").hidden = !open;
  if (open) document.exitPointerLock();
  $("resume").hidden = !started || open || locked;
}
function updateAudio() {
  const text = audio.muted ? "オフ" : "オン";
  $("audio").textContent = text;
  $("sound-short").textContent = "♪ " + text;
}
async function toggleAudio() {
  try {
    if (!audio.context) await audio.start();
    else audio.setMuted(!audio.muted);
    updateAudio();
  } catch (e) {
    $("audio").textContent = "読込失敗";
    console.error(e);
  }
}
$("audio").onclick = toggleAudio;
$("sound-short").onclick = toggleAudio;
enter.onclick = () => {
  started = true;
  $("welcome").hidden = true;
  requestLook();
  audio
    .start()
    .then(updateAudio)
    .catch((e) => console.error(e));
};
canvas.onclick = () => {
  if (started && !settings) requestLook();
};
$("settings-button").onclick = () => setSettings(!settings);
$("close-settings").onclick = () => setSettings(false);
addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  $("crosshair").hidden = !locked;
  $("resume").hidden = !started || locked || settings;
  keys.clear();
});
let dragging = false;
canvas.addEventListener("pointerdown", () => (dragging = true));
addEventListener("pointerup", () => (dragging = false));
addEventListener("mousemove", (e) => {
  if ((locked || dragging) && !settings && started) {
    yaw -= e.movementX * 0.0019;
    pitch = T.MathUtils.clamp(pitch - e.movementY * 0.0019, -1.5, 1.5);
  }
});
let walkBookmark: number[] | null = null;
function setFree(v: boolean) {
  if (v && !walker.free) walkBookmark = walker.position.toArray();
  if (!v && walker.free && walkBookmark) walker.teleport(walkBookmark);
  walker.free = v;
  $<HTMLInputElement>("free").checked = v;
  walker.vertical = 0;
}
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input,select")) return;
  if (
    ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown"].includes(
      e.code,
    )
  )
    e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyF" && ready) setFree(!walker.free);
  if (e.code === "KeyH") document.body.classList.toggle("hide-ui");
  if (e.code === "Escape") {
    keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    if (settings) setSettings(false);
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => {
  keys.clear();
  fixedAccumulator = 0;
});
$<HTMLInputElement>("free").onchange = (e) =>
  setFree((e.target as HTMLInputElement).checked);
$<HTMLInputElement>("time").oninput = (e) => {
  const t = +(e.target as HTMLInputElement).value / 60,
    total = Math.round(t * 60),
    label = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  land.setTime(t);
  $("time-value").textContent = label;
  $("clock").textContent = label;
};
$<HTMLSelectElement>("quality").onchange = (e) => {
  land.setQuality((e.target as HTMLSelectElement).value);
  resize();
};
$<HTMLInputElement>("diagnostics").onchange = (e) =>
  ($("stats").hidden = !(e.target as HTMLInputElement).checked);
document.querySelectorAll<HTMLButtonElement>("[data-place]").forEach(
  (b) =>
    (b.onclick = () => {
      const place = b.dataset.place!;
      walker.teleport(land.data.landmarks[place]);
      if (place === "lookout") {
        yaw = Math.PI;
        pitch = -0.15;
      } else if (place === "shrine") {
        yaw = 0;
        pitch = 0;
      } else {
        yaw = 0;
        pitch = 0.08;
      }
      keys.clear();
      updateCamera();
      land.updateTrees(camera.position);
      setSettings(false);
    }),
);
function updateCamera() {
  camera.position.copy(walker.position);
  camera.rotation.set(pitch, yaw, 0);
}
function place() {
  const p = walker.position;
  if (p.y > 30)
    return p.x > 12
      ? ["見晴らしの庭", "風の向こうに、村の暮らし。"]
      : ["山上の神社", "杉木立に包まれた、静かな境内。"];
  if (p.z < 0)
    return [
      "表参道の石段",
      `${Math.min(200, Math.max(0, Math.round(p.y / 0.19)))} / 200 段　木陰を抜けて。`,
    ];
  if (p.x > 65 && p.z > 30)
    return ["小川のほとり", "水音をたどる、夕暮れの道。"];
  if (p.z > 32) return ["山里の集落", "田んぼを渡る、晩夏の風。"];
  return ["麓の鳥居", "山へと続く、二百段。"];
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
function frame(dt: number, wallDt: number) {
  elapsed += dt;
  if (ready) {
    fixedAccumulator = Math.min(fixedAccumulator + dt, 0.15);
    const dir = started && !settings ? intent() : new T.Vector3();
    while (fixedAccumulator >= 1 / 60) {
      walker.move(dir, 1 / 60, keys.has("ShiftLeft") || keys.has("ShiftRight"));
      fixedAccumulator -= 1 / 60;
    }
    updateCamera();
    land.update(dt, elapsed, camera.position);
    audio.update(camera);
    renderer.render(land.scene, camera);
    measureTime += wallDt;
    frameCount++;
    if (measureTime > 0.7) {
      fps = Math.round(frameCount / measureTime);
      frameCount = 0;
      measureTime = 0;
      const [name, caption] = place();
      $("place-name").textContent = name;
      $("place-caption").textContent = caption;
      const info = renderer.info.render;
      const mb = land.materials.textures.reduce(
        (s, t) =>
          s +
          (t.image
            ? (t.image.width * t.image.height * 4 * 1.333) / 1048576
            : 0),
        0,
      );
      $("stats").textContent =
        `${fps} fps · ${land.quality}\n${info.triangles.toLocaleString()} triangles / ${info.calls} calls\nTexture estimate ${mb.toFixed(1)} MiB (maps only)\n${camera.position
          .toArray()
          .map((v) => v.toFixed(1))
          .join(
            ", ",
          )} m\n${walker.free ? "FREE CAMERA" : walker.grounded ? "GROUNDED" : "AIR"} · ${audio.status}`;
    }
  }
}
let last = performance.now();
function loop(t: number) {
  const wallDt = (t - last) / 1000,
    dt = Math.min(wallDt, 0.1);
  last = t;
  frame(dt, wallDt);
  requestAnimationFrame(loop);
}
async function boot() {
  renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  resize();
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    ready = false;
    $("error").hidden = false;
    $("error").textContent = "描画接続が失われました。復旧を待っています。";
  });
  canvas.addEventListener("webglcontextrestored", () => location.reload());
  const { data, terrain } = await loadWorld();
  land = new Landscape(renderer, data, terrain);
  $("loading").textContent = "建物と木立を読み込んでいます…";
  const physics = Walker.create(data, terrain);
  await land.load(
    (n) =>
      ($("loading").textContent =
        `風景を準備しています　${Math.round(n * 100)}%`),
  );
  walker = await physics;
  updateCamera();
  ready = true;
  enter.disabled = false;
  $("loading").textContent = "準備ができました";
  // Explicit diagnostics hook for repeatable traversal, collision and capture checks.
  (window as any).__satoyama = {
    get ready() {
      return ready;
    },
    get state() {
      return {
        position: walker.position.toArray(),
        grounded: walker.grounded,
        free: walker.free,
        triangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
        fps,
        audio: audio.status,
        steps: data.steps.length,
      };
    },
    teleport: (name: string) => {
      walker.teleport(data.landmarks[name]);
      updateCamera();
      land.updateTrees(camera.position);
    },
    look: (y: number, p: number) => {
      yaw = y;
      pitch = p;
      updateCamera();
    },
    walk: (x: number, z: number, frames: number, run = false) => {
      for (let i = 0; i < frames; i++)
        walker.move(new T.Vector3(x, 0, z), 1 / 60, run);
      updateCamera();
      land.updateTrees(camera.position);
      return walker.position.toArray();
    },
    setTime: (t: number) => land.setTime(t),
    setQuality: (q: string) => {
      land.setQuality(q);
      resize();
    },
    get world() {
      return data;
    },
    get scene() {
      return land.scene;
    },
    get camera() {
      return camera;
    },
  };
  requestAnimationFrame(loop);
}
boot().catch(error);
