#!/usr/bin/env python3
"""
Parse flight data from PDF and convert to JSON format
"""
import pdfplumber
import json
import re
from datetime import datetime

def parse_flight_data():
    """Parse flight data from PDF"""
    flights = []
    
    with pdfplumber.open('/Users/bruce/Downloads/content.pdf') as pdf:
        for page_num, page in enumerate(pdf.pages[1:], 2):  # Start from page 2
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
                    team_name = line.split('Team')[0].strip()
                    continue
                
                # Skip header row
                if 'Launch #' in line or 'Points' in line:
                    continue
                
                # Parse data row
                # Format: date Launch# Points Apogee Mass Flight_time Ascent_time Descent_time Wind_speed Wind_Dir Humidity Temp Pressure Motor_Mass Motor Motor_Serial ...
                parts = line.split()
                
                if len(parts) < 8:
                    continue
                
                try:
                    # Try to parse date
                    date_str = None
                    date_idx = 0
                    for i, part in enumerate(parts):
                        if '/' in part and len(part.split('/')) == 3:
                            date_str = part
                            date_idx = i
                            break
                    
                    if not date_str:
                        continue
                    
                    # Extract numbers
                    numbers = []
                    for part in parts[date_idx+1:]:
                        # Try to convert to number
                        try:
                            num = float(part)
                            numbers.append(num)
                        except:
                            # May be text, skip
                            pass
                    
                    if len(numbers) < 5:
                        continue
                    
                    # Build record
                    flight = {
                        'team': team_name or 'Unknown',
                        'date': date_str,
                        'launch_number': int(numbers[0]) if len(numbers) > 0 else None,
                        'points': int(numbers[1]) if len(numbers) > 1 else None,
                        'apogee_ft': numbers[2] if len(numbers) > 2 else None,
                        'mass_g': numbers[3] if len(numbers) > 3 else None,
                        'flight_time_s': numbers[4] if len(numbers) > 4 else None,
                        'ascent_time_s': numbers[5] if len(numbers) > 5 else None,
                        'descent_time_s': numbers[6] if len(numbers) > 6 else None,
                        'wind_speed_mph': numbers[7] if len(numbers) > 7 else None,
                        'raw_line': line
                    }
                    
                    # Extract text fields (wind direction, humidity, temperature, pressure, etc.)
                    # Wind direction usually after wind speed
                    wind_dir_match = re.search(r'\b(N|S|E|W|NNE|NNW|SSE|SSW|ENE|ESE|WNW|WSW)\b', line, re.IGNORECASE)
                    if wind_dir_match:
                        flight['wind_direction'] = wind_dir_match.group(1).upper()
                    
                    # Extract humidity, temperature, pressure (usually after wind direction)
                    # These are numbers but may already be in numbers
                    if len(numbers) > 8:
                        flight['humidity_percent'] = numbers[8]
                    if len(numbers) > 9:
                        flight['temp_f'] = numbers[9]
                    if len(numbers) > 10:
                        flight['pressure_inhg'] = numbers[10]
                    if len(numbers) > 11:
                        flight['motor_mass_g'] = numbers[11]
                    
                    # Extract motor model
                    motor_match = re.search(r'\b(F\d{2}-\d+T)\b', line)
                    if motor_match:
                        flight['motor'] = motor_match.group(1)
                    
                    # Check if DQ (disqualified)
                    if 'DQ' in line.upper() or flight.get('apogee_ft') is None:
                        flight['disqualified'] = True
                    else:
                        flight['disqualified'] = False
                    
                    flights.append(flight)
                    
                except Exception as e:
                    # Skip lines that failed to parse
                    continue
    
    return flights

if __name__ == '__main__':
    flights = parse_flight_data()
    
    print(f"Parsed {len(flights)} flight records")
    print("\n" + "=" * 80)
    
    # Output valid data (non-DQ)
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
    
    # Output statistics
    for team, team_flights in teams.items():
        print(f"\n{team} Team: {len(team_flights)} valid flights")
        for flight in team_flights:
            print(f"  Launch #{flight.get('launch_number')}: "
                  f"Apogee={flight.get('apogee_ft')}ft, "
                  f"Mass={flight.get('mass_g')}g, "
                  f"Wind={flight.get('wind_speed_mph')}mph {flight.get('wind_direction', 'N/A')}, "
                  f"Temp={flight.get('temp_f')}°F, "
                  f"Motor={flight.get('motor', 'N/A')}")
    
    # Save as JSON
    output_file = '/Users/bruce/Downloads/aerosim-ai_-rocketry-arc-solver/flight_data.json'
    with open(output_file, 'w') as f:
        json.dump(valid_flights, f, indent=2)
    
    print(f"\nData saved to: {output_file}")

