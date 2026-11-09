import { publicUrl } from "./urls";

/**
 * The village map: a heading-up minimap in the corner and a full sheet (M) that can be dragged and
 * zoomed, with the walker's position and the places to go. The sheet itself is baked from the world
 * by tools/world/bake_map.py (public/world/map.webp, a 1:25,000-style survey map); names are
 * lettered here at screen resolution from map.json.
 */
type Label = { text: string; x: number; z: number; kind: string; vertical?: boolean };
type MapMeta = { image: string; size: number; extent: number; title: string; date: string; labels: Label[] };
export type MapPlace = { key: string; name: string; x: number; z: number };

const PAPER = "#f3eedd";
const INK = "#2b241e";
const SERIF = `"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif`;
const STYLE: Record<string, { size: number; color: string; spacing: number; weight?: number; italic?: boolean }> = {
  district: { size: 24, color: INK, spacing: 0.45, weight: 600 },
  hamlet: { size: 15, color: INK, spacing: 0.25, weight: 600 },
  facility: { size: 11, color: INK, spacing: 0.05 },
  water: { size: 13, color: "#2f6597", spacing: 0.2, italic: true },
  height: { size: 10, color: INK, spacing: 0 },
};

export class VillageMap {
  meta?: MapMeta;
  img = new Image();
  ready = false;
  open = false;
  private mini = document.getElementById("minimap") as HTMLCanvasElement;
  private miniWrap = document.getElementById("minimap-wrap") as HTMLElement;
  private sheet = document.getElementById("map") as HTMLElement;
  private canvas = document.getElementById("map-canvas") as HTMLCanvasElement;
  private scaleEl = document.getElementById("map-scale") as HTMLElement;
  private tip = document.getElementById("map-tip") as HTMLElement;
  private miniZoom = 0.75;                  // css px per metre on the minimap
  private view = { x: 0, z: 0, ppm: 1 };    // full map: centre and css px per metre
  private pose = { x: 0, z: 0, yaw: 0 };
  private lastMini = 0;
  private hoverPlace: MapPlace | null = null;
  private drag: { x: number; y: number; vx: number; vz: number; moved: boolean } | null = null;

  constructor(
    private places: MapPlace[],
    private onTeleport: (key: string) => void,
    private onToggle: (open: boolean) => void,
  ) {
    this.mini.addEventListener("click", () => this.toggle(true));
    this.mini.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.miniZoom = Math.min(2.6, Math.max(0.3, this.miniZoom * Math.exp(-e.deltaY * 0.0015)));
        this.drawMini();
      },
      { passive: false },
    );
    document.getElementById("map-close")!.onclick = () => this.toggle(false);
    document.getElementById("map-here")!.onclick = () => this.centreOn(this.pose.x, this.pose.z, this.fitPpm() * 3);
    document.getElementById("map-in")!.onclick = () => this.zoomAt(1.6);
    document.getElementById("map-out")!.onclick = () => this.zoomAt(1 / 1.6);
    const c = this.canvas;
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomAt(Math.exp(-e.deltaY * 0.0016), e.offsetX, e.offsetY);
      },
      { passive: false },
    );
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z, moved: false };
    });
    c.addEventListener("pointermove", (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
        this.view.x = this.drag.vx - dx / this.view.ppm;
        this.view.z = this.drag.vz - dy / this.view.ppm;
        this.clampView();
        this.drawFull();
      } else this.hover(e.offsetX, e.offsetY);
    });
    c.addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved) {
        this.hover(e.offsetX, e.offsetY);
        if (this.hoverPlace) {
          const key = this.hoverPlace.key;
          this.toggle(false);
          this.onTeleport(key);
        }
      }
    });
    c.addEventListener("dblclick", (e) => this.zoomAt(2, e.offsetX, e.offsetY));
    c.addEventListener("pointerleave", () => {
      this.hoverPlace = null;
      this.tip.hidden = true;
      this.drawFull();
    });
    addEventListener("resize", () => {
      if (this.open) this.layout();
      this.drawMini();
    });
  }

  async load() {
    this.meta = await fetch(publicUrl("world/map.json")).then((r) => r.json());
    this.img.src = publicUrl(`world/${this.meta!.image}`);
    await this.img.decode();
    this.ready = true;
    this.miniWrap.hidden = false;
  }

  /** Called every frame with the walker's position and the camera yaw (0 = facing north). */
  update(x: number, z: number, yaw: number, now: number, force = false) {
    this.pose = { x, z, yaw };
    if (!this.ready) return;
    if (force || now - this.lastMini > 1000 / 30) {
      this.lastMini = now;
      this.drawMini();
    }
    if (this.open) this.drawFull();
  }

  toggle(open = !this.open) {
    if (!this.ready || open === this.open) return;
    this.open = open;
    this.sheet.hidden = !open;
    if (open) {
      this.layout();
      this.view.ppm = this.fitPpm();
      this.view.x = 0;
      this.view.z = 0;
      this.drawFull();
    } else this.tip.hidden = true;
    this.onToggle(open);
  }

  // ------------------------------------------------------------------ minimap (heading up)
  private drawMini() {
    const cv = this.mini, dpr = Math.min(devicePixelRatio || 1, 2);
    const size = cv.clientWidth;
    if (!size || !cv.getClientRects().length) return;      // hidden (welcome screen, H, or switched off)
    if (cv.width !== Math.round(size * dpr)) cv.width = cv.height = Math.round(size * dpr);
    const g = cv.getContext("2d")!;
    const m = this.meta!, S = m.size / m.extent;
    const r = size / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "#d9d3bf";
    g.fillRect(0, 0, size, size);
    g.translate(r, r);
    g.rotate(this.pose.yaw);
    const k = this.miniZoom / S;
    g.scale(k, k);
    g.translate(-(this.pose.x + m.extent / 2) * S, -(this.pose.z + m.extent / 2) * S);
    g.imageSmoothingQuality = "high";
    g.drawImage(this.img, 0, 0);
    g.restore();
    // names near the walker, kept upright
    g.save();
    g.beginPath();
    g.arc(r, r, r - 6, 0, Math.PI * 2);
    g.clip();
    const c = Math.cos(this.pose.yaw), s = Math.sin(this.pose.yaw);
    const boxes: number[][] = [[r - 10, r - 12, r + 10, r + 10]];   // keep the arrow clear
    for (const kind of ["district", "hamlet", "facility"])
      for (const l of m.labels) {
        if (l.kind !== kind) continue;
        const dx = (l.x - this.pose.x) * this.miniZoom, dz = (l.z - this.pose.z) * this.miniZoom;
        const sx = r + dx * c - dz * s, sy = r + dx * s + dz * c;
        const size = kind === "facility" ? 9 : kind === "hamlet" ? 11 : 13;
        if (Math.hypot(sx - r, sy - r) > r - 14 || !this.fits(boxes, l.text, sx, sy, size, 0.15)) continue;
        this.text(g, l.text, sx, sy, size, INK, 0.15, kind === "facility" ? 400 : 600);
      }
    g.restore();
    // the walker: a vermilion arrow with a soft view cone, always pointing up
    const cone = g.createRadialGradient(r, r, 2, r, r, r * 0.55);
    cone.addColorStop(0, "rgba(196,64,38,0.28)");
    cone.addColorStop(1, "rgba(196,64,38,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(r, r);
    g.arc(r, r, r * 0.55, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    g.closePath();
    g.fill();
    this.arrow(g, r, r, 0, 7);
    // rim and the north mark
    g.lineWidth = 2;
    g.strokeStyle = "rgba(240,233,212,0.9)";
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = "rgba(40,34,28,0.55)";
    g.beginPath();
    g.arc(r, r, r - 3.5, 0, Math.PI * 2);
    g.stroke();
    const nx = r + Math.sin(this.pose.yaw) * (r - 11), ny = r - Math.cos(this.pose.yaw) * (r - 11);
    g.fillStyle = "#b8321f";
    g.beginPath();
    g.arc(nx, ny, 8, 0, Math.PI * 2);
    g.fill();
    g.font = `600 10px ${SERIF}`;
    g.fillStyle = "#f6f0de";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("北", nx, ny + 0.5);
  }

  // ------------------------------------------------------------------ full sheet
  private fitPpm() {
    const m = this.meta!, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return (Math.min(w, h) * 0.9) / m.extent;
  }
  private layout() {
    const dpr = Math.min(devicePixelRatio || 1, 2), c = this.canvas;
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }
  private clampView() {
    const e = this.meta!.extent / 2;
    this.view.x = Math.min(e, Math.max(-e, this.view.x));
    this.view.z = Math.min(e, Math.max(-e, this.view.z));
  }
  private zoomAt(f: number, sx?: number, sy?: number) {
    const c = this.canvas, fit = this.fitPpm();
    sx ??= c.clientWidth / 2;
    sy ??= c.clientHeight / 2;
    const wx = this.view.x + (sx - c.clientWidth / 2) / this.view.ppm, wz = this.view.z + (sy - c.clientHeight / 2) / this.view.ppm;
    this.view.ppm = Math.min(fit * 8, Math.max(fit * 0.9, this.view.ppm * f));
    this.view.x = wx - (sx - c.clientWidth / 2) / this.view.ppm;
    this.view.z = wz - (sy - c.clientHeight / 2) / this.view.ppm;
    this.clampView();
    this.drawFull();
  }
  private centreOn(x: number, z: number, ppm: number) {
    this.view = { x, z, ppm: Math.min(this.fitPpm() * 8, ppm) };
    this.clampView();
    this.drawFull();
  }
  private toScreen(x: number, z: number) {
    const c = this.canvas;
    return [c.clientWidth / 2 + (x - this.view.x) * this.view.ppm, c.clientHeight / 2 + (z - this.view.z) * this.view.ppm];
  }
  private hover(sx: number, sy: number) {
    let best: MapPlace | null = null, bd = 16;
    for (const p of this.places) {
      const [px, py] = this.toScreen(p.x, p.z);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) (bd = d), (best = p);
    }
    this.hoverPlace = best;
    this.canvas.style.cursor = best ? "pointer" : this.drag ? "grabbing" : "grab";
    if (best) {
      const [px, py] = this.toScreen(best.x, best.z);
      this.tip.hidden = false;
      this.tip.textContent = `${best.name}へ移動`;
      this.tip.style.left = `${px}px`;
      this.tip.style.top = `${py - 30}px`;
    } else this.tip.hidden = true;
    this.drawFull();
  }
  private drawFull() {
    if (!this.open || !this.meta) return;
    const c = this.canvas, g = c.getContext("2d")!, m = this.meta, S = m.size / m.extent;
    const dpr = c.width / Math.max(1, c.clientWidth), w = c.clientWidth, h = c.clientHeight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const [x0, y0] = this.toScreen(-m.extent / 2, -m.extent / 2);
    const side = m.extent * this.view.ppm;
    // the sheet with a margin and the neat line, as a printed map
    g.fillStyle = "#e9e2cb";
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 30;
    g.fillRect(x0 - 26, y0 - 26, side + 52, side + 52);
    g.shadowBlur = 0;
    g.imageSmoothingQuality = "high";
    g.drawImage(this.img, x0, y0, side, side);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(x0 - 0.5, y0 - 0.5, side + 1, side + 1);
    g.lineWidth = 0.6;
    g.strokeRect(x0 - 8, y0 - 8, side + 16, side + 16);
    // grid ticks every 100 m on the margin
    g.fillStyle = INK;
    g.font = `9px ${SERIF}`;
    for (let v = -500; v <= 500; v += 100) {
      const [tx] = this.toScreen(v, 0), [, ty] = this.toScreen(0, v);
      g.fillRect(tx - 0.5, y0 - 8, 1, 8);
      g.fillRect(tx - 0.5, y0 + side, 1, 8);
      g.fillRect(x0 - 8, ty - 0.5, 8, 1);
      g.fillRect(x0 + side, ty - 0.5, 8, 1);
    }
    // names
    const zoom = this.view.ppm / this.fitPpm();
    // names in order of importance; a lesser name that would overlap a placed one is left out
    const boxes: number[][] = [];
    const placeLabels = this.places.map((p) => {
      const [px, py] = this.toScreen(p.x, p.z);
      return { p, px, py };
    });
    for (const q of placeLabels) boxes.push([q.px - 8, q.py - 8, q.px + 8, q.py + 8]);
    const [wx, wy] = this.toScreen(this.pose.x, this.pose.z);
    boxes.push([wx - 14, wy - 14, wx + 14, wy + 14]);
    const order = ["district", "hamlet", "water", "route", "facility", "height"];
    const labels = [...m.labels].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const l of labels) {
      const [sx, sy] = this.toScreen(l.x, l.z);
      if (sx < -80 || sy < -80 || sx > w + 80 || sy > h + 80) continue;
      if (l.kind === "route") {
        if (this.fits(boxes, "00", sx, sy, 12, 0)) this.shield(g, sx, sy, l.text);
        continue;
      }
      const st = STYLE[l.kind] ?? STYLE.facility;
      if (l.kind === "facility" && zoom < 1.35) continue;
      if (l.kind === "height" && zoom < 1.1) continue;
      const size = st.size * (l.kind === "district" || l.kind === "hamlet" ? Math.min(1.35, 0.85 + zoom * 0.15) : 1);
      if (!this.fits(boxes, l.text, sx, sy, size, st.spacing, l.vertical)) continue;
      if (l.vertical) this.vertical(g, l.text, sx, sy, size, st.color, st.italic);
      else this.text(g, l.text, sx, sy, size, st.color, st.spacing, st.weight ?? 400, st.italic);
    }
    // the names of the places to go, below their markers, where there is room (always when hovered)
    const showNames = zoom > 1.6;
    const named = new Set<MapPlace>();
    for (const q of placeLabels.sort((a, b) => (a.p === this.hoverPlace ? -1 : b.p === this.hoverPlace ? 1 : 0))) {
      if ((showNames || q.p === this.hoverPlace) && this.fits(boxes, q.p.name, q.px, q.py + 17, 11, 0.08)) named.add(q.p);
    }
    // places to go
    for (const p of this.places) {
      const [px, py] = this.toScreen(p.x, p.z);
      const on = p === this.hoverPlace;
      g.save();
      g.translate(px, py);
      g.rotate(Math.PI / 4);
      g.fillStyle = on ? "#b8321f" : "#f6f0de";
      g.strokeStyle = "#b8321f";
      g.lineWidth = 2;
      const q = on ? 7 : 5.5;
      g.fillRect(-q, -q, q * 2, q * 2);
      g.strokeRect(-q, -q, q * 2, q * 2);
      g.restore();
      if (named.has(p)) this.text(g, p.name, px, py + 17, 11, "#8e2716", 0.08, 600);
    }
    // the walker
    const [ax, ay] = this.toScreen(this.pose.x, this.pose.z);
    g.fillStyle = "rgba(184,50,31,0.18)";
    g.beginPath();
    g.arc(ax, ay, 15, 0, Math.PI * 2);
    g.fill();
    this.arrow(g, ax, ay, -this.pose.yaw, 9);
    // scale bar
    const nice = [20, 50, 100, 200, 500].find((v) => v * this.view.ppm > 70) ?? 500;
    this.scaleEl.style.width = `${nice * this.view.ppm}px`;
    this.scaleEl.dataset.label = `${nice} m`;
    void S;
  }

  // ------------------------------------------------------------------ drawing helpers
  /** Reserve a label's box; false if it would overlap one already placed this frame. */
  private fits(boxes: number[][], t: string, x: number, y: number, size: number, spacing: number, vertical = false) {
    const n = [...t].length, w = vertical ? size * 1.1 : n * size * (1 + spacing) + 4, h = vertical ? n * size * 1.25 : size * 1.3;
    const b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
    boxes.push(b);
    return true;
  }
  private arrow(g: CanvasRenderingContext2D, x: number, y: number, rot: number, s: number) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(0, -s * 1.35);
    g.lineTo(s, s);
    g.lineTo(0, s * 0.45);
    g.lineTo(-s, s);
    g.closePath();
    g.fillStyle = "#b8321f";
    g.strokeStyle = "#f6f0de";
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.stroke();
    g.fill();
    g.restore();
  }
  private text(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, color: string, spacing: number, weight = 400, italic = false) {
    g.save();
    g.font = `${weight} ${size}px ${SERIF}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    (g as unknown as { letterSpacing: string }).letterSpacing = `${spacing}em`;
    if (italic) g.transform(1, 0, -0.18, 1, y * 0.18, 0);
    g.lineJoin = "round";
    g.lineWidth = 3.5;
    g.strokeStyle = "rgba(243,238,221,0.92)";
    g.strokeText(t, x, y);
    g.fillStyle = color;
    g.fillText(t, x, y);
    g.restore();
  }
  private vertical(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, color: string, italic = false) {
    const chars = [...t], step = size * 1.25, y0 = y - ((chars.length - 1) * step) / 2;
    chars.forEach((ch, i) => this.text(g, ch, x, y0 + i * step, size, color, 0, 500, italic));
  }
  private shield(g: CanvasRenderingContext2D, x: number, y: number, t: string) {
    // prefectural route marker: a blue hexagon (kikko) with the number in white
    const r = 10;
    g.save();
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      g.lineTo(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = "#28589a";
    g.strokeStyle = "#f6f0de";
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
    g.font = `600 10px system-ui, sans-serif`;
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(t, x, y + 0.5);
    g.restore();
    void PAPER;
  }
}
