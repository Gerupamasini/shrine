import * as T from "three";
export class Materials {
  loader = new T.TextureLoader();
  cache = new Map<string, T.MeshStandardMaterial>();
  wind = { value: 0 };
  textures: T.Texture[] = [];
  constructor(private renderer: T.WebGLRenderer) {}
  get(name: string) {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const colors: Record<string, number> = {
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
      side: ["leaf", "broadleaf", "leafLOD", "roof", "thatch"].includes(name)
        ? T.DoubleSide
        : T.FrontSide,
    });
    m.name = name;
    const texName = name === "darkwood" ? "wood" : name;
    if (["soil", "wood", "stone", "roof", "thatch", "bark"].includes(texName)) {
      const tex = (suffix: string, srgb = false) => {
        const t = this.loader.load(`/assets/${texName}-${suffix}`);
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
        t.anisotropy = Math.min(
          8,
          this.renderer.capabilities.getMaxAnisotropy(),
        );
        if (name === "soil") t.repeat.set(180, 180);
        this.textures.push(t);
        return t;
      };
      m.map = tex("albedo.jpg", true);
      m.normalMap = tex("normal.png");
      m.normalScale.set(0.45, 0.45);
      m.roughnessMap = tex("roughness.jpg");
    }
    if (name === "leaf" || name === "broadleaf") {
      const t = this.loader.load(
        "/assets/" + (name === "leaf" ? "cedar-spray.png" : "broadleaf.png"),
      );
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.push(t);
      m.map = t;
      m.alphaTest = 0.13;
      m.shadowSide = T.DoubleSide;
    }
    if (["leaf", "leafLOD", "broadleaf"].includes(name)) {
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
      const base = name === "moss" ? "Moss002" : "Ground048";
      const tex = (suffix: string, srgb = false) => {
        const t = this.loader.load(`/assets/pbr/${base}-${suffix}.jpg`);
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.repeat.set(180, 180);
        t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
        t.anisotropy = 8;
        this.textures.push(t);
        return t;
      };
      m.color.set(0xb9b8a6);
      m.map = tex("Color", true);
      m.normalMap = tex("NormalGL");
      m.roughnessMap = tex("Roughness");
      m.normalScale.set(0.65, 0.65);
    }
    this.cache.set(name, m);
    return m;
  }
}
