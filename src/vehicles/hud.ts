/** Period instrument cluster: real speed and session distance, no fictional RPM. */
export class DrivingHud {
  private needle: SVGElement;
  private odometer: SVGElement;
  private trip: SVGElement;
  private speed: HTMLElement;
  private gear: SVGElement;
  constructor(root: HTMLElement) {
    const point = (angle: number, radius: number) => [116 + Math.cos(angle * Math.PI / 180) * radius, 112 + Math.sin(angle * Math.PI / 180) * radius];
    const ticks: string[] = [], labels: string[] = [];
    for (let value = 0; value <= 140; value += 2) {
      const angle = 140 + value / 140 * 260, major = value % 20 === 0, medium = value % 10 === 0;
      const a = point(angle, 96), b = point(angle, major ? 84 : medium ? 88 : 92);
      ticks.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${value === 30 || value === 50 ? '#c34136' : '#d4e7de'}" stroke-width="${major ? 3 : medium ? 2 : 1}"/>`);
      if (major) { const p = point(angle, 70); labels.push(`<text x="${p[0]}" y="${p[1] + 5}" class="dial-number">${value}</text>`); }
    }
    root.innerHTML = `<svg viewBox="0 0 232 238" role="img" aria-label="アナログ速度計、0から140キロ毎時">
      <defs>
        <radialGradient id="dial-face"><stop offset="0" stop-color="#253032"/><stop offset=".75" stop-color="#142024"/><stop offset="1" stop-color="#0a1215"/></radialGradient>
        <linearGradient id="dial-rim" x2=".8" y2="1"><stop stop-color="#374448"/><stop offset=".45" stop-color="#0a1012"/><stop offset="1" stop-color="#263237"/></linearGradient>
        <linearGradient id="dial-reflection" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b7d5dc" stop-opacity=".14"/><stop offset=".46" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#fff" stop-opacity=".045"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <linearGradient id="lcd-face" x2="0" y2="1"><stop stop-color="#8faba0"/><stop offset="1" stop-color="#709288"/></linearGradient>
      </defs>
      <circle cx="116" cy="112" r="108" fill="url(#dial-rim)" stroke="#080e11" stroke-width="3"/>
      <circle cx="116" cy="112" r="101" fill="url(#dial-face)" stroke="#495659" stroke-width="1"/>
      <g>${ticks.join("")}${labels.join("")}</g>
      <text x="62" y="148" class="dial-unit">km/h</text>
      <rect x="68" y="163" width="98" height="39" rx="2" fill="url(#lcd-face)" stroke="#081214" stroke-width="3"/>
      <text id="vehicle-odometer" x="159" y="181" class="dial-odometer">00000.0</text>
      <text x="75" y="195" class="dial-trip-label">TRIP</text><text id="vehicle-trip" x="158" y="196" class="dial-trip">0.0</text>
      <circle cx="116" cy="112" r="13" fill="#0b1012" stroke="#3c4849" stroke-width="2"/>
      <g id="vehicle-needle" transform="rotate(140 116 112)"><path d="M 100 110 L 191 109 L 201 112 L 191 114 L 100 115 Z" fill="#e43c31" stroke="#78211e" stroke-width=".8"/><path d="M 116 110 L 194 111" stroke="#ff7761" stroke-width="1"/></g>
      <circle cx="116" cy="112" r="6" fill="#171b1b"/>
      <text id="vehicle-gear" x="116" y="146" class="dial-gear">D</text>
      <circle cx="116" cy="112" r="100" fill="url(#dial-reflection)"/>
      <circle cx="36" cy="190" r="7" fill="#131b1d" stroke="#344247" stroke-width="2"/>
    </svg>
    <span id="vehicle-speed" class="visually-hidden">0</span>
    <div class="dial-controls"><span>V <span id="vehicle-view">三人称</span></span><span>E 降車</span></div>
    <output id="vehicle-notice" aria-live="polite"></output>`;
    this.needle = root.querySelector("#vehicle-needle")!;
    this.odometer = root.querySelector("#vehicle-odometer")!;
    this.trip = root.querySelector("#vehicle-trip")!;
    this.speed = root.querySelector("#vehicle-speed")!;
    this.gear = root.querySelector("#vehicle-gear")!;
  }
  update(metresPerSecond: number, distance: number) {
    const speed = Math.abs(metresPerSecond) * 3.6;
    this.needle.setAttribute("transform", `rotate(${140 + Math.min(140, speed) / 140 * 260} 116 112)`);
    this.speed.textContent = String(Math.round(speed));
    this.gear.textContent = metresPerSecond < -.3 ? "R" : "D";
    this.odometer.textContent = (distance / 1000).toFixed(1).padStart(7, "0");
    this.trip.textContent = (distance / 1000).toFixed(1);
  }
}
