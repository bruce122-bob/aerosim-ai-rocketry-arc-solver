import React, { useState, useEffect } from 'react';
import { RocketConfig, Environment } from '../types';
import flightDataJson from '../flight_data.json';
import {
  loadMLModels,
  predictApogee,
  getModelInfo,
  clearMLCache,
  MLInputFeatures,
  MLPrediction,
} from '../services/mlPredictor';
import { runSimulation } from '../services/physics6dofStable';
import { findMotorByDesignation } from '../services/motorMatcher';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  ReferenceLine,
} from 'recharts';

interface FlightRecord {
  team: string;
  date: string;
  launch_number: number;
  apogee_ft: number;
  mass_g: number;
  flight_time_s: number;
  ascent_time_s?: number;
  wind_speed_mph: number;
  wind_direction?: string;
  humidity_percent?: number;
  temp_f?: number;
  temp_c?: number;
  pressure_inhg?: number;
  pressure_hpa?: number;
  motor: string;
  motor_mass_g?: number;
}

interface ComparisonRow {
  index: number;
  motor: string;
  mass_g: number;
  actual_ft: number;
  ml_ft: number;
  physics_ft: number;
  ml_error_ft: number;
  physics_error_ft: number;
  ml_error_pct: number;
  physics_error_pct: number;
}

interface Props {
  rocket: RocketConfig;
  env: Environment;
}

const windDirectionToDegrees = (direction: string): number => {
  const dirMap: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return dirMap[direction?.toUpperCase() || 'N'] || 0;
};

const recordToEnvironment = (record: FlightRecord): Environment => ({
  windSpeed: (record.wind_speed_mph || 0) * 0.44704,
  windDirection: windDirectionToDegrees(record.wind_direction || 'N'),
  temperature: record.temp_c || ((record.temp_f || 20) - 32) * 5 / 9,
  pressure: record.pressure_hpa || (record.pressure_inhg || 29.92) * 33.8639,
  humidity: record.humidity_percent || 50,
  airDensity: undefined as unknown as number,
});

const confidenceColor = (c: 'low' | 'medium' | 'high') =>
  c === 'high'
    ? 'border border-emerald-500/20 bg-emerald-500/15 text-emerald-200'
    : c === 'medium'
      ? 'border border-amber-500/20 bg-amber-500/15 text-amber-200'
      : 'border border-rose-500/20 bg-rose-500/15 text-rose-200';

const inputClass = 'rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none';

const MLComparisonPanel: React.FC<Props> = ({ rocket, env }) => {
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelInfo, setModelInfo] = useState<Awaited<ReturnType<typeof getModelInfo>>>(null);
  const [flightData, setFlightData] = useState<FlightRecord[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const [customMass, setCustomMass] = useState(600);
  const [customMotor, setCustomMotor] = useState('F42-8T');
  const [customPrediction, setCustomPrediction] = useState<MLPrediction | null>(null);
  const [customPhysics, setCustomPhysics] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const models = await loadMLModels();
      if (models) {
        setModelsLoaded(true);
        setModelInfo(await getModelInfo());
      }
    })();

    setFlightData(flightDataJson as unknown as FlightRecord[]);
  }, []);

  const handleRunComparison = async () => {
    if (!modelsLoaded || flightData.length === 0) return;
    setIsRunning(true);
    setComparisons([]);

    const results: ComparisonRow[] = [];

    for (let i = 0; i < flightData.length; i++) {
      setProgress(Math.round(((i + 1) / flightData.length) * 100));
      const record = flightData[i];
      const recEnv = recordToEnvironment(record);

      const input: MLInputFeatures = {
        mass_g: record.mass_g,
        temp_c: record.temp_c || ((record.temp_f || 20) - 32) * 5 / 9,
        humidity_percent: record.humidity_percent || 50,
        pressure_hpa: record.pressure_hpa || (record.pressure_inhg || 29.92) * 33.8639,
        motor_mass_g: record.motor_mass_g || 0,
        wind_speed_mph: record.wind_speed_mph || 0,
        motor: record.motor,
      };

      const mlPred = await predictApogee(input);
      const ml_ft = mlPred ? mlPred.predictedApogee_ft : 0;

      const matchedMotor = findMotorByDesignation(record.motor);
      const modifiedRocket: RocketConfig = {
        ...rocket,
        motor: matchedMotor || rocket.motor,
        manualOverride: { ...rocket.manualOverride, mass: record.mass_g / 1000 },
      };

      let physics_ft = 0;
      try {
        const simResult = await runSimulation(modifiedRocket, recEnv, 90, 1.0);
        physics_ft = simResult.apogee * 3.28084;
      } catch {
        console.warn(`[ML] Physics sim failed for flight #${i + 1}`);
      }

      const actual = record.apogee_ft;
      results.push({
        index: i + 1,
        motor: record.motor,
        mass_g: record.mass_g,
        actual_ft: actual,
        ml_ft: Math.round(ml_ft * 10) / 10,
        physics_ft: Math.round(physics_ft * 10) / 10,
        ml_error_ft: Math.round((ml_ft - actual) * 10) / 10,
        physics_error_ft: Math.round((physics_ft - actual) * 10) / 10,
        ml_error_pct: Math.round(((ml_ft - actual) / actual) * 1000) / 10,
        physics_error_pct: Math.round(((physics_ft - actual) / actual) * 1000) / 10,
      });
    }

    setComparisons(results);
    setIsRunning(false);
  };

  const handleCustomPredict = async () => {
    const input: MLInputFeatures = {
      mass_g: customMass,
      temp_c: env.temperature,
      humidity_percent: env.humidity,
      pressure_hpa: env.pressure,
      motor_mass_g: rocket.motor.totalMass * 1000,
      wind_speed_mph: env.windSpeed / 0.44704,
      motor: customMotor,
    };

    const mlPred = await predictApogee(input);
    setCustomPrediction(mlPred);

    const matchedMotor = findMotorByDesignation(customMotor);
    const modifiedRocket: RocketConfig = {
      ...rocket,
      motor: matchedMotor || rocket.motor,
      manualOverride: { ...rocket.manualOverride, mass: customMass / 1000 },
    };

    try {
      const simResult = await runSimulation(modifiedRocket, env, 90, 1.0);
      setCustomPhysics(simResult.apogee * 3.28084);
    } catch {
      setCustomPhysics(null);
    }
  };

  const handleReload = async () => {
    clearMLCache();
    const models = await loadMLModels();
    if (models) {
      setModelsLoaded(true);
      setModelInfo(await getModelInfo());
    }
  };

  const scatterDataML = comparisons.map((r) => ({
    actual: r.actual_ft,
    predicted: r.ml_ft,
    motor: r.motor,
    label: `ML #${r.index}`,
  }));

  const scatterDataPhysics = comparisons.map((r) => ({
    actual: r.actual_ft,
    predicted: r.physics_ft,
    motor: r.motor,
    label: `Physics #${r.index}`,
  }));

  const errorBarData = comparisons.map((r) => ({
    flight: `#${r.index}`,
    motor: r.motor,
    ml_error: Math.abs(r.ml_error_ft),
    physics_error: Math.abs(r.physics_error_ft),
  }));

  const mlMAE = comparisons.length > 0
    ? comparisons.reduce((s, r) => s + Math.abs(r.ml_error_ft), 0) / comparisons.length
    : 0;
  const physicsMAE = comparisons.length > 0
    ? comparisons.reduce((s, r) => s + Math.abs(r.physics_error_ft), 0) / comparisons.length
    : 0;

  if (!modelsLoaded) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-6 text-center">
        <div className="mb-4 text-slate-400">ML models not loaded yet.</div>
        <p className="mb-4 text-sm text-slate-500">
          Run <code className="rounded bg-[#020817] px-2 py-1 text-xs text-cyan-200">cd ml && pip install -r requirements.txt && python train.py</code> to train models first.
        </p>
        <button onClick={handleReload} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-cyan-400">
          Retry Loading Models
        </button>
      </div>
    );
  }

  return (
    <div>
      {modelInfo && (
        <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-[#0b1220] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-100">ML Model Status</h3>
            <button onClick={handleReload} className="text-xs font-medium text-cyan-300 hover:text-cyan-200">
              Reload Models
            </button>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">Training Samples</div>
              <div className="text-lg font-semibold text-slate-100">{modelInfo.totalSamples}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">Motor Types</div>
              <div className="text-lg font-semibold text-slate-100">{modelInfo.motors.length}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">Global LOOCV MAE</div>
              <div className="text-lg font-semibold text-slate-100">{modelInfo.globalMetrics.loocv_mae.toFixed(1)} ft</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">Global R²</div>
              <div className="text-lg font-semibold text-slate-100">{modelInfo.globalMetrics.loocv_r2.toFixed(3)}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {Object.entries(modelInfo.motorMetrics).map(([motor, m]) => (
              <div key={motor} className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
                <div className="mb-1 text-xs font-medium text-slate-200">{motor}</div>
                <div className="text-xs text-slate-500">
                  MAE: {m.loocv_mae.toFixed(1)} ft | R²: {m.loocv_r2.toFixed(3)} | n={m.n_samples}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">Trained: {new Date(modelInfo.trainedAt).toLocaleString()}</div>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
        <h3 className="mb-3 text-base font-semibold text-slate-100">Quick Prediction</h3>
        <div className="flex items-end gap-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Mass (g)</label>
            <input type="number" value={customMass} onChange={(e) => setCustomMass(Number(e.target.value))} className={`w-28 ${inputClass}`} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Motor</label>
            <select value={customMotor} onChange={(e) => setCustomMotor(e.target.value)} className={inputClass}>
              {(modelInfo?.motors || []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <button onClick={handleCustomPredict} className="rounded-lg bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-cyan-400">
            Predict
          </button>
        </div>

        {customPrediction && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">ML Prediction</div>
              <div className="text-lg font-semibold text-cyan-300">{customPrediction.predictedApogee_ft.toFixed(1)} ft</div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${confidenceColor(customPrediction.confidence)}`}>
                {customPrediction.confidence} confidence
              </span>
            </div>
            {customPhysics !== null && (
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
                <div className="mb-1 text-xs text-slate-500">Physics Engine</div>
                <div className="text-lg font-semibold text-indigo-300">{customPhysics.toFixed(1)} ft</div>
              </div>
            )}
            {customPhysics !== null && (
              <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
                <div className="mb-1 text-xs text-slate-500">Difference</div>
                <div className="text-lg font-semibold text-slate-100">{(customPrediction.predictedApogee_ft - customPhysics).toFixed(1)} ft</div>
                <div className="text-xs text-slate-500">
                  {(((customPrediction.predictedApogee_ft - customPhysics) / customPhysics) * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="mb-1 text-base font-semibold text-slate-100">ML vs Physics vs Actual</h3>
            <p className="text-sm text-slate-400">Compare predictions across all {flightData.length} flight records</p>
          </div>
          <button
            onClick={handleRunComparison}
            disabled={isRunning}
            className="rounded-lg bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {isRunning ? `Running... ${progress}%` : 'Run Comparison'}
          </button>
        </div>

        {comparisons.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-4">
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">ML MAE</div>
              <div className="text-lg font-semibold text-cyan-300">{mlMAE.toFixed(1)} ft</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">Physics MAE</div>
              <div className="text-lg font-semibold text-indigo-300">{physicsMAE.toFixed(1)} ft</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">ML Better?</div>
              <div className={`text-lg font-semibold ${mlMAE < physicsMAE ? 'text-emerald-300' : 'text-amber-300'}`}>{mlMAE < physicsMAE ? 'Yes' : 'No'}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <div className="mb-1 text-xs text-slate-500">Advantage</div>
              <div className="text-lg font-semibold text-slate-100">{Math.abs(mlMAE - physicsMAE).toFixed(1)} ft</div>
            </div>
          </div>
        )}
      </div>

      {comparisons.length > 0 && (
        <>
          <div className="mb-6">
            <h3 className="mb-4 text-base font-semibold text-slate-100">Predicted vs Actual Apogee</h3>
            <ResponsiveContainer width="100%" height={400}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="actual" name="Actual" type="number" tick={{ fill: '#64748b' }} label={{ value: 'Actual Apogee (ft)', position: 'insideBottom', offset: -5 }} domain={['auto', 'auto']} />
                <YAxis dataKey="predicted" name="Predicted" type="number" tick={{ fill: '#64748b' }} label={{ value: 'Predicted Apogee (ft)', angle: -90, position: 'insideLeft' }} domain={['auto', 'auto']} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload[0]) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded border border-slate-700 bg-[#020817] p-3 text-sm text-slate-200 shadow">
                          <p className="font-semibold">{data.label}</p>
                          <p>Motor: {data.motor}</p>
                          <p>Actual: {data.actual.toFixed(1)} ft</p>
                          <p>Predicted: {data.predicted.toFixed(1)} ft</p>
                          <p>Error: {(data.predicted - data.actual).toFixed(1)} ft</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                <ReferenceLine segment={[{ x: 650, y: 650 }, { x: 900, y: 900 }]} stroke="#10B981" strokeDasharray="5 5" strokeWidth={2} label="Perfect" />
                <Scatter name="ML Prediction" data={scatterDataML} fill="#22d3ee" />
                <Scatter name="Physics Engine" data={scatterDataPhysics} fill="#818cf8" />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-slate-500">Green dashed line = perfect prediction. Closer to line = more accurate.</p>
          </div>

          <div className="mb-6">
            <h3 className="mb-4 text-base font-semibold text-slate-100">Absolute Error Comparison</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={errorBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="flight" tick={{ fill: '#64748b' }} />
                <YAxis tick={{ fill: '#64748b' }} label={{ value: 'Absolute Error (ft)', angle: -90, position: 'insideLeft' }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length >= 2) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded border border-slate-700 bg-[#020817] p-3 text-sm text-slate-200 shadow">
                          <p className="font-semibold">Flight {data.flight}</p>
                          <p>Motor: {data.motor}</p>
                          <p className="text-cyan-300">ML Error: {data.ml_error.toFixed(1)} ft</p>
                          <p className="text-indigo-300">Physics Error: {data.physics_error.toFixed(1)} ft</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                <Bar dataKey="ml_error" name="ML Error" fill="#22d3ee" />
                <Bar dataKey="physics_error" name="Physics Error" fill="#818cf8" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <h3 className="mb-4 text-base font-semibold text-slate-100">Detailed Results</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 rounded-lg border border-slate-800 text-sm">
                <thead className="bg-[#020817]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500">#</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500">Motor</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500">Mass(g)</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500">Actual(ft)</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-cyan-300">ML(ft)</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-300">Physics(ft)</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-cyan-300">ML Err</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-300">Phys Err</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-[#0b1220]">
                  {comparisons.map((r) => {
                    const mlBetter = Math.abs(r.ml_error_ft) < Math.abs(r.physics_error_ft);
                    return (
                      <tr key={r.index}>
                        <td className="px-3 py-2 text-slate-100">{r.index}</td>
                        <td className="px-3 py-2 text-slate-300">{r.motor}</td>
                        <td className="px-3 py-2 text-slate-400">{r.mass_g.toFixed(1)}</td>
                        <td className="px-3 py-2 font-medium text-slate-100">{r.actual_ft.toFixed(1)}</td>
                        <td className={`px-3 py-2 ${mlBetter ? 'font-semibold text-cyan-300' : 'text-cyan-400/80'}`}>{r.ml_ft.toFixed(1)}</td>
                        <td className={`px-3 py-2 ${!mlBetter ? 'font-semibold text-indigo-300' : 'text-indigo-400/80'}`}>{r.physics_ft.toFixed(1)}</td>
                        <td className="px-3 py-2">
                          <span className={Math.abs(r.ml_error_ft) < 20 ? 'text-emerald-300' : Math.abs(r.ml_error_ft) < 50 ? 'text-amber-300' : 'text-rose-300'}>
                            {r.ml_error_ft > 0 ? '+' : ''}{r.ml_error_ft.toFixed(1)} ({r.ml_error_pct.toFixed(1)}%)
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={Math.abs(r.physics_error_ft) < 20 ? 'text-emerald-300' : Math.abs(r.physics_error_ft) < 50 ? 'text-amber-300' : 'text-rose-300'}>
                            {r.physics_error_ft > 0 ? '+' : ''}{r.physics_error_ft.toFixed(1)} ({r.physics_error_pct.toFixed(1)}%)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="mt-6 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-200">
        <strong>Retrain models:</strong> After adding new flight data to{' '}
        <code className="rounded bg-[#020817] px-1.5 py-0.5 text-xs text-cyan-100">flight_data.json</code>, run:
        <pre className="mt-2 overflow-x-auto rounded bg-[#020817] p-2 text-xs text-cyan-100">cd ml && python train.py</pre>
        Then click &quot;Reload Models&quot; above.
      </div>
    </div>
  );
};

export default MLComparisonPanel;
