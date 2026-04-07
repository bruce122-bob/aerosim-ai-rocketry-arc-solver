// Motors & Configuration Page
// Supports .ork file upload, NASA SLI motor selection, environment configuration

import React, { useState, useMemo, useRef } from 'react';
import { RocketConfig, MotorData } from '../types';
import { MOTOR_DATABASE, filterMotors } from '../data/motorDatabase';
import { parseORKFile } from '../services/ork';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { calculateDryMass, calculateReferenceArea } from '../services/rocketUtils';
import { calculateCG, calculateCP, calculateStability, resolveStabilityReferenceLength } from '../services/stability';
import RocketDesignViewer from './RocketDesignViewer';

interface Props {
  rocket: RocketConfig;
  setRocket: React.Dispatch<React.SetStateAction<RocketConfig>>;
  orkFileName: string | null;
  setOrkFileName: React.Dispatch<React.SetStateAction<string | null>>;
}

const MotorConfig: React.FC<Props> = ({ rocket, setRocket, orkFileName, setOrkFileName }) => {
  const [selectedMotor, setSelectedMotor] = useState<MotorData>(rocket.motor);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [motorClassFilter, setMotorClassFilter] = useState<string>('All');
  const [showMotorDetails, setShowMotorDetails] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [viewMode, setViewMode] = useState<'motors' | 'design'>('motors');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [delayTime, setDelayTime] = useState<string>('');

  // Filter motors (focus on F-series and SLI)
  const filteredMotors = useMemo(() => {
    let motors = filterMotors(MOTOR_DATABASE, 'All', motorClassFilter, searchQuery);

    // Prioritize F, H, I series (NASA SLI related)
    motors = motors.sort((a, b) => {
      const aClass = a.name.match(/\b([A-J])\d/)?.[1] || 'Z';
      const bClass = b.name.match(/\b([A-J])\d/)?.[1] || 'Z';
      const priority = ['F', 'H', 'I', 'G', 'J', 'E', 'D', 'C', 'B', 'A'];
      return priority.indexOf(aClass) - priority.indexOf(bClass);
    });

    return motors;
  }, [motorClassFilter, searchQuery]);

  // NASA SLI common motors quick select
  const sliMotors = useMemo(() => {
    return MOTOR_DATABASE.filter(m =>
      m.name.includes('H') || m.name.includes('I')
    ).slice(0, 6);
  }, []);

  // F-series quick select
  const fSeriesMotors = useMemo(() => {
    return MOTOR_DATABASE.filter(m => m.name.includes('F')).slice(0, 6);
  }, []);

  // Handle .ork file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus('Parsing .ork file...');

    try {
      console.log('File upload started:', file.name, 'Size:', file.size);

      const result = await parseORKFile(file);

      if (result.success && result.rocket) {
        // Clear manual overrides when loading new file - use parsed values instead
        const rocketWithoutOverrides = {
          ...result.rocket,
          manualOverride: undefined
        };
        setRocket(rocketWithoutOverrides);
        setOrkFileName(file.name);
        setUploadStatus(`✅ Loaded: ${file.name}`);

        if (result.warnings && result.warnings.length > 0) {
          console.warn('ORK parsing warnings:', result.warnings);
          result.warnings.forEach(w => console.warn('- ' + w));
        }

        setTimeout(() => setUploadStatus(''), 5000);
      } else {
        console.error('ORK parsing failed:', result.error);
        setUploadStatus(`❌ ${result.error || 'Parsing failed'}`);
        // Don't auto-clear error message so user can see it
      }
    } catch (error) {
      console.error('File upload error:', error);
      setUploadStatus(`❌ Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Clear file input to allow re-uploading same file
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleSelectMotor = (motor: MotorData) => {
    setSelectedMotor(motor);
    // Extract delay time from motor name if available (e.g., F51-6T -> 6)
    const delayMatch = motor.name.match(/-(\d+)[A-Z]?$/);
    if (delayMatch) {
      setDelayTime(delayMatch[1]);
    } else if (motor.delayTime !== undefined) {
      setDelayTime(motor.delayTime.toString());
    } else {
      setDelayTime('');
    }
    setShowMotorDetails(true);
  };

  const handleApplyMotor = () => {
    // Apply delay time if specified
    const motorWithDelay: MotorData = {
      ...selectedMotor,
      delayTime: delayTime ? parseFloat(delayTime) : undefined
    };
    setRocket(prev => ({ ...prev, motor: motorWithDelay }));
    setShowMotorDetails(false);
  };

  // Calculate rocket statistics
  const rocketStats = useMemo(() => {
    const importedDryMass =
      rocket.simulationSettings?.mass !== undefined &&
      rocket.motor?.totalMass !== undefined &&
      rocket.simulationSettings.mass > rocket.motor.totalMass
        ? rocket.simulationSettings.mass - rocket.motor.totalMass
        : undefined;
    const dryMass = rocket.manualOverride?.mass || importedDryMass || calculateDryMass(rocket.stages);
    const refArea = calculateReferenceArea(rocket.stages);
    const cg = calculateCG(rocket.stages);
    const cp = calculateCP(rocket.stages);
    // Use CG/CP from file if available (priority)
    const fileCG = rocket.simulationSettings?.cg;
    const fileCP = rocket.simulationSettings?.cp;

    // Priority: Manual calibration > File data > Auto-calculated
    let finalCG = (fileCG !== undefined && fileCG > 0) ? fileCG : cg;
    let finalCP = (fileCP !== undefined && fileCP > 0) ? fileCP : cp;

    if (rocket.manualOverride?.cg !== undefined) finalCG = rocket.manualOverride.cg;
    if (rocket.manualOverride?.cp !== undefined) finalCP = rocket.manualOverride.cp;

    // Calculate diameter
    const autoDiameter = Math.sqrt(refArea / Math.PI) * 2; // diameter from area
    const finalDiameter = rocket.manualOverride?.diameter !== undefined
      ? rocket.manualOverride.diameter
      : autoDiameter;

    // Calculate Cd (drag coefficient)
    const finalCd = rocket.manualOverride?.cdOverride !== undefined
      ? rocket.manualOverride.cdOverride
      : (rocket.cdOverride || 0.5);

    // Calculate stability - use OpenRocket reference length if available
    // Determine reference length
    const referenceLengthForStability = resolveStabilityReferenceLength(
      rocket.stages,
      rocket.simulationSettings?.referenceLength
    );
    if (rocket.simulationSettings?.referenceLength && rocket.simulationSettings.referenceLength > 0) {
      // Use referenceLength from .ork file (OpenRocket method)
      console.log(`[Stability] Using referenceLength from .ork file: ${referenceLengthForStability}m (${(referenceLengthForStability * 39.3701).toFixed(2)}in)`);
    } else {
      // Fall back to maximum diameter (caliber method)
      console.log(`[Stability] Using maximum diameter as reference length: ${referenceLengthForStability}m (${(referenceLengthForStability * 39.3701).toFixed(2)}in)`);
    }

    // Use CG/CP values extracted from file (if available) to calculate stability
    const stability = referenceLengthForStability > 0 ? (finalCP - finalCG) / referenceLengthForStability : 0;

    return {
      dryMass: (dryMass * 1000).toFixed(1), // kg to grams
      refArea: (refArea * 1550.003).toFixed(2), // m² to in²
      diameter: (finalDiameter * 39.3701).toFixed(2), // m to inches
      cd: finalCd.toFixed(3),
      cg: (finalCG * 39.3701).toFixed(2), // m to inches
      cp: (finalCP * 39.3701).toFixed(2), // m to inches
      stability: stability.toFixed(2),
      isManual: !!rocket.manualOverride
    };
  }, [rocket]);

  // Manual calibration state
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibCG, setCalibCG] = useState<string>('');
  const [calibCP, setCalibCP] = useState<string>('');
  const [calibMass, setCalibMass] = useState<string>('');
  const [calibDiameter, setCalibDiameter] = useState<string>('');
  const [calibCd, setCalibCd] = useState<string>('');

  const startCalibration = () => {
    setCalibCG(rocketStats.cg);
    setCalibCP(rocketStats.cp);
    setCalibMass(rocketStats.dryMass);
    setCalibDiameter(rocketStats.diameter);
    setCalibCd(rocketStats.cd);
    setIsCalibrating(true);
  };

  const applyCalibration = () => {
    const newCG = parseFloat(calibCG) / 39.3701; // in -> m
    const newCP = parseFloat(calibCP) / 39.3701; // in -> m
    const newMass = parseFloat(calibMass) / 1000; // g -> kg
    const newDiameter = parseFloat(calibDiameter) / 39.3701; // in -> m
    const newCd = parseFloat(calibCd);

    if (!isNaN(newCG) && !isNaN(newCP) && !isNaN(newMass) && !isNaN(newDiameter) && !isNaN(newCd)) {
      setRocket(prev => ({
        ...prev,
        manualOverride: {
          cg: newCG,
          cp: newCP,
          mass: newMass,
          diameter: newDiameter,
          cdOverride: newCd
        },
        cdOverride: newCd // Also update the rocket's cdOverride
      }));
      setIsCalibrating(false);
    } else {
      alert("Please enter valid numbers for all fields");
    }
  };

  const resetCalibration = () => {
    setRocket(prev => {
      const { manualOverride, ...rest } = prev;
      return rest;
    });
    setIsCalibrating(false);
  };

  return (
    <div className="flex h-full bg-[#0a1020] text-slate-100">

      {/* ============= Left: File Upload + Rocket Info ============= */}
      <div className="flex w-96 flex-col border-r border-slate-800 bg-[#0b1220]">

        {/* Title */}
        <div className="border-b border-slate-800 bg-[#0b1220] px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">
            Configuration
          </h2>
        </div>

        {/* File upload area */}
        <div className="border-b border-slate-800 bg-[#0f172a] p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-100">
            Upload OpenRocket File
          </h3>
          <p className="mb-3 text-xs text-slate-400">
            Export .ork file from OpenRocket, then upload here
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".ork,.xml"
            onChange={handleFileUpload}
            className="hidden"
            id="ork-file-input"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center rounded-lg bg-cyan-500 px-4 py-2.5 font-medium text-slate-950 transition-colors hover:bg-cyan-400"
          >
            <span>Select .ork file</span>
          </button>

          {uploadStatus && (
            <div className={`mt-3 rounded-lg p-3 text-sm ${uploadStatus.startsWith('✅')
              ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
              : 'border border-rose-500/20 bg-rose-500/10 text-rose-200'
              }`}>
              <div className="font-medium mb-1">{uploadStatus.split('\n')[0]}</div>
              {uploadStatus.includes('\n') && (
                <div className="text-xs mt-2 space-y-1">
                  {uploadStatus.split('\n').slice(1).map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                </div>
              )}
              {uploadStatus.startsWith('❌') && (
                <button
                  onClick={() => setUploadStatus('')}
                  className="mt-2 rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-200 transition-colors hover:bg-rose-500/30"
                >
                  Got it, continue with default
                </button>
              )}
            </div>
          )}

          {!orkFileName && !uploadStatus && (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">
              Tip: Currently using default rocket. Upload .ork file to use your own design.
            </div>
          )}
        </div>

        {/* Rocket information */}
        <div className="border-b border-slate-800 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-100">
            Rocket Information
          </h3>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
              <span className="text-slate-400">File:</span>
              <span className="ml-2 max-w-[180px] truncate font-medium text-slate-100">
                {orkFileName || 'Not loaded'}
              </span>
            </div>

            {isCalibrating ? (
              <div className="space-y-3 rounded border border-amber-500/20 bg-amber-500/10 p-3">
                <h4 className="mb-2 text-xs font-bold text-amber-200">Manual Calibration</h4>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs text-slate-400">Dry Mass (g):</span>
                  <input
                    type="number"
                    step="0.1"
                    value={calibMass}
                    onChange={e => setCalibMass(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#020817] px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs text-slate-400">CG Position (in):</span>
                  <input
                    type="number"
                    step="0.01"
                    value={calibCG}
                    onChange={e => setCalibCG(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#020817] px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs text-slate-400">CP Position (in):</span>
                  <input
                    type="number"
                    step="0.01"
                    value={calibCP}
                    onChange={e => setCalibCP(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#020817] px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs text-slate-400">Diameter (in):</span>
                  <input
                    type="number"
                    step="0.01"
                    value={calibDiameter}
                    onChange={e => setCalibDiameter(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#020817] px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <span className="text-xs text-slate-400">Cd Coefficient:</span>
                  <input
                    type="number"
                    step="0.001"
                    value={calibCd}
                    onChange={e => setCalibCd(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#020817] px-2 py-1 text-xs text-slate-100"
                  />
                </div>
                <div className="flex space-x-2 mt-2">
                  <button onClick={applyCalibration} className="flex-1 rounded bg-cyan-500 py-1 text-xs text-slate-950 hover:bg-cyan-400">Apply</button>
                  <button onClick={() => setIsCalibrating(false)} className="flex-1 rounded bg-slate-700 py-1 text-xs text-slate-200 hover:bg-slate-600">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">Dry Mass:</span>
                  <span className="font-medium text-slate-100">{rocketStats.dryMass} g</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">Ref Area:</span>
                  <span className="font-medium text-slate-100">{rocketStats.refArea} in²</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">Diameter:</span>
                  <span className="font-medium text-slate-100">{rocketStats.diameter} in</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">Cd Coefficient:</span>
                  <span className="font-medium text-slate-100">{rocketStats.cd}</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">CG Position:</span>
                  <span className="font-medium text-slate-100">{rocketStats.cg} in</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">CP Position:</span>
                  <span className="font-medium text-slate-100">{rocketStats.cp} in</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-[#0f172a] p-2">
                  <span className="text-slate-400">Stability:</span>
                  <span className={`font-medium ${parseFloat(rocketStats.stability) > 1 ? 'text-green-600' : 'text-red-600'}`}>
                    {rocketStats.stability} cal
                  </span>
                </div>

                {/* Calibration button */}
                {orkFileName && (
                  <div className="mt-2 flex space-x-2">
                    <button
                      onClick={startCalibration}
                      className="flex flex-1 items-center justify-center rounded border border-slate-700 bg-[#020817] py-1.5 text-xs text-slate-300 hover:border-cyan-500/30 hover:text-cyan-200"
                    >
                      <i className="fas fa-edit mr-1"></i> Manual Calibration
                    </button>
                    {rocketStats.isManual && (
                      <button
                        onClick={resetCalibration}
                        className="rounded border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/15"
                        title="Reset to auto-calculation"
                      >
                        <i className="fas fa-undo"></i>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Current Motor */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-100">
            Current Motor
          </h3>

          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3">
            <div className="mb-2 font-semibold text-slate-100">{rocket.motor.name}</div>
            <div className="space-y-1 text-xs text-slate-300">
              <div>Total Impulse: {(rocket.motor.totalImpulse || (rocket.motor.averageThrust || 0) * (rocket.motor.burnTime || 0)).toFixed(1)} Ns</div>
              <div>Avg Thrust: {(rocket.motor.averageThrust || 0).toFixed(1)} N</div>
              <div>Burn Time: {(rocket.motor.burnTime || 0).toFixed(2)} s</div>
            </div>
          </div>

          {/* Parsed Physical Properties */}
          {rocket.finish && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-[#0f172a] p-3">
              <h4 className="mb-1 text-xs font-bold text-slate-300">Parsed Physical Properties</h4>
              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Surface Finish:</span>
                  <span className="font-medium">{rocket.finish}</span>
                </div>
                {rocket.simulationSettings?.launchRodLength && (
                  <div className="flex justify-between">
                    <span>Launch Rod:</span>
                    <span className="font-medium">{rocket.simulationSettings.launchRodLength}m</span>
                  </div>
                )}
                {rocket.simulationSettings?.windSpeed && (
                  <div className="flex justify-between">
                    <span>Wind Speed:</span>
                    <span className="font-medium">{rocket.simulationSettings.windSpeed}m/s</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============= Middle: Motor Database / Rocket Design ============= */}
      <div className="flex flex-1 flex-col bg-[#0a1020]">

        {/* Title bar with Tabs */}
        <div className="border-b border-slate-800 bg-[#0b1220]">
          <div className="flex items-center px-6 py-3">
            <h2 className="flex-1 text-base font-semibold text-slate-100">
              {viewMode === 'motors' ? 'Motor Database' : 'Rocket Design'}
            </h2>
            <div className="flex gap-1">
              <button
                onClick={() => setViewMode('motors')}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${viewMode === 'motors'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-[#0f172a] text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
              >
                Motors
              </button>
              <button
                onClick={() => setViewMode('design')}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${viewMode === 'design'
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-[#0f172a] text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
              >
                Design
              </button>
            </div>
          </div>
        </div>

        {/* Content based on view mode */}
        {viewMode === 'design' ? (
          <div className="flex-1 overflow-y-auto">
            <RocketDesignViewer rocket={rocket} />
          </div>
        ) : (
          <>

            {/* Quick selection */}
            <div className="border-b border-slate-800 bg-[#0f172a] p-4">
              <div className="mb-3">
                <h4 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">NASA SLI Common Motors</h4>
                <div className="grid grid-cols-3 gap-2">
                  {sliMotors.map((motor, idx) => (
                    <button
                      key={`sli-${idx}-${motor.name}`}
                      onClick={() => handleSelectMotor(motor)}
                      className="rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/30 hover:text-cyan-200"
                    >
                      {motor.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">F-Series Motors</h4>
                <div className="grid grid-cols-3 gap-2">
                  {fSeriesMotors.map((motor, idx) => (
                    <button
                      key={`f-${idx}-${motor.name}`}
                      onClick={() => handleSelectMotor(motor)}
                      className="rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/30 hover:text-cyan-200"
                    >
                      {motor.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Search and filter */}
            <div className="flex items-center space-x-3 border-b border-slate-800 p-4">
              <div className="flex-1 relative">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 transform text-slate-500"></i>
                <input
                  type="text"
                  placeholder="Search motors..."
                  className="w-full rounded-lg border border-slate-700 bg-[#020817] py-2 pl-9 pr-3 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
                value={motorClassFilter}
                onChange={(e) => setMotorClassFilter(e.target.value)}
              >
                <option value="All">All Classes</option>
                <option value="F">F-Class</option>
                <option value="G">G-Class</option>
                <option value="H">H-Class (SLI)</option>
                <option value="I">I-Class (SLI)</option>
                <option value="J">J-Class</option>
              </select>
            </div>

            {/* Motor List */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-2">
                {filteredMotors.map((motor, idx) => {
                  const motorClass = motor.name.match(/\b([A-J])\d/)?.[1] || '?';
                  const isSLI = motor.name.includes('SLI') || motor.name.includes('Sub Scale') || ['H', 'I'].includes(motorClass);

                  return (
                    <button
                      key={`motor-list-${idx}-${motor.name}-${motor.manufacturer || ''}`}
                      onClick={() => handleSelectMotor(motor)}
                      className={`p-3 border rounded-lg text-left transition-colors ${selectedMotor.name === motor.name
                        ? 'border-cyan-500/50 bg-cyan-500/10'
                        : 'border-slate-800 bg-[#0b1220] hover:border-cyan-500/30'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-100">{motor.name}</span>
                        {isSLI && (
                          <span className="rounded border border-cyan-500/20 bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-200">
                            SLI
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
                        <span>Thrust: {(motor.averageThrust || 0).toFixed(0)}N</span>
                        <span>Time: {(motor.burnTime || 0).toFixed(2)}s</span>
                        <span>Impulse: {(motor.totalImpulse || (motor.averageThrust || 0) * (motor.burnTime || 0)).toFixed(0)}Ns</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ============= Right: Motor Details ============= */}
      {showMotorDetails && (
        <div className="flex w-96 flex-col border-l border-slate-800 bg-[#0b1220]">
          <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <h2 className="font-bold text-white text-lg flex items-center">
              <i className="fas fa-info-circle mr-2 text-slate-400"></i>
              Motor Details
            </h2>
            <button
              onClick={() => setShowMotorDetails(false)}
              className="text-white hover:text-slate-200"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Basic Information */}
            <div>
              <h3 className="mb-3 text-xl font-bold text-slate-100">{selectedMotor.name}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded bg-[#0f172a] p-2">
                  <div className="text-xs text-slate-500">Manufacturer</div>
                  <div className="font-semibold text-slate-100">{selectedMotor.manufacturer || 'N/A'}</div>
                </div>
                <div className="rounded bg-[#0f172a] p-2">
                  <div className="text-xs text-slate-500">Diameter</div>
                  <div className="font-semibold text-slate-100">{((selectedMotor.diameter || 0) * 1000).toFixed(0)} mm</div>
                </div>
                <div className="rounded bg-[#0f172a] p-2">
                  <div className="text-xs text-slate-500">Length</div>
                  <div className="font-semibold text-slate-100">{((selectedMotor.length || 0) * 1000).toFixed(0)} mm</div>
                </div>
                <div className="rounded bg-[#0f172a] p-2">
                  <div className="text-xs text-slate-500">Total Mass</div>
                  <div className="font-semibold text-slate-100">{((selectedMotor.totalMass || 0) * 1000).toFixed(1)} g</div>
                </div>
                <div className="rounded bg-[#0f172a] p-2">
                  <div className="text-xs text-slate-500">Propellant</div>
                  <div className="font-semibold text-slate-100">{((selectedMotor.propellantMass || 0) * 1000).toFixed(1)} g</div>
                </div>
                <div className="rounded bg-[#0f172a] p-2">
                  <div className="text-xs text-slate-500">Burn Time</div>
                  <div className="font-semibold text-slate-100">{(selectedMotor.burnTime || 0).toFixed(2)} s</div>
                </div>
              </div>
            </div>

            {/* Delay Time Configuration */}
            <div>
              <h4 className="mb-2 font-semibold text-slate-200">Delay Time (Ejection Charge)</h4>
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3">
                <div className="mb-2">
                  <label className="mb-1 block text-sm font-medium text-slate-300">
                    Delay Time (seconds)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="30"
                    value={delayTime}
                    onChange={(e) => setDelayTime(e.target.value)}
                    placeholder="e.g., 6 (extracted from name)"
                    className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Time from motor burn end to ejection charge ignition (seconds)
                  </p>
                </div>
                {delayTime && (
                  <div className="mt-2 rounded border border-cyan-500/20 bg-[#020817] p-2">
                    <div className="text-xs text-slate-500">Estimated Deployment Time:</div>
                    <div className="text-sm font-semibold text-cyan-300">
                      {((selectedMotor.burnTime || 0) + parseFloat(delayTime || '0')).toFixed(2)} s
                      <span className="ml-1 text-slate-500">
                        (Burn time {selectedMotor.burnTime.toFixed(2)}s + Delay {delayTime}s)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Performance Parameters */}
            <div>
              <h4 className="mb-2 font-semibold text-slate-200">Performance Parameters</h4>
              <div className="space-y-2">
                <div className="flex justify-between rounded border border-emerald-500/20 bg-emerald-500/10 p-2">
                  <span className="text-slate-300">Total Impulse</span>
                  <span className="font-bold text-emerald-300">
                    {(selectedMotor.totalImpulse || (selectedMotor.averageThrust || 0) * (selectedMotor.burnTime || 0)).toFixed(1)} Ns
                  </span>
                </div>
                <div className="flex justify-between rounded border border-indigo-500/20 bg-indigo-500/10 p-2">
                  <span className="text-slate-300">Average Thrust</span>
                  <span className="font-bold text-indigo-300">{(selectedMotor.averageThrust || 0).toFixed(1)} N</span>
                </div>
                <div className="flex justify-between rounded border border-amber-500/20 bg-amber-500/10 p-2">
                  <span className="text-slate-300">Max Thrust</span>
                  <span className="font-bold text-amber-300">{(selectedMotor.maxThrust || 0).toFixed(1)} N</span>
                </div>
              </div>
            </div>

            {/* Thrust Curve */}
            <div>
              <h4 className="mb-2 font-semibold text-slate-200">Thrust Curve</h4>
              <div className="rounded border border-slate-800 bg-[#0f172a] p-3">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={selectedMotor.thrustCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="time"
                      label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: '#94a3b8' }}
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                    />
                    <YAxis
                      label={{ value: 'Thrust (N)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                    />
                    <Tooltip />
                    <Line type="monotone" dataKey="thrust" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Apply Button */}
            <button
              onClick={handleApplyMotor}
              className="w-full rounded-lg bg-cyan-500 py-2.5 font-medium text-slate-950 transition-colors hover:bg-cyan-400"
            >
              <i className="fas fa-check mr-2"></i>
              Apply Motor
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MotorConfig;
