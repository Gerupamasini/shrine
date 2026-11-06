import { publicUrl } from "./urls";
import * as T from "three";
export class Materials {
  loader = new T.TextureLoader();
  cache = new Map<string, T.MeshStandardMaterial>();
  wind = { value: 0 };
  textures: T.Texture[] = [];
  pending: Promise<string | null>[] = [];
  texture(url: string) {
    let t!: T.Texture;
    this.pending.push(
      new Promise((resolve) => {
        t = this.loader.load(
          url,
          () => resolve(null),
          undefined,
          () => resolve(url),
        );
      }),
    );
    return t;
  }
  async ready() {
    const errors = (await Promise.all(this.pending)).filter(Boolean);
    if (errors.length)
      throw new Error("Texture decode/load failed: " + errors.join(", "));
  }

  constructor(private renderer: T.WebGLRenderer) {}
  get(name: string) {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const colors: Record<string, number> = {
      fern: 0x667d47,
      wood: 0xb8a58d,
      darkwood: 0x695b47,
      stone: 0xb3b5a9,
      roof: 0x8e9894,
      thatch: 0xc3b391,
      vermilion: 0x993e2c,
      paper: 0xbeb49c,
      bark: 0xb5a590,
      leaf: 0x8ba56e,
      leafLOD: 0x536d3e,
      broadleaf: 0x96ae75,
      metal: 0x727e7d,
      soil: 0xd7d1b5,
    };
    const m = new T.MeshStandardMaterial({
      color: colors[name] ?? 0x888888,
      roughness: 0.94,
      side: ["leaf", "broadleaf", "leafLOD", "roof", "thatch", "fern"].includes(
        name,
      )
        ? T.DoubleSide
        : T.FrontSide,
    });
    m.name = name;
    const texName = name === "darkwood" ? "wood" : name;
    if (["soil", "wood", "stone", "roof", "thatch", "bark"].includes(texName)) {
      const tex = (suffix: string, srgb = false) => {
        const t = this.texture(publicUrl(`assets/${texName}-${suffix}`));
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
        t.anisotropy = Math.min(
          8,
          this.renderer.capabilities.getMaxAnisotropy(),
        );
        if (name === "soil") t.repeat.set(650, 650);
        this.textures.push(t);
        return t;
      };
      m.map = tex("albedo.jpg", true);
      m.normalMap = tex("normal.png");
      m.normalScale.set(0.45, 0.45);
      m.roughnessMap = tex("roughness.jpg");
    }
    if (name === "leaf" || name === "broadleaf") {
      const t = this.texture(
        publicUrl(
          "assets/" + (name === "leaf" ? "cedar-spray.png" : "broadleaf.png"),
        ),
      );
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.push(t);
      m.map = t;
      m.alphaTest = 0.3;
      m.shadowSide = T.DoubleSide;
    }
    if (["leaf", "leafLOD", "broadleaf", "fern"].includes(name)) {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.windTime = this.wind;
        shader.vertexShader = "uniform float windTime;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n transformed.x += sin(windTime*0.8+position.y*1.3+position.z)*0.055*max(0.0,position.y-3.0)/15.0;",
        );
      };
      m.customProgramCacheKey = () => "leaf-wind-v1";
    }
    if (name === "soil" || name === "moss") {
      const base = name === "moss" ? "Ground103" : "Ground048";
      const tex = (suffix: string, srgb = false) => {
        const t = this.texture(publicUrl(`assets/pbr/${base}-${suffix}.jpg`));
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.repeat.set(650, 650);
        t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
        t.anisotropy = 8;
        this.textures.push(t);
        return t;
      };
      m.color.set(0xb9b8a6);
      m.map = tex("Color", true);
      m.normalMap = tex("NormalGL");
      m.roughnessMap = tex("Roughness");
      m.normalScale.set(0.18, 0.18);
    }
    if (name === "moss") {
      const t = this.texture(publicUrl("assets/botanical/grass-ground.jpg"));
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(260, 260);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 8;
      m.map = t;
      m.color.set(0xe3dfc2);
    }
    if (name === "vermilion") {
      m.map = this.get("wood").map;
      m.normalMap = this.get("wood").normalMap;
      m.normalScale.set(0.11, 0.11);
      m.color.set(0xb95d43);
    }
    if (name === "photobark") {
      const load = (channel: string, srgb = false) => {
        const t = this.texture(
          publicUrl(`assets/botanical/pine-bark-${channel}.jpg`),
        );
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
        t.repeat.set(1, 3);
        this.textures.push(t);
        return t;
      };
      m.color.set(0xa69b87);
      m.map = load("Color", true);
      m.normalMap = load("NormalGL");
      m.roughnessMap = load("Roughness");
      m.normalScale.set(0.65, 0.65);
    }
    if (name === "pine-leaves" || name === "oak-leaves") {
      const t = this.texture(
        publicUrl(
          `assets/botanical/${name === "pine-leaves" ? "pine" : "oak"}.png`,
        ),
      );
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.push(t);
      m.map = t;
      m.color.set(name === "pine-leaves" ? 0xa0ad8c : 0xa5b082);
      m.alphaTest = 0.35;
      m.side = T.DoubleSide;
      m.roughness = 1;
      m.onBeforeCompile = (s) => {
        s.uniforms.windTime = this.wind;
        s.vertexShader = "uniform float windTime;\n" + s.vertexShader;
        s.vertexShader = s.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n transformed.x += sin(windTime*.7 + position.y*.35+position.z)*.035*max(0.0,position.y-2.0);",
        );
      };
      m.customProgramCacheKey = () => name + "-v2";
    }
    if (name === "glass") {
      m.color.set(0x283a39);
      m.roughness = 0.22;
      m.metalness = 0.2;
    }
    if (name === "plaster") {
      m.color.set(0xaaa38c);
      m.roughness = 1;
      m.normalMap = this.get("stone").normalMap;
      m.normalScale.set(0.08, 0.08);
    }
    this.cache.set(name, m);
    return m;
  }
}
