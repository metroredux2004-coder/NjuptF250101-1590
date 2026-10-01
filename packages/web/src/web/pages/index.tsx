import { useCallback, useRef, useState } from "react";
import { SimPanel, type Stats } from "../components/sim-panel";
import { defaultParams, type Params } from "../lib/sim";

type Preset = { id: string; title: string; note: string; a: Partial<Params>; b: Partial<Params> };

const PRESETS: Preset[] = [
  {
    id: "maxwell",
    title: "1 · Maxwell & temperature",
    note: "Same N, different T. Hotter gas: the speed distribution widens and shifts right. Each wall hit carries more impulse (∝√T), and hits come more often (∝√T), so P ∝ T.",
    a: { T: 1 },
    b: { T: 3 },
  },
  {
    id: "inelastic",
    title: "2 · Elastic vs inelastic",
    note: "A is fully elastic: kinetic energy is conserved and P stays flat with small fluctuations. B loses 3% per collision: T and P keep dropping, slow clusters form and the distribution leaves the Maxwell curve. The ideal gas model assumes elastic collisions.",
    a: { restitution: 1, N: 400 },
    b: { restitution: 0.97, N: 400 },
  },
  {
    id: "viscosity",
    title: "3 · Viscosity & shear layers",
    note: "Slow layers sit near the walls and fast ones in the centre. Collisions between layers carry x-momentum across them, so the profile flattens. With no-slip walls plus extra viscous coupling (B), momentum drains into the walls fast and flow energy turns into heat. That raises T and the normal pressure on the walls.",
    a: { shear: true, viscosity: 0, noSlip: false, N: 400, flowU: 3 },
    b: { shear: true, viscosity: 0.3, noSlip: true, N: 400, flowU: 3 },
  },
  {
    id: "attraction",
    title: "4 · Intermolecular attraction",
    note: "Both run at T = 1 with a thermostat. In B, molecules near a wall get pulled back by the gas behind them, so they hit with less impulse: Z < 1, the van der Waals ‘a’ term.",
    a: { N: 500, radius: 1, attraction: 0, thermostat: true },
    b: { N: 500, radius: 1, attraction: 0.4, thermostat: true },
  },
  {
    id: "volume",
    title: "5 · Molecular volume",
    note: "Small disks (A) vs large disks at high density (B). Finite size cuts the free area, so molecules hit the walls more often: Z > 1, the van der Waals ‘b’ term. Compare with the green hard-disk equation of state.",
    a: { N: 500, radius: 0.3 },
    b: { N: 500, radius: 1.6 },
  },
  {
    id: "fluct",
    title: "6 · Thermodynamic fluctuations",
    note: "Few molecules (A) vs many (B). Relative pressure fluctuations scale as about 1/√N, so a big N gives a smooth, macroscopic pressure.",
    a: { N: 40, radius: 0.6 },
    b: { N: 1000, radius: 0.6 },
  },
];

const PROMPT = `Build an interactive 2D elastic-sphere (hard-disk) molecular simulation to study gas pressure at the microscopic scale.
Goals: compare pressure in an ideal gas and a real gas, and connect molecular motion to macroscopic pressure.
Physics:
1. Draw initial velocities from the Maxwell–Boltzmann distribution (Gaussian components, variance kT/m). Do not give every molecule the same speed. Let me change T and watch speed, impulse per wall collision and collision frequency.
2. Molecule–molecule collisions use a coefficient of restitution e (e=1 elastic, e<1 inelastic). Wall collisions are specular and elastic.
3. Viscosity mode: periodic in x, walls top and bottom. Start slower molecules near the walls and faster ones in the centre (parabolic drift). Add an optional viscous coupling force and no-slip/thermal walls. Show the layer velocity profile u(y) and the pressure along the walls.
4. Optional: short-range attraction between molecules (strength ε), finite molecular radius (excluded volume), and adjustable N to show fluctuations.
Measurement: pressure = total impulse 2m|v⊥| delivered to the walls ÷ (wall length × time window). Compare it with ideal nkT and a hard-disk equation of state, and report Z = PA/NkT.
Visual outputs: the animated box (molecules colored by speed), a live speed histogram with the Maxwell curve overlaid, a real-time pressure–time plot, the wall-pressure distribution, and two side-by-side panels (A/B) with sliders for N, T, radius, e, ε and viscosity.`;

type Row = { preset: string; side: string; N: number; T: number; e: number; r: number; eps: number; P: number; Pid: number; Z: number; fl: number; rate: number; imp: number };

export default function Index() {
  const [a, setA] = useState<Params>({ ...defaultParams, ...PRESETS[0].a });
  const [b, setB] = useState<Params>({ ...defaultParams, ...PRESETS[0].b });
  const [preset, setPreset] = useState(PRESETS[0]);
  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const sa = useRef<Stats | null>(null);
  const sb = useRef<Stats | null>(null);
  const onA = useCallback((s: Stats) => (sa.current = s), []);
  const onB = useCallback((s: Stats) => (sb.current = s), []);

  const apply = (p: Preset) => {
    setPreset(p);
    setA({ ...defaultParams, ...p.a });
    setB({ ...defaultParams, ...p.b });
    setResetKey((k) => k + 1);
  };

  const record = () => {
    const mk = (side: string, p: Params, s: Stats | null): Row | null =>
      s && {
        preset: preset.title,
        side,
        N: p.N,
        T: +s.T.toFixed(3),
        e: p.restitution,
        r: p.radius,
        eps: p.attraction,
        P: +s.P.toFixed(5),
        Pid: +s.Pideal.toFixed(5),
        Z: +s.Z.toFixed(3),
        fl: +(s.rel * 100).toFixed(2),
        rate: +s.rate.toFixed(4),
        imp: +s.imp.toFixed(4),
      };
    const ra = mk("A", a, sa.current);
    const rb = mk("B", b, sb.current);
    setRows((r) => [...r, ...([ra, rb].filter(Boolean) as Row[])]);
  };

  const csv = () => {
    const head = "experiment,panel,N,T,restitution,radius,attraction,P,P_ideal,Z,fluct_%,hit_rate,mean_impulse";
    const body = rows.map((r) => [r.preset, r.side, r.N, r.T, r.e, r.r, r.eps, r.P, r.Pid, r.Z, r.fl, r.rate, r.imp].join(","));
    const blob = new Blob([[head, ...body].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = "gas-observations.csv";
    el.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="min-h-screen text-[#d7dee6] pb-16"
      style={{
        fontFamily: "'IBM Plex Sans', sans-serif",
        background:
          "radial-gradient(1200px 500px at 15% -10%, rgba(58,214,255,0.08), transparent), radial-gradient(900px 500px at 100% 0%, rgba(255,176,46,0.07), transparent), #0b0d10",
      }}
    >
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.35]"
        style={{
          backgroundImage: "linear-gradient(#141a20 1px, transparent 1px), linear-gradient(90deg, #141a20 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative max-w-[1500px] mx-auto px-4 md:px-6">
        <header className="pt-8 pb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#3ad6ff]">Ch18 · Ch20 — kinetic theory lab</div>
            <h1 className="text-3xl md:text-4xl font-semibold text-white tracking-tight mt-1">
              Elastic-Sphere Gas Lab
            </h1>
            <p className="text-sm text-[#7d8a98] mt-1 max-w-xl">
              See how the wall pressure of an ideal gas compares with a real gas, one molecule at a time.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRunning((r) => !r)}
              className="font-mono text-xs uppercase tracking-[0.12em] px-4 py-2 bg-white text-black font-semibold"
            >
              {running ? "❚❚ Pause" : "▶ Run"}
            </button>
            <button
              type="button"
              onClick={record}
              className="font-mono text-xs uppercase tracking-[0.12em] px-4 py-2 border border-[#3ad6ff] text-[#3ad6ff] hover:bg-[#3ad6ff]/10"
            >
              ● Record observation
            </button>
            <button
              type="button"
              onClick={() => setShowPrompt((s) => !s)}
              className="font-mono text-xs uppercase tracking-[0.12em] px-4 py-2 border border-[#2a333d] text-[#7d8a98] hover:text-white"
            >
              AI prompt
            </button>
          </div>
        </header>

        {showPrompt && (
          <div className="mb-4 border border-[#222a33] bg-[#0e1216] p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#7d8a98]">Prompt used to build this simulation</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(PROMPT)} className="font-mono text-[11px] text-[#3ad6ff]">
                copy
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[#c3ccd6]">{PROMPT}</pre>
          </div>
        )}

        <nav className="flex flex-wrap gap-1.5 mb-3">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => apply(p)}
              className={`font-mono text-[12px] px-3 py-1.5 border transition-colors ${
                preset.id === p.id ? "bg-[#3ad6ff] text-black border-[#3ad6ff] font-semibold" : "border-[#2a333d] text-[#9aa6b2] hover:text-white"
              }`}
            >
              {p.title}
            </button>
          ))}
        </nav>
        <p className="text-sm text-[#aab4bf] mb-4 max-w-4xl border-l-2 border-[#ffb02e] pl-3">{preset.note}</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SimPanel label="A" accent="#3ad6ff" params={a} setParams={setA} running={running} resetKey={resetKey} onStats={onA} />
          <SimPanel label="B" accent="#ffb02e" params={b} setParams={setB} running={running} resetKey={resetKey} onStats={onB} />
        </div>

        <section className="mt-5 border border-[#222a33] bg-[#12161b]/90">
          <header className="flex items-center justify-between px-4 py-2.5 border-b border-[#222a33]">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#7d8a98]">
              Observation log ({rows.length}): wait about 20 time units after a change before you record
            </span>
            <div className="flex gap-3">
              <button type="button" onClick={csv} disabled={!rows.length} className="font-mono text-[11px] text-[#3ad6ff] disabled:opacity-30">
                export CSV
              </button>
              <button type="button" onClick={() => setRows([])} className="font-mono text-[11px] text-[#7d8a98] hover:text-white">
                clear
              </button>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[12px]">
              <thead className="text-[#7d8a98] text-left">
                <tr>
                  {["Experiment", "", "N", "T", "e", "r", "ε", "P", "nkT", "Z", "fluct %", "hits", "⟨J⟩"].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-[#1b2128]">
                    <td className="px-3 py-1.5 text-[#aab4bf]">{r.preset}</td>
                    <td className="px-3 py-1.5" style={{ color: r.side === "A" ? "#3ad6ff" : "#ffb02e" }}>
                      {r.side}
                    </td>
                    {[r.N, r.T, r.e, r.r, r.eps, r.P, r.Pid, r.Z, r.fl, r.rate, r.imp].map((v, j) => (
                      <td key={j} className="px-3 py-1.5 text-white">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={13} className="px-3 py-4 text-[#5d6976]">
                      No observations yet. Pick an experiment, let it settle, then click “Record observation”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
