import React, { useState, useEffect } from 'react';
import { RocketConfig, Environment, SimulationResult } from './types';
import { DEFAULT_ROCKET, DEFAULT_ENV } from './constants';
import SimulationView from './components/SimulationView';
import MotorConfig from './components/MotorConfig';
import AnalysisPanel from './components/AnalysisPanel';
import { saveToLocalStorage } from './services/fileManager';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'SETUP' | 'LAUNCH' | 'ANALYSIS'>('SETUP');
  const [rocket, setRocket] = useState<RocketConfig>(DEFAULT_ROCKET);
  const [env, setEnv] = useState<Environment>(DEFAULT_ENV);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [orkFileName, setOrkFileName] = useState<string | null>(null);

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      saveToLocalStorage(rocket, 'auto-save');
    }, 30000);
    return () => clearInterval(interval);
  }, [rocket]);

  const tabs = [
    { id: 'SETUP' as const, label: 'Setup' },
    { id: 'LAUNCH' as const, label: 'Launch' },
    { id: 'ANALYSIS' as const, label: 'Analysis' },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#0b1020] text-slate-100 font-sans">

      {/* ===== Header ===== */}
      <div className="border-b border-cyan-500/10 bg-[#09111f]">
        <div className="flex items-center justify-between px-6 py-3">

          {/* Title */}
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight text-slate-100">
                Sim <span className="text-cyan-400">Studio</span>
              </h1>
              <p className="text-slate-500 text-[10px] leading-tight tracking-[0.28em] uppercase font-mono">
                Rocket Flight Simulator
              </p>
            </div>
          </div>

          {/* Nav Tabs */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-[#0d1728] p-1 gap-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-cyan-500/12 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.18)]'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right: File Info */}
          <div className="flex items-center gap-3 min-w-[120px] justify-end">
            {orkFileName ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-1.5">
                <span className="text-emerald-400 text-[8px]">●</span>
                <span className="text-slate-300 text-xs font-mono truncate max-w-[140px]">{orkFileName}</span>
              </div>
            ) : (
              <span className="text-slate-600 text-xs font-mono">No file loaded</span>
            )}
          </div>

        </div>
      </div>

      {/* ===== Main Content Area ===== */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab === 'SETUP' && (
          <div className="h-full bg-[#0b1020]">
            <MotorConfig
              rocket={rocket}
              setRocket={setRocket}
              orkFileName={orkFileName}
              setOrkFileName={setOrkFileName}
            />
          </div>
        )}
        {activeTab === 'LAUNCH' && (
          <div className="h-full bg-[#0b1020]">
            <SimulationView
              rocket={rocket}
              env={env}
              setEnv={setEnv}
              simResult={simResult}
              setSimResult={setSimResult}
              onUpdateRocket={(updater) => setRocket(current => updater(current))}
            />
          </div>
        )}
        {activeTab === 'ANALYSIS' && (
          <div className="h-full bg-[#0b1020] p-6">
            <AnalysisPanel
              rocket={rocket}
              env={env}
              hasImportedRocket={!!orkFileName}
              onUpdateCd={(val) => setRocket({ ...rocket, cdOverride: val })}
              onUpdateRocket={(updater) => setRocket(current => updater(current))}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
