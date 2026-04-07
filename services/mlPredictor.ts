/**
 * ML Apogee Predictor Service
 * ============================
 * Loads pre-trained Ridge regression model weights (exported as JSON from Python)
 * and performs in-browser apogee predictions.
 *
 * Supports:
 *  - Global model (all motors, one-hot encoded)
 *  - Per-motor models (motor-specific when available)
 *  - Comparison with physics engine predictions
 */

import { RocketConfig, Environment } from '../types';
import { runSimulation } from './physics6dofStable';
import mlModelsJson from '../ml/apogee_models.json';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MLModelWeights {
  type: string;
  alpha: number;
  coefficients: number[];
  intercept: number;
  feature_names: string[];
  scaler_mean: number[];
  scaler_std: number[];
  metrics: { loocv_mae: number; loocv_r2: number };
  n_samples: number;
  motor_columns?: string[];
  motor_values?: string[];
}

export interface MLModelsData {
  global_model: MLModelWeights;
  motor_models: Record<string, MLModelWeights>;
  training_info: {
    total_samples: number;
    motors: string[];
    motor_counts: Record<string, number>;
    trained_at: string;
    features_base: string[];
    features_derived: string[];
  };
  training_data_summary: Array<{
    motor: string;
    mass_g: number;
    apogee_ft: number;
    temp_c: number;
    humidity_percent: number;
    pressure_hpa: number;
  }>;
}

export interface MLPrediction {
  predictedApogee_ft: number;
  confidence: 'low' | 'medium' | 'high';
  modelType: 'motor_specific' | 'global';
  motorModel: string;
  metrics: { loocv_mae: number; loocv_r2: number };
}

export interface PredictionComparison {
  ml: MLPrediction;
  physics: { apogee_ft: number };
  difference_ft: number;
  difference_pct: number;
  suggestedCorrection?: number;
}

export interface MLInputFeatures {
  mass_g: number;
  temp_c: number;
  humidity_percent: number;
  pressure_hpa: number;
  motor_mass_g: number;
  wind_speed_mph: number;
  motor: string;
}

export interface MLCorrectionResult {
  mlApogee_ft: number;
  physicsApogee_ft: number;
  correctionRatio: number;        // physics/ml, clamped to [0.80, 1.20]
  correctedKDrag: number;
  confidence: 'low' | 'medium' | 'high';
  adjustmentPct: number;          // signed %, e.g. +7.6
  withinBounds: boolean;          // false if clamping was needed
  modelType: 'motor_specific' | 'global';
  motorSamples: number;
}

// ─── State ───────────────────────────────────────────────────────────────────

let modelsCache: MLModelsData | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calculate air density using the ISA model with humidity correction (matches Python train.py).
 */
function calculateAirDensity(temp_c: number, pressure_hpa: number, humidity_pct: number): number {
  const T = temp_c + 273.15;
  const P = pressure_hpa * 100;
  const R_d = 287.058;
  const R_v = 461.495;

  const e_s = 611.21 * Math.exp((18.678 - temp_c / 234.5) * (temp_c / (257.14 + temp_c)));
  const e = (humidity_pct / 100.0) * e_s;

  const T_v = T / (1 - (e / P) * (1 - R_d / R_v));
  return P / (R_d * T_v);
}

/**
 * Standardize a value using pre-computed mean/std.
 */
function standardize(value: number, mean: number, std: number): number {
  if (std === 0) return 0;
  return (value - mean) / std;
}

/**
 * Compute a linear prediction: dot(scaled_features, coefficients) + intercept.
 */
function linearPredict(features: number[], model: MLModelWeights): number {
  let result = model.intercept;
  for (let i = 0; i < features.length; i++) {
    const scaled = standardize(features[i], model.scaler_mean[i], model.scaler_std[i]);
    result += scaled * model.coefficients[i];
  }
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load ML model weights from the public directory.
 * Returns null if models are not yet trained / file not found.
 */
export async function loadMLModels(): Promise<MLModelsData | null> {
  if (modelsCache) return modelsCache;

  try {
    // 直接使用内联的 JSON 数据，避免 file:// 协议下 fetch 失败
    modelsCache = mlModelsJson as unknown as MLModelsData;
    console.log(
      `[ML] Loaded models: global + ${Object.keys(modelsCache.motor_models).length} motor-specific`,
    );
    return modelsCache;
  } catch (err) {
    console.warn('[ML] Failed to load models:', err);
    return null;
  }
}

/**
 * Clear cached models (useful after retraining).
 */
export function clearMLCache(): void {
  modelsCache = null;
}

/**
 * Build a feature vector from input features matching the model's expected order.
 */
function buildFeatureVector(input: MLInputFeatures, model: MLModelWeights): number[] {
  const airDensity = calculateAirDensity(input.temp_c, input.pressure_hpa, input.humidity_percent);
  const massRatio = input.motor_mass_g > 0 ? input.mass_g / input.motor_mass_g : 8;

  const featureMap: Record<string, number> = {
    mass_g: input.mass_g,
    temp_c: input.temp_c,
    humidity_percent: input.humidity_percent,
    pressure_hpa: input.pressure_hpa,
    motor_mass_g: input.motor_mass_g,
    wind_speed_mph: input.wind_speed_mph,
    air_density: airDensity,
    mass_ratio: massRatio,
  };

  // Handle one-hot motor columns for global model
  if (model.motor_columns) {
    for (const col of model.motor_columns) {
      // col looks like "motor_F51-6T"
      const motorName = col.replace('motor_', '');
      featureMap[col] = input.motor === motorName ? 1 : 0;
    }
  }

  return model.feature_names.map((name) => featureMap[name] ?? 0);
}

/**
 * Predict apogee using the best available model for the given motor.
 */
export async function predictApogee(input: MLInputFeatures): Promise<MLPrediction | null> {
  const models = await loadMLModels();
  if (!models) return null;

  // Try motor-specific model first
  const motorModel = models.motor_models[input.motor];
  if (motorModel) {
    const features = buildFeatureVector(input, motorModel);
    const predicted = linearPredict(features, motorModel);
    const count = models.training_info.motor_counts[input.motor] || 0;

    return {
      predictedApogee_ft: Math.max(0, predicted),
      confidence: count >= 8 ? 'high' : count >= 5 ? 'medium' : 'low',
      modelType: 'motor_specific',
      motorModel: input.motor,
      metrics: motorModel.metrics,
    };
  }

  // Fall back to global model
  const global = models.global_model;
  const features = buildFeatureVector(input, global);
  const predicted = linearPredict(features, global);

  return {
    predictedApogee_ft: Math.max(0, predicted),
    confidence: models.training_info.total_samples >= 20 ? 'medium' : 'low',
    modelType: 'global',
    motorModel: input.motor,
    metrics: global.metrics,
  };
}

/**
 * Compute ML-based correction for the physics simulation.
 *
 * Given the physics engine's apogee result, predict what the apogee *should* be
 * (based on historical flight data), then derive a kDrag correction factor
 * that can be fed back into the physics engine.
 *
 * The correction is clamped to a maximum of +/-20% to prevent wild adjustments.
 */
export async function computeMLCorrection(
  input: MLInputFeatures,
  physicsApogee_ft: number,
  currentKDrag: number = 1.0,
): Promise<MLCorrectionResult | null> {
  const mlPrediction = await predictApogee(input);
  if (!mlPrediction || physicsApogee_ft <= 0 || mlPrediction.predictedApogee_ft <= 0) {
    return null;
  }

  const models = await loadMLModels();
  const motorSamples = models?.training_info.motor_counts[input.motor] ?? 0;

  // correction_ratio = physics / ml
  // If ML says lower apogee → ratio > 1 → increase kDrag → physics apogee drops
  // If ML says higher apogee → ratio < 1 → decrease kDrag → physics apogee rises
  const rawRatio = physicsApogee_ft / mlPrediction.predictedApogee_ft;

  // Clamp to [0.80, 1.20] — max 20% adjustment in either direction
  const MIN_RATIO = 0.80;
  const MAX_RATIO = 1.20;
  const clampedRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, rawRatio));
  const withinBounds = rawRatio >= MIN_RATIO && rawRatio <= MAX_RATIO;

  const correctedKDrag = currentKDrag * clampedRatio;
  const adjustmentPct = (clampedRatio - 1.0) * 100;

  console.log(
    `[ML-Correction] Physics: ${physicsApogee_ft.toFixed(1)}ft, ML: ${mlPrediction.predictedApogee_ft.toFixed(1)}ft, ` +
    `ratio: ${rawRatio.toFixed(3)} → clamped: ${clampedRatio.toFixed(3)}, ` +
    `kDrag: ${currentKDrag.toFixed(3)} → ${correctedKDrag.toFixed(3)} (${adjustmentPct > 0 ? '+' : ''}${adjustmentPct.toFixed(1)}%)`,
  );

  return {
    mlApogee_ft: mlPrediction.predictedApogee_ft,
    physicsApogee_ft,
    correctionRatio: clampedRatio,
    correctedKDrag,
    confidence: mlPrediction.confidence,
    adjustmentPct,
    withinBounds,
    modelType: mlPrediction.modelType,
    motorSamples,
  };
}

/**
 * Run ML prediction alongside the physics engine and return a comparison.
 */
export async function getMLvsPhysicsComparison(
  rocket: RocketConfig,
  env: Environment,
  input: MLInputFeatures,
): Promise<PredictionComparison | null> {
  const mlResult = await predictApogee(input);
  if (!mlResult) return null;

  // Run physics simulation
  const simResult = await runSimulation(rocket, env, 90, 1.0);
  const physicsApogee_ft = simResult.apogee * 3.28084; // m → ft

  const diff = mlResult.predictedApogee_ft - physicsApogee_ft;
  const pct = physicsApogee_ft !== 0 ? (diff / physicsApogee_ft) * 100 : 0;

  // Suggested correction: ratio of ML prediction to physics prediction
  const suggestedCorrection =
    physicsApogee_ft > 0 ? mlResult.predictedApogee_ft / physicsApogee_ft : undefined;

  return {
    ml: mlResult,
    physics: { apogee_ft: physicsApogee_ft },
    difference_ft: diff,
    difference_pct: pct,
    suggestedCorrection,
  };
}

/**
 * Predict apogee for all training data records (for displaying on charts).
 */
export async function predictAllTrainingData(): Promise<
  Array<{
    motor: string;
    mass_g: number;
    actual_apogee_ft: number;
    ml_predicted_ft: number;
    residual_ft: number;
  }> | null
> {
  const models = await loadMLModels();
  if (!models) return null;

  const results = [];
  for (const record of models.training_data_summary) {
    const input: MLInputFeatures = {
      mass_g: record.mass_g,
      temp_c: record.temp_c,
      humidity_percent: record.humidity_percent,
      pressure_hpa: record.pressure_hpa,
      motor_mass_g: 0, // Not stored in summary; global model handles this gracefully
      wind_speed_mph: 0,
      motor: record.motor,
    };

    const prediction = await predictApogee(input);
    if (prediction) {
      results.push({
        motor: record.motor,
        mass_g: record.mass_g,
        actual_apogee_ft: record.apogee_ft,
        ml_predicted_ft: prediction.predictedApogee_ft,
        residual_ft: prediction.predictedApogee_ft - record.apogee_ft,
      });
    }
  }
  return results;
}

/**
 * Get model information for display purposes.
 */
export async function getModelInfo(): Promise<{
  loaded: boolean;
  totalSamples: number;
  motors: string[];
  motorCounts: Record<string, number>;
  trainedAt: string;
  globalMetrics: { loocv_mae: number; loocv_r2: number };
  motorMetrics: Record<string, { loocv_mae: number; loocv_r2: number; n_samples: number }>;
} | null> {
  const models = await loadMLModels();
  if (!models) return null;

  const motorMetrics: Record<string, { loocv_mae: number; loocv_r2: number; n_samples: number }> =
    {};
  for (const [motor, model] of Object.entries(models.motor_models)) {
    motorMetrics[motor] = {
      loocv_mae: model.metrics.loocv_mae,
      loocv_r2: model.metrics.loocv_r2,
      n_samples: model.n_samples,
    };
  }

  return {
    loaded: true,
    totalSamples: models.training_info.total_samples,
    motors: models.training_info.motors,
    motorCounts: models.training_info.motor_counts,
    trainedAt: models.training_info.trained_at,
    globalMetrics: models.global_model.metrics,
    motorMetrics,
  };
}
