import React, { useState } from 'react';
import { RocketConfig, Environment } from '../types';
import { runMonteCarloAnalysis, runSensitivityAnalysis, assessRisk, MonteCarloResult, SensitivityResult } from '../services/monteCarlo';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

interface Props {
    rocket: RocketConfig;
    env: Environment;
    launchAngle: number;
    rodLength: number;
}

const UncertaintyAnalysis: React.FC<Props> = ({ rocket, env, launchAngle, rodLength }) => {
    const [isRunning, setIsRunning] = useState(false);
    const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
    const [sensitivityResult, setSensitivityResult] = useState<SensitivityResult[] | null>(null);
    const [riskAssessment, setRiskAssessment] = useState<any>(null);
    const [numRuns, setNumRuns] = useState(300);
    const [progress, setProgress] = useState(0);

    const topSensitivity = sensitivityResult && sensitivityResult.length > 0
        ? [...sensitivityResult].sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity))[0]
        : null;

    const handleRunMonteCarlo = async () => {
        setIsRunning(true);
        setProgress(0);
        setMcResult(null);
        setSensitivityResult(null);
        setRiskAssessment(null);

        try {
            const result = await runMonteCarloAnalysis(
                rocket,
                env,
                launchAngle,
                rodLength,
                undefined,
                numRuns,
                (p) => setProgress(p)
            );

            setMcResult(result);
            const sensResult = await runSensitivityAnalysis(rocket, env, launchAngle, rodLength);
            setSensitivityResult(sensResult);
            setRiskAssessment(assessRisk(result, 50, 500, 10));
        } catch (error) {
            console.error('Monte Carlo analysis failed:', error);
            alert('Monte Carlo analysis failed. Check the console for details.');
        } finally {
            setIsRunning(false);
            setProgress(1);
        }
    };

    return (
        <div className="space-y-6">
            <div className="rounded-2xl border border-cyan-500/20 bg-[#0b1220] p-5 shadow-[0_24px_80px_rgba(4,10,24,0.45)]">
                <h3 className="mb-2 text-base font-semibold text-slate-100">Risk And Uncertainty</h3>
                <p className="mb-4 text-sm text-slate-400">
                    This estimates how much apogee, flight time, and landing range move when wind, thrust, mass, and drag vary around the nominal case.
                </p>

                <div className="mb-4 flex items-center gap-4">
                    <div className="flex-1">
                        <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.22em] text-slate-500">
                            Number of Runs
                        </label>
                        <input
                            type="number"
                            min="100"
                            max="2000"
                            step="100"
                            value={numRuns}
                            onChange={(e) => setNumRuns(parseInt(e.target.value, 10) || 1000)}
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            disabled={isRunning}
                        />
                    </div>
                    <button
                        onClick={handleRunMonteCarlo}
                        disabled={isRunning}
                        className="mt-6 rounded-lg bg-cyan-500 px-5 py-2.5 font-medium text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                        {isRunning ? `Running... ${(progress * 100).toFixed(0)}%` : 'Run Risk Analysis'}
                    </button>
                </div>

                {isRunning && (
                    <div className="mb-4">
                        <div className="h-2 w-full rounded-full bg-slate-900">
                            <div
                                className="h-2 rounded-full bg-cyan-400 transition-all duration-300"
                                style={{ width: `${progress * 100}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {mcResult && (
                <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Nominal Apogee</div>
                            <div className="text-2xl font-semibold text-slate-100">{(mcResult.nominal.apogee * 3.28084).toFixed(1)} ft</div>
                            <p className="mt-2 text-xs text-slate-500">Reference case before uncertainty is added.</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Spread</div>
                            <div className="text-2xl font-semibold text-slate-100">±{(mcResult.statistics.apogee.std * 3.28084).toFixed(1)} ft</div>
                            <p className="mt-2 text-xs text-slate-500">One-sigma apogee spread from all Monte Carlo runs.</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Dominant Driver</div>
                            <div className="text-sm font-semibold text-slate-100">{topSensitivity?.parameter || 'Pending analysis'}</div>
                            <p className="mt-2 text-xs text-slate-500">
                                {topSensitivity ? 'This parameter moves apogee the most in the current sensitivity sweep.' : 'Run the analysis to see the strongest source of variation.'}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 text-xs font-medium text-slate-500">Apogee Mean</div>
                            <div className="text-xl font-semibold text-slate-100">{(mcResult.statistics.apogee.mean * 3.28084).toFixed(1)} ft</div>
                            <div className="mt-1 text-xs text-slate-500">±{(mcResult.statistics.apogee.std * 3.28084).toFixed(1)} ft</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 text-xs font-medium text-slate-500">95% CI</div>
                            <div className="text-sm font-semibold text-slate-100">
                                {(mcResult.confidence.apogee_95_ci[0] * 3.28084).toFixed(1)} - {(mcResult.confidence.apogee_95_ci[1] * 3.28084).toFixed(1)} ft
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 text-xs font-medium text-slate-500">Min - Max</div>
                            <div className="text-sm font-semibold text-slate-100">
                                {(mcResult.statistics.apogee.min * 3.28084).toFixed(1)} - {(mcResult.statistics.apogee.max * 3.28084).toFixed(1)} ft
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-4">
                            <div className="mb-1 text-xs font-medium text-slate-500">Percentiles</div>
                            <div className="text-xs text-slate-300">P5: {(mcResult.statistics.apogee.percentiles.p5 * 3.28084).toFixed(1)} ft</div>
                            <div className="text-xs text-slate-300">P95: {(mcResult.statistics.apogee.percentiles.p95 * 3.28084).toFixed(1)} ft</div>
                        </div>
                    </div>

                    {mcResult.runs.length > 0 && (
                        <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                            <h4 className="mb-4 text-sm font-semibold text-slate-100">Apogee Distribution</h4>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={(() => {
                                    const apogees = mcResult.runs.map((r) => r.apogee * 3.28084);
                                    if (apogees.length === 0) return [];
                                    const min = Math.min(...apogees);
                                    const max = Math.max(...apogees);
                                    const bins = 20;
                                    const binWidth = (max - min) / bins;
                                    const histogram: { range: string; count: number }[] = [];

                                    for (let i = 0; i < bins; i++) {
                                        const binMin = min + i * binWidth;
                                        const binMax = min + (i + 1) * binWidth;
                                        const count = apogees.filter((a) => a >= binMin && (i === bins - 1 ? a <= binMax : a < binMax)).length;
                                        histogram.push({ range: `${binMin.toFixed(0)}-${binMax.toFixed(0)}`, count });
                                    }

                                    return histogram;
                                })()}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#64748b' }} />
                                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                                    <Tooltip />
                                    <Bar dataKey="count" fill="#22d3ee" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </>
            )}

            {sensitivityResult && (
                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                    <h4 className="mb-4 text-sm font-semibold text-slate-100">Parameter Sensitivity</h4>
                    <div className="space-y-3">
                        {sensitivityResult.map((result, idx) => (
                            <div key={idx} className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-100">{result.parameter}</span>
                                    <span className="text-xs text-slate-500">Sensitivity: {Math.abs(result.sensitivity).toFixed(2)}</span>
                                </div>
                                <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-900">
                                    <div
                                        className="h-full bg-gradient-to-r from-cyan-500 to-sky-300"
                                        style={{ width: `${Math.min(100, Math.abs(result.sensitivity) * 100)}%` }}
                                    />
                                </div>
                                <div className="flex items-center gap-4 text-xs">
                                    <span className="text-slate-500">Low: {(result.low * 3.28084).toFixed(1)} ft</span>
                                    <span className="font-medium text-slate-100">Nominal: {(result.nominal * 3.28084).toFixed(1)} ft</span>
                                    <span className="text-slate-500">High: {(result.high * 3.28084).toFixed(1)} ft</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {riskAssessment && (
                <div className={`rounded-lg border p-5 ${
                    riskAssessment.overall_risk_level === 'HIGH'
                        ? 'border-rose-500/40 bg-rose-500/10'
                        : riskAssessment.overall_risk_level === 'MEDIUM'
                            ? 'border-amber-500/40 bg-amber-500/10'
                            : 'border-emerald-500/40 bg-emerald-500/10'
                }`}>
                    <h4 className="mb-4 text-sm font-semibold text-slate-100">Risk Assessment</h4>
                    <div className="mb-4">
                        <div className="mb-2 text-xs font-medium text-slate-400">
                            Risk Level:
                            <span className={`ml-2 rounded px-2 py-1 ${
                                riskAssessment.overall_risk_level === 'HIGH'
                                    ? 'border border-rose-500/20 bg-rose-500/15 text-rose-200'
                                    : riskAssessment.overall_risk_level === 'MEDIUM'
                                        ? 'border border-amber-500/20 bg-amber-500/15 text-amber-200'
                                        : 'border border-emerald-500/20 bg-emerald-500/15 text-emerald-200'
                            }`}>
                                {riskAssessment.overall_risk_level}
                            </span>
                        </div>
                        <div className="space-y-2 text-xs text-slate-300">
                            <div>Below Min Altitude: {(riskAssessment.probability_below_min_altitude * 100).toFixed(1)}%</div>
                            <div>Exceed Max Range: {(riskAssessment.probability_exceed_max_range * 100).toFixed(1)}%</div>
                            <div>High Descent Rate: {(riskAssessment.probability_high_descent_rate * 100).toFixed(1)}%</div>
                        </div>
                    </div>
                    <div className="border-t border-slate-700 pt-3">
                        <div className="mb-1 text-xs font-medium text-slate-300">Recommendations:</div>
                        <ul className="space-y-1 text-xs text-slate-400">
                            {riskAssessment.recommendations.map((rec: string, idx: number) => (
                                <li key={idx}>• {rec}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UncertaintyAnalysis;
