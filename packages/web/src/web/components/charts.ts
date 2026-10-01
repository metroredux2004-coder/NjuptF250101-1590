import { BOX, LAYER_COUNT, type Sim } from "../lib/sim";

const GRID = "#1e252d";
const TXT = "#7d8a98";
const MONO = "11px 'IBM Plex Mono', monospace";

function setup(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function speedColor(v: number, vmax: number) {
  const t = Math.min(1, v / vmax);
  const hue = 220 - 220 * t;
  return `hsl(${hue} 95% ${45 + 15 * t}%)`;
}

export function drawBox(c: HTMLCanvasElement, sim: Sim, accent: string) {
  const { ctx, w, h } = setup(c);
  const s = Math.min(w, h) / BOX;
  const ox = (w - BOX * s) / 2;
  const oy = (h - BOX * s) / 2;
  ctx.fillStyle = "#07090b";
  ctx.fillRect(ox, oy, BOX * s, BOX * s);
  const vmax = 3 * Math.sqrt(sim.p.T);
  const r = Math.max(1.2, sim.p.radius * s);
  for (let i = 0; i < sim.n; i++) {
    const v = Math.hypot(sim.vx[i], sim.vy[i]);
    ctx.fillStyle = speedColor(v, vmax);
    ctx.beginPath();
    ctx.arc(ox + sim.x[i] * s, oy + (BOX - sim.y[i]) * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // walls glow
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  if (sim.p.shear) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + BOX * s, oy);
    ctx.moveTo(ox, oy + BOX * s);
    ctx.lineTo(ox + BOX * s, oy + BOX * s);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#3a4552";
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox, oy + BOX * s);
    ctx.moveTo(ox + BOX * s, oy);
    ctx.lineTo(ox + BOX * s, oy + BOX * s);
    ctx.stroke();
    ctx.setLineDash([]);
    // layer velocity arrows
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    const maxU = Math.max(1, sim.p.flowU);
    for (let l = 0; l < LAYER_COUNT; l++) {
      const y = oy + BOX * s - ((l + 0.5) / LAYER_COUNT) * BOX * s;
      const len = (sim.profile[l] / maxU) * BOX * s * 0.18;
      const x0 = ox + 8;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y);
      ctx.lineTo(x0 + len - Math.sign(len) * 4, y - 3);
      ctx.moveTo(x0 + len, y);
      ctx.lineTo(x0 + len - Math.sign(len) * 4, y + 3);
      ctx.stroke();
    }
  } else {
    ctx.strokeRect(ox, oy, BOX * s, BOX * s);
  }
}

function axes(ctx: CanvasRenderingContext2D, w: number, h: number, pad: number[], xl: string, yl: string) {
  const [l, r, t, b] = pad;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = t + ((h - t - b) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(l, y);
    ctx.lineTo(w - r, y);
    ctx.stroke();
  }
  ctx.fillStyle = TXT;
  ctx.font = MONO;
  ctx.fillText(xl, w - r - ctx.measureText(xl).width, h - 4);
  ctx.fillText(yl, l, t - 4);
}

export function drawHist(c: HTMLCanvasElement, sim: Sim, accent: string) {
  const { ctx, w, h } = setup(c);
  const pad = [8, 8, 16, 18];
  axes(ctx, w, h, pad, "speed v", "f(v)");
  const sp = sim.speeds();
  const T = sim.p.shear ? sim.temperature() : sim.temperature();
  const vmax = 4 * Math.sqrt(Math.max(sim.p.T, T));
  const bins = 30;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of sp) {
    const b = Math.floor((v / vmax) * bins);
    if (b >= 0 && b < bins) counts[b]++;
  }
  const dv = vmax / bins;
  const dens = counts.map((c2) => c2 / (sim.n * dv));
  // 2D Maxwell–Boltzmann: f(v) = (v/T) exp(-v²/2T)
  const f = (v: number) => (v / T) * Math.exp((-v * v) / (2 * T));
  const peak = Math.max(f(Math.sqrt(T)) * 1.25, ...dens);
  const pw = w - pad[0] - pad[1];
  const ph = h - pad[2] - pad[3];
  ctx.fillStyle = accent + "88";
  for (let i = 0; i < bins; i++) {
    const bh = (dens[i] / peak) * ph;
    ctx.fillRect(pad[0] + (i * pw) / bins + 0.5, pad[2] + ph - bh, pw / bins - 1, bh);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const v = (i / 100) * vmax;
    const X = pad[0] + (i / 100) * pw;
    const Y = pad[2] + ph - (f(v) / peak) * ph;
    if (i) ctx.lineTo(X, Y);
    else ctx.moveTo(X, Y);
  }
  ctx.stroke();
  ctx.fillStyle = TXT;
  ctx.font = MONO;
  ctx.fillText(`— Maxwell (T=${T.toFixed(2)})`, w - 150, pad[2] + 12);
}

export function drawPressure(c: HTMLCanvasElement, sim: Sim, accent: string) {
  const { ctx, w, h } = setup(c);
  const pad = [8, 8, 16, 18];
  axes(ctx, w, h, pad, "time", "P(t)");
  const hist = sim.history;
  if (hist.length < 2) return;
  const pw = w - pad[0] - pad[1];
  const ph = h - pad[2] - pad[3];
  const max = Math.max(...hist.map((s) => Math.max(s.P, s.Pideal, s.Phd))) * 1.15 || 1;
  const t0 = hist[0].t;
  const t1 = hist[hist.length - 1].t;
  const X = (t: number) => pad[0] + ((t - t0) / Math.max(t1 - t0, 1e-6)) * pw;
  const Y = (p: number) => pad[2] + ph - (p / max) * ph;
  const line = (key: "P" | "Pideal" | "Phd", color: string, dash: number[] = []) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.lineWidth = key === "P" ? 1.8 : 1.2;
    ctx.beginPath();
    hist.forEach((s, i) => (i ? ctx.lineTo(X(s.t), Y(s[key])) : ctx.moveTo(X(s.t), Y(s[key]))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line("Pideal", "rgba(255,255,255,0.6)", [5, 4]);
  if (sim.packing > 0.02) line("Phd", "rgba(140,255,170,0.6)", [2, 3]);
  line("P", accent);
  ctx.font = MONO;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText("- - nkT ideal", w - 110, pad[2] + 12);
  if (sim.packing > 0.02) {
    ctx.fillStyle = "rgba(140,255,170,0.8)";
    ctx.fillText("··· hard-disk EOS", w - 130, pad[2] + 26);
  }
}

export function drawProfile(c: HTMLCanvasElement, sim: Sim, accent: string) {
  const { ctx, w, h } = setup(c);
  const pad = [8, 8, 16, 18];
  const pw = w - pad[0] - pad[1];
  const ph = h - pad[2] - pad[3];
  if (sim.p.shear) {
    axes(ctx, w, h, pad, "height y", "layer drift u(y)");
    const max = Math.max(1, sim.p.flowU) * 1.3;
    const draw = (arr: number[], color: string, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      arr.forEach((u, l) => {
        const X = pad[0] + ((l + 0.5) / arr.length) * pw;
        const Y = pad[2] + ph - (u / max) * ph * 0.9 - ph * 0.05;
        if (l) ctx.lineTo(X, Y);
        else ctx.moveTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    draw(sim.initProfile, "rgba(255,255,255,0.45)", [4, 4]);
    draw(sim.profile, accent);
    ctx.fillStyle = TXT;
    ctx.font = MONO;
    ctx.fillText("- - initial", w - 80, pad[2] + 12);
    return;
  }
  // wall pressure by segment (left & right walls)
  axes(ctx, w, h, pad, "wall position", "P per wall segment");
  const seg = sim.segPressure();
  const half = seg.length / 2;
  const vals = seg.slice(0, half).map((v, i) => (v + seg[half + i]) / 2);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length || 1;
  const max = Math.max(...vals, mean) * 1.25 || 1;
  vals.forEach((v, i) => {
    const bh = (v / max) * ph;
    ctx.fillStyle = accent + "aa";
    ctx.fillRect(pad[0] + (i * pw) / half + 2, pad[2] + ph - bh, pw / half - 4, bh);
  });
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad[0], pad[2] + ph - (mean / max) * ph);
  ctx.lineTo(w - pad[1], pad[2] + ph - (mean / max) * ph);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawShearWall(c: HTMLCanvasElement, sim: Sim, accent: string) {
  // used in shear mode: pressure along top/bottom wall segments
  const { ctx, w, h } = setup(c);
  const pad = [8, 8, 16, 18];
  axes(ctx, w, h, pad, "x along wall", "P on top/bottom wall");
  const seg = sim.segPressure();
  const half = seg.length / 2;
  const pw = w - pad[0] - pad[1];
  const ph = h - pad[2] - pad[3];
  const max = Math.max(...seg) * 1.25 || 1;
  for (let i = 0; i < half; i++) {
    const bw = pw / half;
    const b1 = (seg[i] / max) * ph;
    const b2 = (seg[half + i] / max) * ph;
    ctx.fillStyle = accent + "aa";
    ctx.fillRect(pad[0] + i * bw + 2, pad[2] + ph - b1, bw / 2 - 3, b1);
    ctx.fillStyle = accent + "55";
    ctx.fillRect(pad[0] + i * bw + bw / 2, pad[2] + ph - b2, bw / 2 - 3, b2);
  }
}
