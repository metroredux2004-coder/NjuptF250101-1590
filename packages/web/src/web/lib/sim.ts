// 2D hard-disk molecular dynamics. Units: m = 1, k_B = 1.
// 2D pressure = force per unit wall length.

export type Params = {
  N: number;
  T: number; // initial / thermostat temperature
  radius: number;
  restitution: number; // 1 = elastic, <1 = inelastic (molecule-molecule)
  attraction: number; // strength of short-range attraction (0 = off)
  thermostat: boolean; // gently rescale to target T
  shear: boolean; // shear-flow mode: periodic x, slow at walls / fast in center
  flowU: number; // centre drift speed in shear mode
  viscosity: number; // extra viscous coupling between layers (gamma)
  noSlip: boolean; // diffuse thermal walls (top/bottom) in shear mode
  speed: number; // substeps per frame
};

export const defaultParams: Params = {
  N: 300,
  T: 1,
  radius: 0.6,
  restitution: 1,
  attraction: 0,
  thermostat: false,
  shear: false,
  flowU: 2.5,
  viscosity: 0,
  noSlip: false,
  speed: 4,
};

export const BOX = 100;
const DT = 0.02;
const LAYERS = 12;
const SEG = 8;

export type Sample = { t: number; P: number; Pideal: number; Phd: number; T: number; rate: number; imp: number };

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Sim {
  p: Params;
  n = 0;
  x = new Float64Array(0);
  y = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  t = 0;
  // accumulators for current sample window
  winImp = 0;
  winHits = 0;
  winT0 = 0;
  wallImp = new Float64Array(4); // L R B T
  segImp = new Float64Array(SEG * 2); // segments along measured walls
  shearImp = 0; // tangential momentum given to walls
  segT0 = 0;
  history: Sample[] = [];
  initProfile: number[] = [];
  profile: number[] = Array.from({ length: LAYERS }, () => 0);
  collisions = 0;
  totalImp = 0;
  totalHits = 0;
  // cell list
  private cellSize = 2;
  private cols = 1;
  private head = new Int32Array(0);
  private next = new Int32Array(0);

  constructor(p: Params) {
    this.p = { ...p };
    this.reset();
  }

  get area() {
    return BOX * BOX;
  }
  get sigma() {
    return 2 * this.p.radius;
  }
  get range() {
    return this.p.attraction > 0 ? this.sigma * 2.5 : this.sigma;
  }
  get packing() {
    return (this.n * Math.PI * this.p.radius ** 2) / this.area;
  }

  reset() {
    const { N, T, radius } = this.p;
    this.n = N;
    this.x = new Float64Array(N);
    this.y = new Float64Array(N);
    this.vx = new Float64Array(N);
    this.vy = new Float64Array(N);
    // place on jittered lattice to avoid overlaps
    const side = Math.ceil(Math.sqrt(N));
    const gap = BOX / side;
    const jitter = Math.max(0, gap / 2 - radius - 0.01);
    const order = [...Array(side * side).keys()].sort(() => Math.random() - 0.5);
    const s = Math.sqrt(T);
    for (let i = 0; i < N; i++) {
      const k = order[i];
      const cx = (k % side) + 0.5;
      const cy = Math.floor(k / side) + 0.5;
      this.x[i] = cx * gap + (Math.random() * 2 - 1) * jitter;
      this.y[i] = cy * gap + (Math.random() * 2 - 1) * jitter;
      this.vx[i] = gauss() * s;
      this.vy[i] = gauss() * s;
    }
    if (this.p.shear) {
      // slower molecules near walls, faster in the centre: Poiseuille-like drift
      for (let i = 0; i < N; i++) {
        const yy = (2 * this.y[i]) / BOX - 1;
        const prof = 1 - yy * yy;
        this.vx[i] = this.vx[i] * (0.4 + 0.6 * prof) + this.p.flowU * prof;
        this.vy[i] *= 0.4 + 0.6 * prof;
      }
    }
    this.t = 0;
    this.history = [];
    this.collisions = 0;
    this.totalImp = 0;
    this.totalHits = 0;
    this.resetWindow();
    this.clearSegments();
    this.computeProfile();
    this.initProfile = [...this.profile];
  }

  update(p: Params) {
    const needsReset =
      p.N !== this.p.N || p.shear !== this.p.shear || p.radius !== this.p.radius || p.flowU !== this.p.flowU;
    const tChanged = p.T !== this.p.T;
    const oldT = this.p.T;
    this.p = { ...p };
    if (needsReset) this.reset();
    else if (tChanged && !p.thermostat) {
      // rescale speeds instantly for a temperature change
      const f = Math.sqrt(p.T / oldT);
      for (let i = 0; i < this.n; i++) {
        this.vx[i] *= f;
        this.vy[i] *= f;
      }
    }
  }

  private resetWindow() {
    this.winImp = 0;
    this.winHits = 0;
    this.winT0 = this.t;
  }

  temperature() {
    // remove layer drift in shear mode so T is the thermal part
    let ke = 0;
    if (this.p.shear) {
      for (let i = 0; i < this.n; i++) {
        const l = Math.min(LAYERS - 1, Math.max(0, Math.floor((this.y[i] / BOX) * LAYERS)));
        const dvx = this.vx[i] - this.profile[l];
        ke += dvx * dvx + this.vy[i] * this.vy[i];
      }
    } else {
      for (let i = 0; i < this.n; i++) ke += this.vx[i] ** 2 + this.vy[i] ** 2;
    }
    return ke / (2 * this.n); // 2D: KE = N kT
  }

  speeds() {
    const out = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) out[i] = Math.hypot(this.vx[i], this.vy[i]);
    return out;
  }

  computeProfile() {
    const sum = Array.from({ length: LAYERS }, () => 0);
    const cnt = Array.from({ length: LAYERS }, () => 0);
    for (let i = 0; i < this.n; i++) {
      const l = Math.min(LAYERS - 1, Math.max(0, Math.floor((this.y[i] / BOX) * LAYERS)));
      sum[l] += this.vx[i];
      cnt[l]++;
    }
    this.profile = sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
  }

  private buildCells() {
    this.cellSize = Math.max(this.range, 2);
    this.cols = Math.max(1, Math.floor(BOX / this.cellSize));
    const nc = this.cols * this.cols;
    if (this.head.length !== nc) this.head = new Int32Array(nc);
    this.head.fill(-1);
    if (this.next.length !== this.n) this.next = new Int32Array(this.n);
    const cs = BOX / this.cols;
    for (let i = 0; i < this.n; i++) {
      const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(this.x[i] / cs)));
      const cy = Math.min(this.cols - 1, Math.max(0, Math.floor(this.y[i] / cs)));
      const c = cy * this.cols + cx;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  private pair(i: number, j: number, periodic: boolean) {
    let dx = this.x[j] - this.x[i];
    const dy = this.y[j] - this.y[i];
    if (periodic) {
      if (dx > BOX / 2) dx -= BOX;
      else if (dx < -BOX / 2) dx += BOX;
    }
    const d2 = dx * dx + dy * dy;
    const sig = this.sigma;
    const rc = this.range;
    if (d2 >= rc * rc || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    if (d < sig) {
      const dvx = this.vx[j] - this.vx[i];
      const dvy = this.vy[j] - this.vy[i];
      const vn = dvx * nx + dvy * ny;
      if (vn < 0) {
        const jimp = (-(1 + this.p.restitution) * vn) / 2;
        this.vx[i] -= jimp * nx;
        this.vy[i] -= jimp * ny;
        this.vx[j] += jimp * nx;
        this.vy[j] += jimp * ny;
        this.collisions++;
      }
      const overlap = (sig - d) / 2;
      this.x[i] -= nx * overlap;
      this.y[i] -= ny * overlap;
      this.x[j] += nx * overlap;
      this.y[j] += ny * overlap;
    } else if (this.p.attraction > 0) {
      // smooth attractive well between sigma and rc
      const f = this.p.attraction * Math.sin((Math.PI * (d - sig)) / (rc - sig)) * DT;
      this.vx[i] += f * nx;
      this.vy[i] += f * ny;
      this.vx[j] -= f * nx;
      this.vy[j] -= f * ny;
    }
  }

  private step() {
    const { radius: r, shear, noSlip, viscosity } = this.p;
    const periodic = shear;
    const n = this.n;

    // viscous force: discrete Laplacian of layer velocity (η ∂²u/∂y²)
    if (shear && viscosity > 0) {
      this.computeProfile();
      const u = this.profile;
      for (let i = 0; i < n; i++) {
        const l = Math.min(LAYERS - 1, Math.max(0, Math.floor((this.y[i] / BOX) * LAYERS)));
        const up = l < LAYERS - 1 ? u[l + 1] : noSlip ? 0 : u[l];
        const dn = l > 0 ? u[l - 1] : noSlip ? 0 : u[l];
        this.vx[i] += viscosity * (up + dn - 2 * u[l]) * DT;
      }
    }

    for (let i = 0; i < n; i++) {
      this.x[i] += this.vx[i] * DT;
      this.y[i] += this.vy[i] * DT;
    }

    // walls
    const lo = r;
    const hi = BOX - r;
    const sT = Math.sqrt(this.p.T);
    for (let i = 0; i < n; i++) {
      if (periodic) {
        if (this.x[i] < 0) this.x[i] += BOX;
        else if (this.x[i] >= BOX) this.x[i] -= BOX;
      } else {
        if (this.x[i] < lo) {
          this.x[i] = 2 * lo - this.x[i];
          if (this.vx[i] < 0) this.hit(0, -2 * this.vx[i], this.y[i]);
          this.vx[i] = Math.abs(this.vx[i]);
        } else if (this.x[i] > hi) {
          this.x[i] = 2 * hi - this.x[i];
          if (this.vx[i] > 0) this.hit(1, 2 * this.vx[i], this.y[i]);
          this.vx[i] = -Math.abs(this.vx[i]);
        }
      }
      if (this.y[i] < lo || this.y[i] > hi) {
        const bottom = this.y[i] < lo;
        this.y[i] = bottom ? 2 * lo - this.y[i] : 2 * hi - this.y[i];
        const vyOld = this.vy[i];
        if (shear && noSlip) {
          // diffuse thermal wall: re-emit with wall temperature, no drift
          const vn = Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * sT;
          const vt = gauss() * sT;
          this.shearImp += Math.abs(this.vx[i] - vt);
          const vyNew = bottom ? vn : -vn;
          this.hit(bottom ? 2 : 3, Math.abs(vyNew - vyOld), this.x[i]);
          this.vx[i] = vt;
          this.vy[i] = vyNew;
        } else {
          this.hit(bottom ? 2 : 3, 2 * Math.abs(vyOld), this.x[i]);
          this.vy[i] = bottom ? Math.abs(vyOld) : -Math.abs(vyOld);
        }
      }
    }

    // molecule-molecule
    this.buildCells();
    const cols = this.cols;
    for (let cy = 0; cy < cols; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        for (let i = this.head[cy * cols + cx]; i !== -1; i = this.next[i]) {
          for (let oy = -1; oy <= 1; oy++) {
            const ny = cy + oy;
            if (ny < 0 || ny >= cols) continue;
            for (let ox = -1; ox <= 1; ox++) {
              let nx = cx + ox;
              if (nx < 0 || nx >= cols) {
                if (!periodic || cols < 3) continue;
                nx = (nx + cols) % cols;
              }
              for (let j = this.head[ny * cols + nx]; j !== -1; j = this.next[j]) {
                if (j > i) this.pair(i, j, periodic);
              }
            }
          }
        }
      }
    }

    // thermostat (Berendsen-type, gentle)
    if (this.p.thermostat) {
      const Tn = this.temperature();
      if (Tn > 0) {
        const lam = Math.sqrt(1 + 0.02 * (this.p.T / Tn - 1));
        for (let i = 0; i < n; i++) {
          this.vx[i] *= lam;
          this.vy[i] *= lam;
        }
      }
    }
    this.t += DT;
  }

  private hit(wall: number, imp: number, pos: number) {
    this.winImp += imp;
    this.winHits++;
    this.totalImp += imp;
    this.totalHits++;
    this.wallImp[wall] += imp;
    // segment distribution: left/right walls along y, or top/bottom along x in shear mode
    if (this.p.shear ? wall >= 2 : wall <= 1) {
      const s = Math.min(SEG - 1, Math.max(0, Math.floor((pos / BOX) * SEG)));
      this.segImp[(wall % 2) * SEG + s] += imp;
    }
  }

  measuredWallLength() {
    return this.p.shear ? 2 * BOX : 4 * BOX;
  }

  advance(frames = 1) {
    const steps = this.p.speed * frames;
    for (let s = 0; s < steps; s++) this.step();
    this.computeProfile();
    if (this.t - this.winT0 >= 1.0) this.sample();
  }

  private sample() {
    const dt = this.t - this.winT0;
    const L = this.measuredWallLength();
    const P = this.winImp / (L * dt);
    const T = this.temperature();
    const rho = this.n / this.area;
    const eta = this.packing;
    // hard-disk equation of state (Henderson)
    const Z = (1 + (eta * eta) / 8) / (1 - eta) ** 2;
    this.history.push({
      t: this.t,
      P,
      Pideal: rho * T,
      Phd: rho * T * Z,
      T,
      rate: this.winHits / (L * dt),
      imp: this.winHits ? this.winImp / this.winHits : 0,
    });
    if (this.history.length > 400) this.history.shift();
    this.resetWindow();
  }

  stats() {
    const h = this.history.slice(-40);
    const mean = h.length ? h.reduce((a, b) => a + b.P, 0) / h.length : 0;
    const sd = h.length > 1 ? Math.sqrt(h.reduce((a, b) => a + (b.P - mean) ** 2, 0) / (h.length - 1)) : 0;
    const last = this.history[this.history.length - 1];
    const T = this.temperature();
    return {
      P: mean,
      sd,
      rel: mean ? sd / mean : 0,
      T,
      Pideal: (this.n / this.area) * T,
      Phd: last?.Phd ?? 0,
      Z: mean && T ? (mean * this.area) / (this.n * T) : 0,
      rate: last?.rate ?? 0,
      imp: last?.imp ?? 0,
      eta: this.packing,
      t: this.t,
    };
  }

  segPressure() {
    const L = BOX / SEG;
    const dt = Math.max(this.t - this.segT0, 1e-6);
    return Array.from(this.segImp, (v) => v / (L * dt));
  }

  clearSegments() {
    this.segImp.fill(0);
    this.wallImp.fill(0);
    this.shearImp = 0;
    this.segT0 = this.t;
  }
}

export const LAYER_COUNT = LAYERS;
export const SEG_COUNT = SEG;
