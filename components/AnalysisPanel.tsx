import React, { useMemo, useState } from 'react';
import { RocketConfig, Environment } from '../types';
import FlightDataAnalysis from './FlightDataAnalysis';
import CdPredictor from './CdPredictor';
import UncertaintyAnalysis from './UncertaintyAnalysis';
import MLComparisonPanel from './MLComparisonPanel';

interface Props {
  rocket: RocketConfig;
  env: Environment;
  hasImportedRocket?: boolean;
  onUpdateCd: (newCd: number) => void;
  onUpdateRocket?: (updater: (rocket: RocketConfig) => RocketConfig) => void;
  launchAngle?: number;
  rodLength?: number;
}

const AnalysisPanel: React.FC<Props> = ({ rocket, env, hasImportedRocket = false, onUpdateCd, onUpdateRocket, launchAngle = 90, rodLength = 1.0 }) => {
  const [activeView, setActiveView] = useState<'cd' | 'data' | 'ml' | 'uncertainty'>('cd');

  const currentCd = rocket.cdOverride ?? 0.5;
  const calibrationState = useMemo(() => {
    const kThrust = rocket.simulationSettings?.kThrust ?? 1.0;
    const kDrag = rocket.simulationSettings?.kDrag ?? 1.0;
    const calibrated = Math.abs(kThrust - 1.0) > 0.01 || Math.abs(kDrag - 1.0) > 0.01;
    return { kThrust, kDrag, calibrated };
  }, [rocket.simulationSettings]);

  const tabs = [
    { id: 'cd' as const, label: 'Cd Tuning', icon: 'Aerodynamics', desc: 'Estimate drag and match real apogee' },
    { id: 'data' as const, label: 'Calibration', icon: 'Validation', desc: 'Fit k_thrust and k_drag from flight records' },
    { id: 'ml' as const, label: 'ML Advisor', icon: 'Data Driven', desc: 'Use historical flights as a correction layer on top of physics' },
    { id: 'uncertainty' as const, label: 'Risk & Spread', icon: 'Dispersion', desc: 'How much the result moves with uncertainty' },
  ];

  const recommendedAction = useMemo(() => {
    if (!calibrationState.calibrated) {
      return {
        title: 'Calibrate Against Real Flights',
        detail: 'Your physics profile is still near baseline. If you have measured apogee data, calibrating k_thrust and k_drag will give the biggest accuracy gain.',
        target: 'data' as const,
      };
    }
    if (currentCd >= 0.4 && currentCd <= 0.7) {
      return {
        title: 'Cross-Check With Historical Flights',
        detail: 'Once the physics model is close, the ML layer can tell you whether your current setup still sits inside the envelope of past real flights.',
        target: 'ml' as const,
      };
    }
    if (currentCd < 0.4 || currentCd > 0.7) {
      return {
        title: 'Review Drag Model',
        detail: 'The current Cd is outside the usual range for a typical amateur rocket. Check geometry assumptions and compare against one known flight.',
        target: 'cd' as const,
      };
    }
    if (env.windSpeed > 4) {
      return {
        title: 'Run Dispersion Before Launching',
        detail: 'Wind is high enough that spread and landing range matter. Use Risk & Spread to judge whether the conditions are still acceptable.',
        target: 'uncertainty' as const,
      };
    }
    return {
      title: 'System Is In A Good State',
      detail: 'Your drag and calibration values look reasonable. Use Risk & Spread as a final check when conditions or launch angle change.',
      target: 'uncertainty' as const,
    };
  }, [calibrationState.calibrated, currentCd, env.windSpeed]);

  const healthTone = calibrationState.calibrated ? 'emerald' : 'amber';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(8,13,24,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="border-b border-cyan-500/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_40%)] p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-400">Analysis Workspace</div>
            <h2 className="mb-2 text-2xl font-semibold text-slate-50">Turn simulation output into launch decisions</h2>
            <p className="text-sm leading-6 text-slate-400">
              This workspace is for three jobs: tune drag, validate the model against measured flights, and estimate how much the result spreads under uncertain conditions.
            </p>
          </div>
          <div className={`rounded-2xl px-4 py-3 border backdrop-blur-sm ${
            healthTone === 'emerald'
              ? 'bg-emerald-500/8 border-emerald-500/20'
              : 'bg-amber-500/8 border-amber-500/20'
          }`}>
            <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Recommended Next Step</div>
            <div className="mb-1 text-sm font-semibold text-slate-100">{recommendedAction.title}</div>
            <p className="max-w-xs text-xs text-slate-400">{recommendedAction.detail}</p>
            <button
              onClick={() => setActiveView(recommendedAction.target)}
              className="mt-3 inline-flex items-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/15"
            >
              Open Recommended Tool
            </button>
          </div>
        </div>
      </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className={`rounded-xl border p-4 ${hasImportedRocket ? 'bg-emerald-500/6 border-emerald-500/20' : 'bg-amber-500/6 border-amber-500/20'}`}>
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Calibration Rocket</div>
          <div className="truncate text-sm font-semibold text-slate-100">{rocket.name}</div>
          <p className="mt-2 text-xs text-slate-400">
            {hasImportedRocket ? 'Imported ORK loaded' : 'Default rocket only. Upload an ORK before trusting calibration.'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Current Cd</div>
          <div className="text-2xl font-semibold text-slate-100">{currentCd.toFixed(3)}</div>
          <p className="mt-2 text-xs text-slate-400">Best used when apogee is close but still biased.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Calibration State</div>
          <div className={`text-sm font-semibold ${calibrationState.calibrated ? 'text-emerald-300' : 'text-amber-300'}`}>
            {calibrationState.calibrated ? 'Adjusted from baseline' : 'Baseline profile'}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            k_thrust {calibrationState.kThrust.toFixed(3)} / k_drag {calibrationState.kDrag.toFixed(3)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Wind Context</div>
          <div className="text-2xl font-semibold text-slate-100">{(env.windSpeed * 2.23694).toFixed(1)} mph</div>
          <p className="mt-2 text-xs text-slate-400">Higher wind means more need for risk and dispersion checks.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Launch Geometry</div>
          <div className="text-2xl font-semibold text-slate-100">{launchAngle.toFixed(0)}°</div>
          <p className="mt-2 text-xs text-slate-400">Rod length {rodLength.toFixed(2)} m</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`text-left rounded-2xl border p-4 transition-all duration-200 ${
              activeView === tab.id
                ? 'border-cyan-500/30 bg-cyan-500/8 text-cyan-100 ring-1 ring-cyan-500/15'
                : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:bg-slate-900/80'
            }`}
            title={tab.desc}
          >
            <div className="mb-1 font-mono text-[11px] uppercase tracking-wide opacity-70">{tab.icon}</div>
            <div className="text-sm font-semibold">{tab.label}</div>
            <div className="text-xs mt-1 opacity-80">{tab.desc}</div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(9,14,26,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.25)]">
        {activeView === 'cd' && (
          <CdPredictor rocket={rocket} env={env} onUpdateCd={onUpdateCd} />
        )}

        {activeView === 'data' && (
          <FlightDataAnalysis rocket={rocket} hasImportedRocket={hasImportedRocket} onUpdateRocket={onUpdateRocket} />
        )}

        {activeView === 'ml' && (
          <MLComparisonPanel rocket={rocket} env={env} />
        )}

        {activeView === 'uncertainty' && (
          <UncertaintyAnalysis rocket={rocket} env={env} launchAngle={launchAngle} rodLength={rodLength} />
        )}
      </div>
    </div>
  );
};

export default AnalysisPanel;
