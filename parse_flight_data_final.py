#!/usr/bin/env python3
"""
Final version of flight data parser
Based on actual column format of PDF
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
                    match = re.match(r'^(\w+(?:/\w+)?)\s+Team', line)
                    if match:
                        team_name = match.group(1)
                    continue
                
                # Skip header row
                if 'Launch #' in line or 'Points' in line:
                    continue
                
                # Parse data row
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
                    data = parts[date_idx + 1:]
                    
                    if len(data) < 8:
                        continue
                    
                    # Parse by actual column order (based on PDF format)
                    # Launch# Points Apogee Mass Flight_time Ascent_time Descent_time Wind_speed Wind_Direction Humidity Temp Pressure Motor_Mass Motor ...
                    flight = {
                        'team': team_name or 'Unknown',
                        'date': date_str,
                        'launch_number': int(data[0]) if data[0].isdigit() else None,
                        'points': int(data[1]) if len(data) > 1 and data[1].isdigit() else None,
                        'apogee_ft': float(data[2]) if len(data) > 2 else None,
                        'mass_g': float(data[3]) if len(data) > 3 else None,
                        'flight_time_s': float(data[4]) if len(data) > 4 else None,
                        'ascent_time_s': float(data[5]) if len(data) > 5 and data[5].replace('.', '').isdigit() else None,
                        'raw_line': line
                    }
                    
                    # Descent time (may be after ascent time, or may be wind direction)
                    idx = 6
                    if idx < len(data):
                        # Check if number (descent time) or wind direction
                        if data[idx].replace('.', '').isdigit():
                            flight['descent_time_s'] = float(data[idx])
                            idx += 1
                        else:
                            # Compute descent time
                            if flight.get('ascent_time_s') and flight.get('flight_time_s'):
                                flight['descent_time_s'] = flight['flight_time_s'] - flight['ascent_time_s']
                    
                    # Wind speed (may be after descent time, or may be missing)
                    if idx < len(data) and data[idx].replace('.', '').isdigit():
                        wind_speed = float(data[idx])
                        if 0 <= wind_speed <= 30:  # Reasonable range
                            flight['wind_speed_mph'] = wind_speed
                            idx += 1
                        else:
                            flight['wind_speed_mph'] = 0  # Default 0
                    else:
                        flight['wind_speed_mph'] = 0  # Default 0
                    
                    # Wind direction (N, NNE, etc.)
                    if idx < len(data):
                        if data[idx] in ['N', 'S', 'E', 'W', 'NNE', 'NNW', 'SSE', 'SSW', 'ENE', 'ESE', 'WNW', 'WSW']:
                            flight['wind_direction'] = data[idx]
                            idx += 1
                    
                    # Humidity (usually 30-100%)
                    if idx < len(data):
                        try:
                            humidity = float(data[idx])
                            if 0 <= humidity <= 100:
                                flight['humidity_percent'] = humidity
                                idx += 1
                        except:
                            pass
                    
                    # Temperature (F, usually 40-100°F)
                    if idx < len(data):
                        try:
                            temp = float(data[idx])
                            if 30 <= temp <= 100:
                                flight['temp_f'] = temp
                                flight['temp_c'] = (temp - 32) * 5 / 9  # Convert to Celsius
                                idx += 1
                        except:
                            pass
                    
                    # Pressure (inHg, usually 28-31)
                    if idx < len(data):
                        try:
                            pressure = float(data[idx])
                            if 28 <= pressure <= 32:
                                flight['pressure_inhg'] = pressure
                                flight['pressure_hpa'] = pressure * 33.8639  # Convert to hPa
                                idx += 1
                        except:
                            pass
                    
                    # Motor mass (g)
                    if idx < len(data):
                        try:
                            motor_mass = float(data[idx])
                            if 50 <= motor_mass <= 100:
                                flight['motor_mass_g'] = motor_mass
                                idx += 1
                        except:
                            pass
                    
                    # Motor model
                    for i in range(idx, len(data)):
                        motor_match = re.match(r'F\d{2}-\d+T', data[i])
                        if motor_match:
                            flight['motor'] = motor_match.group(0)
                            break
                    
                    # Check DQ
                    if 'DQ' in line.upper() or flight.get('apogee_ft') is None:
                        flight['disqualified'] = True
                    else:
                        flight['disqualified'] = False
                    
                    flights.append(flight)
                    
                except Exception as e:
                    continue
    
    return flights

if __name__ == '__main__':
    flights = parse_flight_data()
    
    valid_flights = [f for f in flights if not f.get('disqualified', False) and f.get('apogee_ft')]
    
    print(f"Parsed {len(valid_flights)} valid flight records\n")
    
    # Group and analyze by motor type
    motors = {}
    for flight in valid_flights:
        motor = flight.get('motor', 'Unknown')
        if motor not in motors:
            motors[motor] = []
        motors[motor].append(flight)
    
    print("=" * 80)
    print("Analysis by motor type")
    print("=" * 80)
    
    for motor, motor_flights in sorted(motors.items()):
        print(f"\n{motor}: {len(motor_flights)} flights")
        apogees = [f['apogee_ft'] for f in motor_flights]
        masses = [f['mass_g'] for f in motor_flights]
        temps = [f.get('temp_c') for f in motor_flights if f.get('temp_c')]
        
        if apogees:
            print(f"  Apogee: {min(apogees):.1f} - {max(apogees):.1f} ft (avg: {sum(apogees)/len(apogees):.1f} ft)")
        if masses:
            print(f"  Mass: {min(masses):.1f} - {max(masses):.1f} g (avg: {sum(masses)/len(masses):.1f} g)")
        if temps:
            print(f"  Temperature: {min(temps):.1f} - {max(temps):.1f} °C (avg: {sum(temps)/len(temps):.1f} °C)")
    
    # Special analysis of 748ft data points
    print("\n" + "=" * 80)
    print("748ft flight detailed data")
    print("=" * 80)
    target = [f for f in valid_flights if abs(f.get('apogee_ft', 0) - 748) < 2]
    for flight in target:
        print(f"\nTeam: {flight.get('team')}, Launch #{flight.get('launch_number')}")
        print(f"  Apogee: {flight.get('apogee_ft')} ft")
        print(f"  Mass: {flight.get('mass_g')} g")
        print(f"  Wind speed: {flight.get('wind_speed_mph', 0)} mph ({flight.get('wind_speed_mph', 0) * 0.44704:.2f} m/s) {flight.get('wind_direction', 'N/A')}")
        print(f"  Temperature: {flight.get('temp_f')}°F ({flight.get('temp_c', 0):.1f}°C)")
        print(f"  Humidity: {flight.get('humidity_percent')}%")
        print(f"  Pressure: {flight.get('pressure_inhg')} inHg ({flight.get('pressure_hpa', 0):.1f} hPa)")
        print(f"  Motor: {flight.get('motor')}")
        print(f"  Flight time: {flight.get('flight_time_s')} s")
        print(f"  Ascent time: {flight.get('ascent_time_s')} s")
    
    # Save JSON
    output_file = '/Users/bruce/Downloads/aerosim-ai_-rocketry-arc-solver/flight_data.json'
    with open(output_file, 'w') as f:
        json.dump(valid_flights, f, indent=2)
    
    print(f"\nData saved to: {output_file}")

