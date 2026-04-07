#!/usr/bin/env python3
"""
Correctly parse flight data from PDF
Column order: Launch# Points Apogee Mass Flight_time Ascent_time Descent_time Wind_speed Wind_Direction Humidity Temp Pressure Motor_Mass Motor ...
"""
import pdfplumber
import json
import re

def parse_flight_data():
    """Parse flight data from PDF"""
    flights = []
    
    with pdfplumber.open('/Users/bruce/Downloads/content.pdf') as pdf:
        for page_num, page in enumerate(pdf.pages[1:], 2):
            text = page.extract_text()
            if not text:
                continue
            
            lines = text.split('\n')
            team_name = None
            
            for line in lines:
                line = line.strip()
                if not line or line.startswith('⬇'):
                    continue
                
                # Detect team name
                if 'Team' in line and 'Launch #' not in line:
                    # Extract team name (before "Team")
                    match = re.match(r'^(\w+(?:/\w+)?)\s+Team', line)
                    if match:
                        team_name = match.group(1)
                    continue
                
                # Skip header row
                if 'Launch #' in line or 'Points' in line:
                    continue
                
                # Parse data row
                # Format: date Launch# Points Apogee Mass Flight_time Ascent_time Descent_time Wind_speed Wind_Direction Humidity Temp Pressure Motor_Mass Motor ...
                parts = line.split()
                
                if len(parts) < 10:
                    continue
                
                try:
                    # Find date
                    date_str = None
                    date_idx = 0
                    for i, part in enumerate(parts):
                        if '/' in part and len(part.split('/')) == 3:
                            date_str = part
                            date_idx = i
                            break
                    
                    if not date_str:
                        continue
                    
                    # Parse from after date
                    data_parts = parts[date_idx + 1:]
                    
                    if len(data_parts) < 12:
                        continue
                    
                    # Parse by column order
                    flight = {
                        'team': team_name or 'Unknown',
                        'date': date_str,
                        'launch_number': int(data_parts[0]),
                        'points': int(data_parts[1]) if data_parts[1].isdigit() else None,
                        'apogee_ft': float(data_parts[2]),
                        'mass_g': float(data_parts[3]),
                        'flight_time_s': float(data_parts[4]),
                        'ascent_time_s': float(data_parts[5]) if data_parts[5].replace('.', '').isdigit() else None,
                        'descent_time_s': None,  # Need to compute from flight_time - ascent_time
                        'wind_speed_mph': None,
                        'wind_direction': None,
                        'humidity_percent': None,
                        'temp_f': None,
                        'pressure_inhg': None,
                        'motor_mass_g': None,
                        'motor': None,
                        'raw_line': line
                    }
                    
                    # Find descent time (usually after ascent time)
                    idx = 6
                    if idx < len(data_parts) and data_parts[idx].replace('.', '').isdigit():
                        flight['descent_time_s'] = float(data_parts[idx])
                        idx += 1
                    else:
                        # Compute descent time
                        if flight['ascent_time_s'] and flight['flight_time_s']:
                            flight['descent_time_s'] = flight['flight_time_s'] - flight['ascent_time_s']
                    
                    # Find wind direction (N, NNE, etc.)
                    wind_dir = None
                    for i in range(idx, min(idx + 3, len(data_parts))):
                        if data_parts[i] in ['N', 'S', 'E', 'W', 'NNE', 'NNW', 'SSE', 'SSW', 'ENE', 'ESE', 'WNW', 'WSW']:
                            wind_dir = data_parts[i]
                            idx = i + 1
                            break
                    
                    flight['wind_direction'] = wind_dir
                    
                    # Wind speed should be number after wind direction (mph)
                    if idx < len(data_parts):
                        try:
                            wind_speed = float(data_parts[idx])
                            # Wind speed usually 0-20 mph, if too large may be other data
                            if 0 <= wind_speed <= 30:
                                flight['wind_speed_mph'] = wind_speed
                                idx += 1
                        except:
                            pass
                    
                    # Humidity (usually 30-100%)
                    if idx < len(data_parts):
                        try:
                            humidity = float(data_parts[idx])
                            if 0 <= humidity <= 100:
                                flight['humidity_percent'] = humidity
                                idx += 1
                        except:
                            pass
                    
                    # Temperature (F, usually 40-100°F)
                    if idx < len(data_parts):
                        try:
                            temp = float(data_parts[idx])
                            if 30 <= temp <= 100:
                                flight['temp_f'] = temp
                                idx += 1
                        except:
                            pass
                    
                    # Pressure (inHg, usually 28-31)
                    if idx < len(data_parts):
                        try:
                            pressure = float(data_parts[idx])
                            if 28 <= pressure <= 32:
                                flight['pressure_inhg'] = pressure
                                idx += 1
                        except:
                            pass
                    
                    # Motor mass (g)
                    if idx < len(data_parts):
                        try:
                            motor_mass = float(data_parts[idx])
                            if 50 <= motor_mass <= 100:
                                flight['motor_mass_g'] = motor_mass
                                idx += 1
                        except:
                            pass
                    
                    # Motor model (F42-8T format)
                    for i in range(idx, len(data_parts)):
                        motor_match = re.match(r'F\d{2}-\d+T', data_parts[i])
                        if motor_match:
                            flight['motor'] = motor_match.group(0)
                            break
                    
                    # Check if DQ
                    if 'DQ' in line.upper() or flight.get('apogee_ft') is None:
                        flight['disqualified'] = True
                    else:
                        flight['disqualified'] = False
                    
                    flights.append(flight)
                    
                except Exception as e:
                    print(f"Parse error: {line[:100]}... Error: {e}")
                    continue
    
    return flights

if __name__ == '__main__':
    flights = parse_flight_data()
    
    print(f"Parsed {len(flights)} flight records")
    print("\n" + "=" * 80)
    
    # Output valid data
    valid_flights = [f for f in flights if not f.get('disqualified', False) and f.get('apogee_ft')]
    print(f"Valid flight records: {len(valid_flights)}")
    print("=" * 80)
    
    # Group by team
    teams = {}
    for flight in valid_flights:
        team = flight.get('team', 'Unknown')
        if team not in teams:
            teams[team] = []
        teams[team].append(flight)
    
    # Output detailed statistics
    for team, team_flights in sorted(teams.items()):
        print(f"\n{team} Team: {len(team_flights)} valid flights")
        for flight in team_flights:
            print(f"  Launch #{flight.get('launch_number')}: "
                  f"Apogee={flight.get('apogee_ft')}ft, "
                  f"Mass={flight.get('mass_g')}g, "
                  f"Wind={flight.get('wind_speed_mph', 'N/A')}mph {flight.get('wind_direction', 'N/A')}, "
                  f"Temp={flight.get('temp_f', 'N/A')}°F, "
                  f"Humidity={flight.get('humidity_percent', 'N/A')}%, "
                  f"Motor={flight.get('motor', 'N/A')}")
    
    # Focus on 748ft data points
    print("\n" + "=" * 80)
    print("Key data point: 748ft flight")
    print("=" * 80)
    target_flights = [f for f in valid_flights if abs(f.get('apogee_ft', 0) - 748) < 5]
    for flight in target_flights:
        print(f"Team: {flight.get('team')}, Launch #{flight.get('launch_number')}")
        print(f"  Apogee: {flight.get('apogee_ft')}ft")
        print(f"  Mass: {flight.get('mass_g')}g")
        print(f"  Wind: {flight.get('wind_speed_mph', 'N/A')}mph {flight.get('wind_direction', 'N/A')}")
        print(f"  Temp: {flight.get('temp_f', 'N/A')}°F")
        print(f"  Humidity: {flight.get('humidity_percent', 'N/A')}%")
        print(f"  Pressure: {flight.get('pressure_inhg', 'N/A')}inHg")
        print(f"  Motor: {flight.get('motor', 'N/A')}")
        print()
    
    # Save as JSON
    output_file = '/Users/bruce/Downloads/aerosim-ai_-rocketry-arc-solver/flight_data.json'
    with open(output_file, 'w') as f:
        json.dump(valid_flights, f, indent=2)
    
    print(f"\nData saved to: {output_file}")

