import * as T from "three";
import { publicUrl } from "../urls";
import type { Landscape } from "./landscape";

type SignSpec = { text: string; style: string };

/**
 * Shop and public building signs in the village centre. Each building model records where its
 * signs go (architecture/index.json, "signs": [x, y, z, w, h, vertical] in model space); the texts
 * come from scene.json. The lettering is drawn on canvases with a subset of Noto Serif JP Bold
 * (SIL OFL, only the glyphs the signs use), so no text is baked into the models.
 *  - board:  cream enamel board, black brush lettering (shops, JA)
 *  - post:   white board, red postal mark, black lettering
 *  - plate:  white vertical enamel plate (police box)
 *  - wood:   vertical wooden board, ink lettering (community hall)
 *  - tabako: the red tobacco plate
 */
export class Signs {
  async load(land: Landscape) {
    const objects = land.world.data.objects.filter((o) => Array.isArray(o.signs));
    if (!objects.length) return;
    const index = await fetch(publicUrl("assets/models/architecture/index.json")).then((r) => r.json());
    try {
      const face = new FontFace("SignSerif", `url(${publicUrl("assets/fonts/signs-noto-serif-jp.ttf")})`, { weight: "700" });
      await face.load();
      (document.fonts as unknown as { add(f: FontFace): void }).add(face);
    } catch (e) {
      console.warn("sign font unavailable, using the system serif", e);
    }
    const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const o of objects) {
      const anchors = (index.assets?.[o.asset]?.signs ?? []) as number[][];
      const specs = o.signs as SignSpec[];
      specs.forEach((spec, i) => {
        const a = anchors[i];
        if (!a) return;
        const [lx, ly, lz, w, h, vertical] = a;
        const tex = drawSign(spec, w, h, !!vertical, rng(Math.floor(Math.abs(o.position[0] * 131 + o.position[2] * 17 + i * 7)) + 11));
        tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = 4;
        const mat = land.lib.finish(new T.MeshStandardMaterial({ map: tex, roughness: spec.style === "tabako" ? 0.45 : 0.7, metalness: 0.0 }));
        const mesh = new T.Mesh(new T.PlaneGeometry(w, h), mat);
        const yaw = o.rotation[1], c = Math.cos(yaw), s = Math.sin(yaw);
        mesh.position.set(o.position[0] + lx * c + lz * s, o.position[1] + ly, o.position[2] - lx * s + lz * c);
        mesh.rotation.y = yaw;
        mesh.receiveShadow = true;
        land.scene.add(mesh);
      });
    }
  }
}

function drawSign(spec: SignSpec, w: number, h: number, vertical: boolean, rnd: () => number) {
  const PX = 256;
  const cw = Math.round(Math.max(w / Math.min(w, h), 1) * PX), ch = Math.round(Math.max(h / Math.min(w, h), 1) * PX);
  const cv = document.createElement("canvas");
  cv.width = Math.min(cw, 2048);
  cv.height = Math.min(ch, 2048);
  const g = cv.getContext("2d")!;
  const styles: Record<string, { bg: string; ink: string; border: string }> = {
    board: { bg: "#ebe4d0", ink: "#1b1916", border: "#3a2d22" },
    post: { bg: "#f1efe8", ink: "#1c1c1c", border: "#b8231b" },
    plate: { bg: "#eeeee8", ink: "#141414", border: "#5a5a5a" },
    wood: { bg: "#9a7a55", ink: "#2a1a0e", border: "#5b432c" },
    tabako: { bg: "#c4241b", ink: "#f6f1e6", border: "#f6f1e6" },
  };
  const st = styles[spec.style] ?? styles.board;
  g.fillStyle = st.bg;
  g.fillRect(0, 0, cv.width, cv.height);
  // weathering: soft blotches, rust streaks from the top edge, wood grain on the board
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${spec.style === "wood" ? "60,40,20" : "90,80,60"},${0.03 + rnd() * 0.05})`;
    g.beginPath();
    g.ellipse(rnd() * cv.width, rnd() * cv.height, 8 + rnd() * cv.width * 0.12, 6 + rnd() * cv.height * 0.12, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  if (spec.style === "wood")
    for (let y = 0; y < cv.height; y += 3 + rnd() * 5) {
      g.strokeStyle = `rgba(50,32,16,${0.08 + rnd() * 0.1})`;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(cv.width * 0.3, y + rnd() * 6 - 3, cv.width * 0.7, y + rnd() * 6 - 3, cv.width, y);
      g.stroke();
    }
  for (let i = 0; i < 6; i++) {
    const x = rnd() * cv.width, len = cv.height * (0.15 + rnd() * 0.4);
    const grd = g.createLinearGradient(x, 0, x, len);
    grd.addColorStop(0, "rgba(110,60,25,0.25)");
    grd.addColorStop(1, "rgba(110,60,25,0)");
    g.fillStyle = grd;
    g.fillRect(x, 0, 2 + rnd() * 4, len);
  }
  const bw = Math.max(4, Math.min(cv.width, cv.height) * 0.05);
  g.strokeStyle = st.border;
  g.lineWidth = bw;
  g.strokeRect(bw / 2, bw / 2, cv.width - bw, cv.height - bw);
  g.fillStyle = st.ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const font = (px: number) => `700 ${px}px SignSerif, "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif`;
  let text = spec.text;
  if (spec.style === "post") {
    // the postal mark in red, then the name
    const mark = text.startsWith("〒") ? "〒" : "";
    text = text.replace("〒", "").trim();
    const size = cv.height * 0.62;
    g.font = font(size);
    const markW = mark ? size * 1.1 : 0;
    const tw = Math.min(g.measureText(text).width, cv.width - markW - bw * 6);
    const x0 = (cv.width - (tw + markW)) / 2;
    if (mark) {
      g.fillStyle = "#c8231a";
      g.fillText(mark, x0 + markW / 2, cv.height * 0.52);
    }
    g.fillStyle = st.ink;
    g.fillText(text, x0 + markW + tw / 2, cv.height * 0.53, cv.width - markW - bw * 6);
  } else if (vertical) {
    const chars = [...text.replace(/\s+/g, "")];
    const step = (cv.height - bw * 6) / chars.length;
    const size = Math.min(step * 0.9, cv.width * 0.72);
    g.font = font(size);
    chars.forEach((c, i) => g.fillText(c, cv.width / 2, bw * 3 + step * (i + 0.5)));
  } else {
    const size = cv.height * (spec.style === "tabako" ? 0.56 : 0.62);
    g.font = font(size);
    const chars = [...text];
    // spread the letters across the board as sign painters do
    const avail = cv.width - bw * 8;
    const natural = g.measureText(text).width;
    if (natural < avail * 0.85 && !text.includes(" ")) {
      const step = Math.min(avail / chars.length, size * 1.5);
      const x0 = (cv.width - step * chars.length) / 2;
      chars.forEach((c, i) => g.fillText(c, x0 + step * (i + 0.5), cv.height * 0.53));
    } else g.fillText(text, cv.width / 2, cv.height * 0.53, avail);
  }
  const t = new T.CanvasTexture(cv);
  t.generateMipmaps = true;
  t.minFilter = T.LinearMipmapLinearFilter;
  return t;
}
