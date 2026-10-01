import { useEffect, useRef, useState } from "react";
import { Sim, type Params } from "../lib/sim";
import { drawBox, drawHist, drawPressure, drawProfile, drawShearWall } from "./charts";

export type Stats = ReturnType<Sim["stats"]>;

type Props = {
  label: string;
  accent: string;
  params: Params;
  setParams: (p: Params) => void;
  running: boolean;
  resetKey: number;
  onStats: (s: Stats) => void;
};

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className={`block ${props.disabled ? "opacity-35" : ""}`}>
      <div className="flex justify-between text-[11px] font-mono text-[#7d8a98] uppercase tracking-[0.1em]">
        <span>{props.label}</span>
        <span className="text-white">{props.fmt ? props.fmt(props.value) : props.value}</span>
      </div>
      <input
        type="range"
        aria-label={props.label}
        className="w-full accent-current"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.value)}
      className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.1em] border rounded-sm transition-colors ${
        props.value ? "border-current bg-white/10 text-white" : "border-[#2a333d] text-[#7d8a98] hover:text-white"
      }`}
    >
      {props.label}
    </button>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="border border-[#222a33] bg-[#0e1216] px-2.5 py-1.5">
      <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#7d8a98]">{k}</div>
      <div className="font-mono text-[15px] text-white leading-tight">{v}</div>
      {sub && <div className="text-[10px] font-mono text-[#5d6976]">{sub}</div>}
    </div>
  );
}

export function SimPanel({ label, accent, params, setParams, running, resetKey, onStats }: Props) {
  const simRef = useRef<Sim | null>(null);
  const box = useRef<HTMLCanvasElement>(null);
  const hist = useRef<HTMLCanvasElement>(null);
  const pres = useRef<HTMLCanvasElement>(null);
  const prof = useRef<HTMLCanvasElement>(null);
  const runRef = useRef(running);
  const [st, setSt] = useState<Stats | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  runRef.current = running;

  if (!simRef.current) simRef.current = new Sim(params);

  useEffect(() => {
    simRef.current!.update(params);
  }, [params]);

  useEffect(() => {
    simRef.current!.reset();
  }, [resetKey]);

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const loop = () => {
      const sim = simRef.current!;
      if (runRef.current) sim.advance(1);
      if (box.current) drawBox(box.current, sim, accent);
      if (frame % 3 === 0) {
        if (hist.current) drawHist(hist.current, sim, accent);
        if (pres.current) drawPressure(pres.current, sim, accent);
        if (prof.current) drawProfile(prof.current, sim, accent);
      }
      if (frame % 15 === 0) {
        const s = sim.stats();
        setSt(s);
        onStatsRef.current(s);
      }
      frame++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [accent]);

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams({ ...params, [k]: v });
  const shearWall = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!params.shear) return;
    const id = setInterval(() => {
      if (shearWall.current && simRef.current) drawShearWall(shearWall.current, simRef.current, accent);
    }, 200);
    return () => clearInterval(id);
  }, [params.shear, accent]);

  return (
    <section className="border border-[#222a33] bg-[#12161b]/90 flex flex-col" style={{ color: accent }}>
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-[#222a33]">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs px-1.5 py-0.5 text-black font-semibold" style={{ background: accent }}>
            {label}
          </span>
          <span className="text-white text-sm font-medium">
            {params.shear ? "Shear flow (viscosity study)" : params.attraction > 0 || params.radius > 1 ? "Real gas" : "Ideal-like gas"}
            {params.restitution < 1 ? " · inelastic" : " · elastic"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            simRef.current!.reset();
          }}
          className="text-[11px] font-mono uppercase tracking-[0.1em] text-[#7d8a98] hover:text-white"
        >
          ↺ reset
        </button>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_210px] gap-3 p-3">
        <div className="aspect-square w-full">
          <canvas ref={box} className="w-full h-full">box chart</canvas>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-1 gap-1.5 content-start">
          <Stat k="Pressure P" v={st ? st.P.toFixed(4) : "—"} sub={st ? `± ${(st.rel * 100).toFixed(1)}% fluct.` : ""} />
          <Stat k="Ideal nkT" v={st ? st.Pideal.toFixed(4) : "—"} />
          <Stat k="Z = PA/NkT" v={st ? st.Z.toFixed(3) : "—"} sub="1 = ideal gas" />
          <Stat k="Temperature" v={st ? st.T.toFixed(3) : "—"} />
          <Stat k="Wall hits /len/t" v={st ? st.rate.toFixed(3) : "—"} />
          <Stat k="Mean impulse" v={st ? st.imp.toFixed(3) : "—"} sub="2m⟨|v⊥|⟩ per hit" />
          <Stat k="Packing η" v={st ? (st.eta * 100).toFixed(1) + "%" : "—"} />
          <Stat k="Sim time" v={st ? st.t.toFixed(0) : "—"} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#222a33] border-y border-[#222a33]">
        <div className="bg-[#12161b] p-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#7d8a98] mb-1">Speed distribution</div>
          <canvas ref={hist} className="w-full h-36">hist chart</canvas>
        </div>
        <div className="bg-[#12161b] p-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#7d8a98] mb-1">Real-time wall pressure</div>
          <canvas ref={pres} className="w-full h-36">pres chart</canvas>
        </div>
        <div className="bg-[#12161b] p-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#7d8a98] mb-1">
            {params.shear ? "Velocity profile across layers" : "Pressure along side walls"}
          </div>
          <canvas ref={prof} className="w-full h-36">prof chart</canvas>
        </div>
        <div className="bg-[#12161b] p-2">
          {params.shear ? (
            <>
              <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#7d8a98] mb-1">
                Pressure along top / bottom walls
              </div>
              <canvas ref={shearWall} className="w-full h-36">shearWall chart</canvas>
            </>
          ) : (
            <div className="h-full flex flex-col justify-center gap-1 font-mono text-[11px] text-[#7d8a98] leading-relaxed px-1">
              <div>P = (1/L·Δt) Σ 2m|v⊥| over wall hits</div>
              <div>Ideal 2D: P·A = N·kT</div>
              <div>Particle color = speed (blue slow → red fast)</div>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Slider label="Molecules N" value={params.N} min={20} max={1200} step={10} onChange={(v) => set("N", v)} />
        <Slider label="Temperature T" value={params.T} min={0.2} max={5} step={0.1} onChange={(v) => set("T", v)} fmt={(v) => v.toFixed(1)} />
        <Slider label="Radius (volume)" value={params.radius} min={0.2} max={2.2} step={0.1} onChange={(v) => set("radius", v)} fmt={(v) => v.toFixed(1)} />
        <Slider
          label="Restitution e"
          value={params.restitution}
          min={0.8}
          max={1}
          step={0.005}
          onChange={(v) => set("restitution", v)}
          fmt={(v) => v.toFixed(3)}
        />
        <Slider label="Attraction ε" value={params.attraction} min={0} max={3} step={0.1} onChange={(v) => set("attraction", v)} fmt={(v) => v.toFixed(1)} />
        <Slider label="Speed (steps/frame)" value={params.speed} min={1} max={12} step={1} onChange={(v) => set("speed", v)} />
        <Slider
          label="Flow speed (centre)"
          value={params.flowU}
          min={0.5}
          max={5}
          step={0.5}
          onChange={(v) => set("flowU", v)}
          disabled={!params.shear}
          fmt={(v) => v.toFixed(1)}
        />
        <Slider
          label="Viscous coupling η"
          value={params.viscosity}
          min={0}
          max={3}
          step={0.1}
          onChange={(v) => set("viscosity", v)}
          disabled={!params.shear}
          fmt={(v) => v.toFixed(1)}
        />
        <div className="col-span-2 flex flex-wrap gap-1.5 pt-1">
          <Toggle label="Shear-flow mode" value={params.shear} onChange={(v) => set("shear", v)} />
          <Toggle label="No-slip walls" value={params.noSlip} onChange={(v) => set("noSlip", v)} />
          <Toggle label="Thermostat" value={params.thermostat} onChange={(v) => set("thermostat", v)} />
        </div>
      </div>
    </section>
  );
}
