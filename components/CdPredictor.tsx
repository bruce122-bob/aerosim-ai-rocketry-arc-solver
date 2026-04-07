import React, { useState, useEffect } from 'react';
import { RocketConfig } from '../types';
import { Environment } from '../types';
import { predictCd, getRecommendedCd, CdPredictionResult } from '../services/cdPredictor';
import { findMaxDiameter, calculateReferenceArea } from '../services/rocketUtils';

interface Props {
    rocket: RocketConfig;
    env: Environment;
    onUpdateCd?: (newCd: number) => void;
}

const methodPillClass = (method: CdPredictionResult['method']) => {
    if (method === 'CALIBRATED') return 'border border-cyan-500/20 bg-cyan-500/15 text-cyan-200';
    if (method === 'THEORETICAL') return 'border border-indigo-500/20 bg-indigo-500/15 text-indigo-200';
    return 'border border-slate-700 bg-slate-800 text-slate-300';
};

const confidencePillClass = (confidence: CdPredictionResult['confidence']) => {
    if (confidence === 'HIGH') return 'border border-emerald-500/20 bg-emerald-500/15 text-emerald-200';
    if (confidence === 'MEDIUM') return 'border border-amber-500/20 bg-amber-500/15 text-amber-200';
    return 'border border-rose-500/20 bg-rose-500/15 text-rose-200';
};

const inputClass = 'w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none';

const CdPredictor: React.FC<Props> = ({ rocket, env, onUpdateCd }) => {
    const [mode, setMode] = useState<'THEORETICAL' | 'CALIBRATE'>('THEORETICAL');
    const [results, setResults] = useState<CdPredictionResult[]>([]);
    const [recommendedCd, setRecommendedCd] = useState<number | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const [actualApogee, setActualApogee] = useState<string>('');
    const [actualMass, setActualMass] = useState<string>('');

    const [noseShape, setNoseShape] = useState<'OGIVE' | 'CONICAL' | 'ELLIPSOID' | 'POWER_SERIES'>('OGIVE');
    const [finCount, setFinCount] = useState<string>('4');
    const [surfaceFinish, setSurfaceFinish] = useState<'SMOOTH' | 'NORMAL' | 'ROUGH'>('NORMAL');

    const maxDiameter = findMaxDiameter(rocket.stages);
    const refArea = calculateReferenceArea(rocket.stages);

    useEffect(() => {
        const findNoseShape = (components: any[]): 'OGIVE' | 'CONICAL' | 'ELLIPSOID' | 'POWER_SERIES' | undefined => {
            for (const comp of components) {
                if (comp.type === 'NOSECONE' && comp.shape) {
                    return comp.shape;
                }
                if (comp.subComponents?.length) {
                    const found = findNoseShape(comp.subComponents);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const findFinCount = (components: any[]): number | undefined => {
            for (const comp of components) {
                if (comp.type === 'FINS' && 'finCount' in comp) {
                    return comp.finCount;
                }
                if (comp.subComponents && comp.subComponents.length > 0) {
                    const found = findFinCount(comp.subComponents);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const count = findFinCount(rocket.stages);
        if (count) setFinCount(count.toString());

        const shape = findNoseShape(rocket.stages);
        if (shape) setNoseShape(shape);
    }, [rocket]);

    const handlePredict = () => {
        setIsCalculating(true);

        setTimeout(async () => {
            const input: any = {
                maxDiameter,
                referenceArea: refArea,
                noseConeShape: noseShape,
                finCount: finCount ? parseInt(finCount, 10) : undefined,
                surfaceFinish,
            };

            if (mode === 'CALIBRATE' && actualApogee && actualMass) {
                input.actualApogee = parseFloat(actualApogee);
                input.actualMass = parseFloat(actualMass);
                input.environment = env;
            }

            const predictionResults = await predictCd(rocket, input);
            setResults(predictionResults);
            setRecommendedCd(getRecommendedCd(predictionResults));
            setIsCalculating(false);
        }, 100);
    };

    const handleApplyCd = (cd: number) => {
        console.log(`[Cd Predictor] Applying Cd: ${cd.toFixed(3)}`);
        if (onUpdateCd) {
            onUpdateCd(cd);
            alert(`✅ Cd value updated to: ${cd.toFixed(3)}\n\nThis value has been applied to the current rocket configuration.`);
        } else {
            alert(`Recommended Cd value: ${cd.toFixed(3)}\n\nPlease set this value in OpenRocket, or use the k_drag calibration parameter.`);
        }
    };

    return (
        <div className="max-w-4xl space-y-5">
            <div className="rounded-2xl border border-cyan-500/20 bg-[#0b1220] p-5 shadow-[0_24px_80px_rgba(4,10,24,0.45)]">
                <h3 className="mb-2 text-base font-semibold text-slate-100">Cd Tuning</h3>
                <p className="text-sm text-slate-400">
                    Use `Estimate` when you want a reasonable starting Cd from geometry. Use `Match Real Flight` when you already know the real apogee and want to tune Cd directly against that flight.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Current Cd</div>
                        <div className="text-2xl font-semibold text-slate-100">{(rocket.cdOverride ?? 0.5).toFixed(3)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Body Diameter</div>
                        <div className="text-2xl font-semibold text-slate-100">{(maxDiameter * 39.3701).toFixed(2)} in</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Best Use</div>
                        <p className="text-sm text-slate-400">Fast drag tuning when the rest of the vehicle model is already close.</p>
                    </div>
                </div>
            </div>

            <div className="mb-6">
                <div className="flex gap-2 border-b border-slate-800">
                    <button
                        onClick={() => setMode('THEORETICAL')}
                        className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                            mode === 'THEORETICAL'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-slate-500 hover:text-slate-200'
                        }`}
                    >
                        Estimate
                    </button>
                    <button
                        onClick={() => setMode('CALIBRATE')}
                        className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                            mode === 'CALIBRATE'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-slate-500 hover:text-slate-200'
                        }`}
                    >
                        Match Real Flight
                    </button>
                </div>
            </div>

            <div className="mb-6 rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
                {mode === 'THEORETICAL' && (
                    <div className="space-y-4">
                        <h3 className="mb-3 font-semibold text-slate-100">Rocket Parameters</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-400">Maximum Diameter</label>
                                <div className="text-lg font-semibold text-slate-100">{(maxDiameter * 39.3701).toFixed(2)} in</div>
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-400">Reference Area</label>
                                <div className="text-lg font-semibold text-slate-100">{(refArea * 10000).toFixed(2)} cm²</div>
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-400">Nose Cone Shape</label>
                                <select value={noseShape} onChange={(e) => setNoseShape(e.target.value as any)} className={inputClass}>
                                    <option value="OGIVE">Ogive</option>
                                    <option value="ELLIPSOID">Ellipsoid</option>
                                    <option value="CONICAL">Conical</option>
                                    <option value="POWER_SERIES">Power Series</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-400">Fin Count</label>
                                <input type="number" value={finCount} onChange={(e) => setFinCount(e.target.value)} min="3" max="8" className={inputClass} />
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm font-medium text-slate-400">Surface Finish</label>
                                <select value={surfaceFinish} onChange={(e) => setSurfaceFinish(e.target.value as any)} className={inputClass}>
                                    <option value="SMOOTH">Smooth</option>
                                    <option value="NORMAL">Normal</option>
                                    <option value="ROUGH">Rough</option>
                                </select>
                            </div>
                        </div>
                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-slate-300">
                            This estimator now builds a drag budget from the parsed rocket geometry. It separates skin friction, nose/forebody pressure drag, fin drag, base drag, and small hardware drag instead of relying on one blanket empirical number.
                        </div>
                    </div>
                )}

                {mode === 'CALIBRATE' && (
                    <div className="space-y-4">
                        <h3 className="mb-3 font-semibold text-slate-100">Actual Flight Data</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-400">Actual Apogee (ft)</label>
                                <input type="number" value={actualApogee} onChange={(e) => setActualApogee(e.target.value)} placeholder="e.g., 748" className={inputClass} />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-slate-400">Actual Total Mass (g)</label>
                                <input type="number" value={actualMass} onChange={(e) => setActualMass(e.target.value)} placeholder="e.g., 613" className={inputClass} />
                            </div>
                        </div>
                        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-200">
                            <strong>Tip:</strong> The tool will automatically adjust Cd to match the actual apogee.
                        </div>
                    </div>
                )}
            </div>

            <div className="mb-6">
                <button
                    onClick={handlePredict}
                    disabled={isCalculating || (mode === 'CALIBRATE' && (!actualApogee || !actualMass))}
                    className={`w-full rounded-lg px-6 py-2.5 font-medium transition-colors ${
                        isCalculating || (mode === 'CALIBRATE' && (!actualApogee || !actualMass))
                            ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                            : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    }`}
                >
                    {isCalculating ? 'Calculating...' : mode === 'CALIBRATE' ? 'Calibrate' : 'Predict'}
                </button>
            </div>

            {results.length > 0 && (
                <div className="space-y-4">
                    {recommendedCd !== null && (
                        <div className="mb-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="mb-1 font-mono text-sm uppercase tracking-[0.2em] text-cyan-300/80">Recommended Cd</div>
                                    <div className="mb-2 text-3xl font-bold text-cyan-300">{recommendedCd.toFixed(3)}</div>
                                    <p className="text-sm text-slate-300">{results.find((r) => r.cd === recommendedCd)?.explanation}</p>
                                </div>
                                <button onClick={() => handleApplyCd(recommendedCd)} className="rounded-lg bg-cyan-400 px-5 py-2.5 font-medium text-slate-950 transition-colors hover:bg-cyan-300">
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-3">
                        <h3 className="mb-3 text-sm font-semibold text-slate-200">Results</h3>
                        {results.map((result, index) => (
                            <div
                                key={index}
                                className={`rounded-xl border bg-[#0b1220] p-4 ${
                                    result.method === 'CALIBRATED'
                                        ? 'border-cyan-500/30'
                                        : result.method === 'THEORETICAL'
                                            ? 'border-indigo-500/30'
                                            : 'border-slate-800'
                                }`}
                            >
                                <div className="mb-2 flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-lg font-bold text-slate-100">{result.cd.toFixed(3)}</span>
                                            <span className={`rounded px-2 py-1 text-xs font-medium ${methodPillClass(result.method)}`}>
                                                {result.method === 'CALIBRATED' ? 'Calibrated' : result.method === 'THEORETICAL' ? 'Theoretical' : 'Estimated'}
                                            </span>
                                            <span className={`rounded px-2 py-1 text-xs font-medium ${confidencePillClass(result.confidence)}`}>
                                                {result.confidence === 'HIGH' ? 'High Confidence' : result.confidence === 'MEDIUM' ? 'Medium Confidence' : 'Low Confidence'}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm text-slate-400">{result.explanation}</p>
                                    </div>
                                    <button
                                        onClick={() => handleApplyCd(result.cd)}
                                        className="rounded-lg border border-slate-700 bg-[#020817] px-4 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-500/30 hover:text-cyan-200"
                                    >
                                        Apply
                                    </button>
                                </div>

                                {result.details && (
                                    <div className="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-400">
                                        {result.details.baseCd && <div>Base Cd: {result.details.baseCd.toFixed(3)}</div>}
                                        {result.details.calibrationError !== undefined && <div>Calibration Error: {result.details.calibrationError.toFixed(1)} ft</div>}
                                        {result.details.iterations && <div>Iterations: {result.details.iterations}</div>}
                                        {result.details.referenceCondition && (
                                            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-[#020817] p-3">
                                                <div>Nominal speed: {(result.details.referenceCondition.velocity * 2.23694).toFixed(1)} mph</div>
                                                <div>Mach: {result.details.referenceCondition.mach.toFixed(2)}</div>
                                                <div>Reynolds: {result.details.referenceCondition.reynolds.toExponential(2)}</div>
                                                <div>Density: {result.details.referenceCondition.density.toFixed(3)} kg/m³</div>
                                            </div>
                                        )}
                                        {result.details.geometry && (
                                            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-[#020817] p-3">
                                                <div>Total length: {(result.details.geometry.totalLength * 39.3701).toFixed(2)} in</div>
                                                <div>Fineness ratio: {result.details.geometry.finenessRatio.toFixed(1)}</div>
                                                <div>Fin area: {(result.details.geometry.finArea * 1550.0031).toFixed(2)} in²</div>
                                                <div>Launch lugs: {result.details.geometry.launchLugCount}</div>
                                            </div>
                                        )}
                                        {result.details.cdRange && (
                                            <div className="mt-2">
                                                Working range: {result.details.cdRange.low.toFixed(3)} - {result.details.cdRange.high.toFixed(3)}
                                            </div>
                                        )}
                                        {result.details.breakdown && result.details.breakdown.length > 0 && (
                                            <div className="mt-3 rounded-lg border border-slate-800 bg-[#020817] p-3">
                                                <div className="mb-2 font-medium text-slate-200">Drag Budget</div>
                                                <div className="space-y-2">
                                                    {result.details.breakdown.map((entry, i) => (
                                                        <div key={i} className="grid grid-cols-[140px_80px_1fr] gap-3">
                                                            <div className="text-slate-300">{entry.label}</div>
                                                            <div className="font-mono text-cyan-300">{entry.cd.toFixed(3)}</div>
                                                            <div>{entry.description}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {result.details.corrections && result.details.corrections.length > 0 && (
                                            <div className="mt-2">
                                                <div className="mb-1 font-medium text-slate-300">Model Factors:</div>
                                                {result.details.corrections.map((corr, i) => (
                                                    <div key={i}>• {corr.factor}: {corr.value.toFixed(3)} ({corr.reason})</div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-6 border-t border-slate-800 pt-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="mb-1 font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Current Cd</div>
                        <div className="text-lg font-semibold text-slate-100">
                            {rocket.cdOverride ? rocket.cdOverride.toFixed(3) : '0.500 (default)'}
                        </div>
                    </div>
                    <div className="text-xs text-slate-500">{rocket.cdOverride ? 'From .ork file' : 'Default value'}</div>
                </div>
            </div>
        </div>
    );
};

export default CdPredictor;
