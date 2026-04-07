#!/usr/bin/env python3
"""
Rocket Apogee ML Training Pipeline
==================================

This version intentionally avoids sklearn/pandas so it can run in the current
local environment. It trains simple Ridge regression models using numpy only:

- global model: one model across all motors with motor one-hot features
- per-motor models: one model per motor when enough samples exist

The model is used as a data-driven correction layer alongside the physics
engine, not as a replacement for physics.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
FLIGHT_DATA_PATH = PROJECT_ROOT / "flight_data.json"
OUTPUT_PATH = PROJECT_ROOT / "ml" / "apogee_models.json"

BASE_FEATURES = [
    "mass_g",
    "temp_c",
    "humidity_percent",
    "pressure_hpa",
    "motor_mass_g",
    "wind_speed_mph",
]
DERIVED_FEATURES = ["air_density", "mass_ratio"]


def calculate_air_density(temp_c: float, pressure_hpa: float, humidity_pct: float) -> float:
    temp_k = temp_c + 273.15
    pressure_pa = pressure_hpa * 100.0
    r_d = 287.058
    r_v = 461.495
    e_s = 611.21 * math.exp((18.678 - temp_c / 234.5) * (temp_c / (257.14 + temp_c)))
    e = (humidity_pct / 100.0) * e_s
    t_v = temp_k / (1 - (e / pressure_pa) * (1 - r_d / r_v))
    return pressure_pa / (r_d * t_v)


def load_records() -> list[dict]:
    records = json.loads(FLIGHT_DATA_PATH.read_text())
    usable = [record for record in records if record.get("apogee_ft") and record.get("mass_g") and record.get("motor")]
    print(f"[INFO] Loaded {len(usable)} usable flight records from {FLIGHT_DATA_PATH}")
    return usable


def prepare_records(records: list[dict]) -> list[dict]:
    prepared = []
    for record in records:
        temp_c = record.get("temp_c")
        if temp_c is None:
            temp_f = record.get("temp_f")
            if temp_f is None:
                temp_f = 68.0
            temp_c = (temp_f - 32.0) * 5.0 / 9.0

        pressure_hpa = record.get("pressure_hpa")
        if pressure_hpa is None:
            pressure_hpa = 1013.25
        humidity_percent = record.get("humidity_percent")
        if humidity_percent is None:
            humidity_percent = 50.0
        wind_speed_mph = record.get("wind_speed_mph")
        if wind_speed_mph is None:
            wind_speed_mph = 0.0
        motor_mass_g = record.get("motor_mass_g") or 75.0
        mass_ratio = record["mass_g"] / motor_mass_g if motor_mass_g else 8.0

        prepared.append(
            {
                **record,
                "temp_c": temp_c,
                "pressure_hpa": pressure_hpa,
                "humidity_percent": humidity_percent,
                "wind_speed_mph": wind_speed_mph,
                "motor_mass_g": motor_mass_g,
                "air_density": calculate_air_density(temp_c, pressure_hpa, humidity_percent),
                "mass_ratio": mass_ratio,
            }
        )
    return prepared


def standardize_matrix(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std[std == 0] = 1.0
    return (x - mean) / std, mean, std


def ridge_fit(x: np.ndarray, y: np.ndarray, alpha: float) -> tuple[np.ndarray, float, np.ndarray, np.ndarray]:
    x_scaled, mean, std = standardize_matrix(x)
    y_mean = float(y.mean())
    centered_y = y - y_mean
    with np.errstate(all="ignore"):
        xtx = x_scaled.T @ x_scaled
    ridge = xtx + alpha * np.eye(x_scaled.shape[1])
    coef = np.linalg.solve(ridge, x_scaled.T @ centered_y)
    intercept = y_mean
    return coef, intercept, mean, std


def ridge_predict(x: np.ndarray, coef: np.ndarray, intercept: float, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    scaled = (x - mean) / std
    return intercept + scaled @ coef


def compute_r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    if ss_tot == 0:
        return 0.0
    return 1.0 - ss_res / ss_tot


def loocv_evaluate(x: np.ndarray, y: np.ndarray, alpha: float) -> dict[str, float]:
    if len(y) <= 1:
        return {"loocv_mae": 0.0, "loocv_r2": 0.0}

    predictions = np.zeros_like(y, dtype=float)
    for idx in range(len(y)):
        mask = np.ones(len(y), dtype=bool)
        mask[idx] = False
        coef, intercept, mean, std = ridge_fit(x[mask], y[mask], alpha)
        predictions[idx] = ridge_predict(x[idx : idx + 1], coef, intercept, mean, std)[0]

    mae = float(np.mean(np.abs(y - predictions)))
    r2 = compute_r2(y, predictions)
    return {"loocv_mae": round(mae, 2), "loocv_r2": round(r2, 4)}


def choose_alpha(x: np.ndarray, y: np.ndarray) -> float:
    candidates = [0.01, 0.1, 1.0, 10.0, 100.0]
    best_alpha = 1.0
    best_mae = float("inf")
    for alpha in candidates:
        metrics = loocv_evaluate(x, y, alpha)
        print(f"  alpha={alpha:>6.2f} -> LOOCV MAE={metrics['loocv_mae']:.2f} ft, R2={metrics['loocv_r2']:.4f}")
        if metrics["loocv_mae"] < best_mae:
            best_mae = metrics["loocv_mae"]
            best_alpha = alpha
    return best_alpha


def export_model(x: np.ndarray, y: np.ndarray, feature_names: list[str], alpha: float) -> dict:
    coef, intercept, mean, std = ridge_fit(x, y, alpha)
    metrics = loocv_evaluate(x, y, alpha)
    return {
        "type": "ridge",
        "alpha": alpha,
        "coefficients": [round(float(value), 6) for value in coef],
        "intercept": round(float(intercept), 6),
        "feature_names": feature_names,
        "scaler_mean": [round(float(value), 6) for value in mean],
        "scaler_std": [round(float(value), 6) for value in std],
        "metrics": metrics,
        "n_samples": len(y),
    }


def records_to_matrix(records: list[dict], feature_names: list[str]) -> np.ndarray:
    rows = []
    for record in records:
        rows.append([float(record.get(name, 0.0) or 0.0) for name in feature_names])
    return np.array(rows, dtype=float)


def train_global_model(records: list[dict]) -> dict:
    motors = sorted({record["motor"] for record in records})
    base_features = BASE_FEATURES + DERIVED_FEATURES
    motor_columns = [f"motor_{motor}" for motor in motors[1:]]
    feature_names = base_features + motor_columns

    rows = []
    for record in records:
        motor_bits = [1.0 if record["motor"] == motor else 0.0 for motor in motors[1:]]
        row = [float(record[name]) for name in base_features] + motor_bits
        rows.append(row)

    x = np.array(rows, dtype=float)
    y = np.array([float(record["apogee_ft"]) for record in records], dtype=float)

    print(f"\n[GLOBAL MODEL] Training on {len(records)} samples, {x.shape[1]} features")
    best_alpha = choose_alpha(x, y)
    model = export_model(x, y, feature_names, best_alpha)
    model["motor_columns"] = motor_columns
    model["motor_values"] = motors
    return model


def train_motor_models(records: list[dict]) -> dict[str, dict]:
    models: dict[str, dict] = {}
    feature_names = BASE_FEATURES + DERIVED_FEATURES
    for motor, count in Counter(record["motor"] for record in records).items():
        group = [record for record in records if record["motor"] == motor]
        if count < 4:
            print(f"\n[MOTOR {motor}] Skipping - only {count} samples (need >= 4)")
            continue

        x = records_to_matrix(group, feature_names)
        y = np.array([float(record["apogee_ft"]) for record in group], dtype=float)
        print(f"\n[MOTOR {motor}] Training on {count} samples, {len(feature_names)} features")
        best_alpha = choose_alpha(x, y)
        models[motor] = export_model(x, y, feature_names, best_alpha)
    return models


def build_training_summary(records: list[dict]) -> list[dict]:
    summary = []
    for record in records:
        summary.append(
            {
                "motor": record["motor"],
                "mass_g": round(float(record["mass_g"]), 3),
                "apogee_ft": round(float(record["apogee_ft"]), 3),
                "temp_c": round(float(record["temp_c"]), 6),
                "humidity_percent": round(float(record["humidity_percent"]), 6),
                "pressure_hpa": round(float(record["pressure_hpa"]), 6),
            }
        )
    return summary


def main() -> int:
    records = prepare_records(load_records())
    global_model = train_global_model(records)
    motor_models = train_motor_models(records)
    training_info = {
        "total_samples": len(records),
        "motors": sorted({record["motor"] for record in records}),
        "motor_counts": dict(Counter(record["motor"] for record in records)),
        "trained_at": datetime.utcnow().isoformat(),
        "features_base": BASE_FEATURES,
        "features_derived": DERIVED_FEATURES,
    }

    payload = {
        "global_model": global_model,
        "motor_models": motor_models,
        "training_info": training_info,
        "training_data_summary": build_training_summary(records),
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"\n[OK] Wrote trained model payload to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
