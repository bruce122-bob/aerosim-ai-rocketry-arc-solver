#!/usr/bin/env python3
"""
Import BrookX ARC launch log PDF data into flight_data.json.

This importer is designed for the 2026 launch log layout currently used by the
project. It extracts page text with PDFKit through Swift, then parses the team
tables into a normalized JSON dataset for calibration and ML training.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = Path("/Users/brucegu/Downloads/2026 Rocketry Launch Log and Analysis.pdf")
DEFAULT_OUTPUT = PROJECT_ROOT / "flight_data.json"
PUBLIC_OUTPUT = PROJECT_ROOT / "public" / "flight_data.json"

TEAM_PAGES = range(4, 10)  # 1-based PDF page numbers that contain team tables
WIND_DIRECTIONS = {
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
    "No Wind",
    "SWW",
}


def run_swift_pdf_extract(pdf_path: Path) -> dict[int, str]:
    escaped_path = str(pdf_path).replace('"', '\\"')
    swift_program = f"""
import PDFKit
import Foundation

let url = URL(fileURLWithPath: "{escaped_path}")
guard let document = PDFDocument(url: url) else {{
    fputs("Failed to open PDF\\n", stderr)
    exit(1)
}}

for index in 0..<document.pageCount {{
    let text = document.page(at: index)?.string ?? ""
    let safeText = text.replacingOccurrences(of: "\\u{{1e}}", with: " ")
    print("<<<PAGE:\\(index + 1)>>>")
    print(safeText)
}}
"""
    result = subprocess.run(
        [
            "env",
            "SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache",
            "CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache",
            "swift",
            "-e",
            swift_program,
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    pages: dict[int, str] = {}
    current_page: int | None = None
    buffer: list[str] = []
    for line in result.stdout.splitlines():
        if line.startswith("<<<PAGE:") and line.endswith(">>>"):
            if current_page is not None:
                pages[current_page] = "\n".join(buffer).strip()
            current_page = int(line[len("<<<PAGE:") : -len(">>>")])
            buffer = []
        else:
            buffer.append(line)
    if current_page is not None:
        pages[current_page] = "\n".join(buffer).strip()
    return pages


def parse_launches(page_text: str) -> list[dict[str, Any]]:
    matches = re.findall(
        r"(\d{1,2}/\d{1,2}/\d{4})\s+(\d+)\s+([^\d]+?)(?=\s+\d{1,2}/\d{1,2}/\d{4}\s+\d+\s+|\s+Performance / Results)",
        page_text,
    )
    launches = []
    for date, launch_number, location in matches:
        launches.append(
            {
                "date": date,
                "launch_number": int(launch_number),
                "location": " ".join(location.split()),
            }
        )
    return launches


def _coerce_numeric(token: str | None) -> float | None:
    if token is None or token in {"DQ", "N/A"}:
        return None
    try:
        return float(token)
    except (TypeError, ValueError):
        return None


def parse_performance_rows(page_text: str, launch_count: int) -> list[dict[str, Any]]:
    if "Performance / Results" not in page_text or "Environment / Weather" not in page_text:
        return [{} for _ in range(launch_count)]

    segment = page_text.split("Performance / Results", 1)[1].split("Environment / Weather", 1)[0]
    tokens = re.findall(r"DQ|N/A|\d+(?:\.\d+)?", segment)

    while len(tokens) > launch_count * 3:
        tokens.pop()

    rows: list[dict[str, Any]] = []
    for i in range(0, min(len(tokens), launch_count * 3), 3):
        triple = tokens[i : i + 3]
        if len(triple) < 3:
            break
        points_token, apogee_token, flight_time_token = triple
        rows.append(
            {
                "points": _coerce_numeric(points_token),
                "apogee_ft": _coerce_numeric(apogee_token),
                "flight_time_s": _coerce_numeric(flight_time_token),
                "raw_points_token": points_token,
                "raw_apogee_token": apogee_token,
                "raw_flight_time_token": flight_time_token,
            }
        )

    while len(rows) < launch_count:
        rows.append(
            {
                "points": None,
                "apogee_ft": None,
                "flight_time_s": None,
                "raw_points_token": None,
                "raw_apogee_token": None,
                "raw_flight_time_token": None,
            }
        )
    return rows[:launch_count]


def parse_environment_rows(page_text: str, launch_count: int) -> list[dict[str, Any]]:
    if "Environment / Weather" not in page_text or "Rocket Physical Specs" not in page_text:
        return [{} for _ in range(launch_count)]

    segment = page_text.split("Environment / Weather", 1)[1].split("Rocket Physical Specs", 1)[0]
    segment = segment.replace("No Wind", "NoWind")
    tokens = re.findall(
        r"NoWind|SWW|NNE|NNW|ENE|ESE|SSE|SSW|WNW|WSW|NE|NW|SE|SW|N|S|E|W|\d+(?:\.\d+)?",
        segment,
    )

    rows: list[dict[str, Any]] = []
    idx = 0
    while idx < len(tokens) and len(rows) < launch_count:
        try:
            wind_speed = float(tokens[idx])
        except ValueError:
            idx += 1
            continue

        if wind_speed < 0 or wind_speed > 20:
            idx += 1
            continue

        next_idx = idx + 1
        wind_direction = None
        if next_idx < len(tokens) and tokens[next_idx] in WIND_DIRECTIONS:
            wind_direction = tokens[next_idx].replace("NoWind", "No Wind")
            next_idx += 1

        numeric_tail: list[float] = []
        while next_idx < len(tokens) and len(numeric_tail) < 3:
            token = tokens[next_idx]
            if token in WIND_DIRECTIONS:
                break
            try:
                numeric_tail.append(float(token))
            except ValueError:
                break
            next_idx += 1

        pressure = next((value for value in numeric_tail if 28 <= value <= 32), None)
        remaining = [value for value in numeric_tail if value != pressure or numeric_tail.count(value) > 1]
        humidity = next((value for value in remaining if 0 <= value <= 100), None)
        temp = next((value for value in remaining if 30 <= value <= 110 and value != humidity), None)

        rows.append(
            {
                "wind_speed_mph": wind_speed,
                "wind_direction": wind_direction,
                "humidity_percent": humidity,
                "temp_f": temp,
                "pressure_inhg": pressure,
            }
        )
        idx = next_idx

    while len(rows) < launch_count:
        rows.append({})
    return rows[:launch_count]


def parse_mass_rows(page_text: str) -> list[dict[str, Any]]:
    if "Rocket Physical Specs" not in page_text:
        return []

    segment = page_text.split("Rocket Physical Specs", 1)[1]
    matches = re.findall(r"(N/A|\d+(?:\.\d+)?)\s+(\?|\d+(?:\.\d+)?)\s+(F\d{2}-\d+T|F51-9T)", segment)
    rows = []
    for mass_token, motor_mass_token, motor in matches:
        rows.append(
            {
                "mass_g": None if mass_token == "N/A" else float(mass_token),
                "motor_mass_g": None if motor_mass_token == "?" else float(motor_mass_token),
                "motor": motor,
            }
        )
    return rows


def convert_pressure_to_hpa(pressure_inhg: float | None) -> float | None:
    return None if pressure_inhg is None else round(pressure_inhg * 33.8639, 6)


def convert_temp_to_c(temp_f: float | None) -> float | None:
    return None if temp_f is None else round((temp_f - 32.0) * 5.0 / 9.0, 6)


def build_records_for_page(page_number: int, page_text: str) -> list[dict[str, Any]]:
    team = page_text.split("Launch #", 1)[0].replace("Rocket / Team Info", "").strip()
    launches = parse_launches(page_text)
    performance_rows = parse_performance_rows(page_text, len(launches))
    environment_rows = parse_environment_rows(page_text, len(launches))
    mass_rows = parse_mass_rows(page_text)

    records: list[dict[str, Any]] = []
    for index, launch in enumerate(launches):
        performance = performance_rows[index]
        env = environment_rows[index] if index < len(environment_rows) else {}
        mass_row = mass_rows[index] if index < len(mass_rows) else {}

        points = performance.get("points")
        apogee_ft = performance.get("apogee_ft")
        flight_time_s = performance.get("flight_time_s")
        mass_g = mass_row.get("mass_g")
        motor = mass_row.get("motor")

        is_prediction_artifact = (
            points is not None
            and apogee_ft is not None
            and flight_time_s is not None
            and points > 300
            and abs(points - apogee_ft) < 0.01
        )
        usable_for_calibration = (
            points is not None
            and apogee_ft is not None
            and flight_time_s is not None
            and mass_g is not None
            and bool(motor)
            and not is_prediction_artifact
            and "Prediction row" not in launch["location"]
        )

        record = {
            "team": team,
            "date": launch["date"],
            "launch_number": launch["launch_number"],
            "location": launch["location"],
            "points": points,
            "apogee_ft": apogee_ft,
            "mass_g": mass_g,
            "flight_time_s": flight_time_s,
            "ascent_time_s": None,
            "wind_speed_mph": env.get("wind_speed_mph"),
            "wind_direction": env.get("wind_direction"),
            "humidity_percent": env.get("humidity_percent"),
            "temp_f": env.get("temp_f"),
            "temp_c": convert_temp_to_c(env.get("temp_f")),
            "pressure_inhg": env.get("pressure_inhg"),
            "pressure_hpa": convert_pressure_to_hpa(env.get("pressure_inhg")),
            "motor_mass_g": mass_row.get("motor_mass_g"),
            "motor": motor,
            "disqualified": not usable_for_calibration,
            "usable_for_calibration": usable_for_calibration,
            "source_pdf_page": page_number,
            "source": "2026 Rocketry Launch Log and Analysis.pdf",
            "raw_tokens": {
                "points": performance.get("raw_points_token"),
                "apogee": performance.get("raw_apogee_token"),
                "flight_time": performance.get("raw_flight_time_token"),
            },
        }
        records.append(record)
    return records


def import_pdf(pdf_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    page_texts = run_swift_pdf_extract(pdf_path)
    all_records: list[dict[str, Any]] = []
    for page_number in TEAM_PAGES:
        page_text = page_texts.get(page_number)
        if not page_text:
            continue
        all_records.extend(build_records_for_page(page_number, page_text))

    usable_records = [record for record in all_records if record["usable_for_calibration"]]
    usable_records.sort(
        key=lambda record: (
            datetime.strptime(record["date"], "%m/%d/%Y"),
            record["team"],
            record["launch_number"],
        )
    )

    summary = {
        "total_rows_seen": len(all_records),
        "usable_rows_written": len(usable_records),
        "teams": dict(Counter(record["team"] for record in usable_records)),
        "motors": dict(Counter(record["motor"] for record in usable_records)),
    }
    return usable_records, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Import BrookX ARC launch log PDF into flight_data.json")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF, help="Path to the launch log PDF")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Where to write the JSON dataset")
    args = parser.parse_args()

    if not args.pdf.exists():
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 1

    records, summary = import_pdf(args.pdf)
    output_json = json.dumps(records, indent=2)
    args.output.write_text(output_json)
    PUBLIC_OUTPUT.write_text(output_json)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
