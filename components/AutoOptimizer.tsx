// Auto Optimization Component
// Automatically finds optimal parameters for maximum performance

import React, { useState } from 'react';
import { RocketConfig, Environment } from '../types';
import { optimizeLaunchAngle, bayesianOptimize } from '../services/enhancedCalibration';
import { runSimulation } from '../services/physics6dofStable';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
    rocket: RocketConfig;
    env: Environment;
    rodLength: number;
}

type OptimizationMode = 'angle' | 'parameters' | 'parachute';

const AutoOptimizer: React.FC<Props> = ({ rocket, env, rodLength }) => {
    const [mode, setMode] = useState<OptimizationMode>('angle');
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [angleResult, setAngleResult] = useState<any>(null);
    const [paramResult, setParamResult] = useState<any>(null);
    const [targetApogee, setTargetApogee] = useState(800);

    const handleOptimizeAngle = () => {
        setIsOptimizing(true);
        setTimeout(() => {
            const result = optimizeLaunchAngle(rocket, env, rodLength, [75, 90], 1.0);
            setAngleResult(result);
            setIsOptimizing(false);
        }, 100);
    };

    const handleOptimizeParameters = () => {
        setIsOptimizing(true);
        setTimeout(() => {
            const result = bayesianOptimize(rocket, env, targetApogee, 90, rodLength, 20);
            setParamResult(result);
            setIsOptimizing(false);
        }, 100);
    };

    return (
        <div className="space-y-5">
            <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h3 className="text-base font-semibold text-gray-900 mb-4">Auto Optimization</h3>
                
                <div className="flex gap-1 border-b border-gray-200 mb-4">
                    <button
                        onClick={() => setMode('angle')}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                            mode === 'angle' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'
                        }`}
                    >
                        Launch Angle
                    </button>
                    <button
                        onClick={() => setMode('parameters')}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                            mode === 'parameters' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'
                        }`}
                    >
                        Parameters
                    </button>
                </div>

                {mode === 'angle' && (
                    <div>
                        <p className="text-xs text-gray-600 mb-4">
                            Find the optimal launch angle for maximum apogee
                        </p>
                        <button
                            onClick={handleOptimizeAngle}
                            disabled={isOptimizing}
                            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isOptimizing ? 'Optimizing...' : 'Find Optimal Angle'}
                        </button>
                    </div>
                )}

                {mode === 'parameters' && (
                    <div>
                        <div className="mb-4">
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                Target Apogee (ft)
                            </label>
                            <input
                                type="number"
                                value={targetApogee}
                                onChange={(e) => setTargetApogee(parseFloat(e.target.value) || 800)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <button
                            onClick={handleOptimizeParameters}
                            disabled={isOptimizing}
                            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isOptimizing ? 'Optimizing...' : 'Optimize Parameters'}
                        </button>
                    </div>
                )}
            </div>

            {/* Angle Optimization Results */}
            {angleResult && mode === 'angle' && (
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <h4 className="text-sm font-semibold text-gray-900 mb-4">Optimization Results</h4>
                    <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="text-xs text-gray-600 mb-1">Optimal Launch Angle</div>
                        <div className="text-2xl font-bold text-blue-600">{angleResult.optimalAngle}°</div>
                        <div className="text-xs text-gray-600 mt-1">
                            Maximum Apogee: {(angleResult.maxApogee * 3.28084).toFixed(1)} ft
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={angleResult.results.map(r => ({
                            angle: r.angle,
                            apogee: r.apogee * 3.28084
                        }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                            <XAxis dataKey="angle" label={{ value: 'Launch Angle (°)', position: 'insideBottom', offset: -5 }} />
                            <YAxis label={{ value: 'Apogee (ft)', angle: -90, position: 'insideLeft' }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="apogee" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Parameter Optimization Results */}
            {paramResult && mode === 'parameters' && (
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <h4 className="text-sm font-semibold text-gray-900 mb-4">Optimization Results</h4>
                    <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-xs text-gray-600 mb-1">Optimal k_thrust</div>
                                <div className="text-xl font-bold text-green-600">{paramResult.bestKThrust.toFixed(4)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-600 mb-1">Optimal k_drag</div>
                                <div className="text-xl font-bold text-green-600">{paramResult.bestKDrag.toFixed(4)}</div>
                            </div>
                        </div>
                        <div className="mt-3 text-xs text-gray-600">
                            Error: {paramResult.bestError.toFixed(1)} ft from target
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AutoOptimizer;
