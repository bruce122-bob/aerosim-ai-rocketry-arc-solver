import React, { useMemo } from 'react';
import { RocketConfig } from '../types';
import { calculateDryMass, calculateReferenceArea } from '../services/rocketUtils';
import { calculateStability } from '../services/stability';

interface Props {
  rocket: RocketConfig;
}

const RocketDataPanel: React.FC<Props> = ({ rocket }) => {
  // Calculate all performance metrics
  const metrics = useMemo(() => {
    const dryMass = calculateDryMass(rocket.stages);
    const wetMass = dryMass + rocket.motor.propellantMass;
    const refArea = calculateReferenceArea(rocket.stages);
    const stability = calculateStability(rocket.stages, rocket.simulationSettings?.referenceLength);
    
    return {
      dryMass,
      wetMass,
      motorMass: rocket.motor.totalMass,
      refArea,
      cp: stability.cp,
      cg: stability.cg,
      stabilityMargin: stability.stabilityMargin,
      isStable: stability.isStable
    };
  }, [rocket]);

  const DataRow = ({ label, value, unit, warning = false }: { label: string; value: number | string; unit?: string; warning?: boolean }) => (
    <div className={`flex justify-between items-center py-1.5 px-3 border-b border-gray-100 hover:bg-gray-50 ${warning ? 'bg-red-50' : ''}`}>
      <span className="text-xs text-gray-600 font-medium">{label}</span>
      <span className={`text-xs font-bold ${warning ? 'text-red-600' : 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toFixed(4) : value} {unit && <span className="text-gray-500 font-normal">{unit}</span>}
      </span>
    </div>
  );

  return (
    <div className="bg-white border border-ui-300 rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          <i className="fas fa-tachometer-alt mr-2"></i>
          Rocket Performance Data
        </h3>
        <button className="text-white hover:text-gray-200 text-xs">
          <i className="fas fa-sync-alt"></i>
        </button>
      </div>

      {/* Mass Properties */}
      <div className="border-b border-gray-200">
        <div className="bg-ui-50 px-3 py-1.5 border-b border-ui-200">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
            <i className="fas fa-weight-hanging mr-1 text-blue-500"></i> Mass
          </h4>
        </div>
        <DataRow label="Dry mass (without motor)" value={metrics.dryMass} unit="kg" />
        <DataRow label="Motor total mass" value={metrics.motorMass} unit="kg" />
        <DataRow label="Launch mass (with motor)" value={metrics.wetMass} unit="kg" />
      </div>

      {/* Stability Properties */}
      <div className="border-b border-gray-200">
        <div className="bg-ui-50 px-3 py-1.5 border-b border-ui-200">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
            <i className="fas fa-balance-scale mr-1 text-green-500"></i> Stability
          </h4>
        </div>
        <DataRow label="Center of Gravity (CG)" value={metrics.cg} unit="m" />
        <DataRow label="Center of Pressure (CP)" value={metrics.cp} unit="m" />
        <DataRow 
          label="Stability Margin" 
          value={metrics.stabilityMargin} 
          unit="calibers" 
          warning={!metrics.isStable}
        />
        <div className={`px-3 py-2 flex items-center space-x-2 ${metrics.isStable ? 'bg-green-50' : 'bg-red-50'}`}>
          <i className={`fas ${metrics.isStable ? 'fa-check-circle text-green-600' : 'fa-exclamation-triangle text-red-600'}`}></i>
          <span className={`text-xs font-semibold ${metrics.isStable ? 'text-green-700' : 'text-red-700'}`}>
            {metrics.isStable ? 'Rocket is STABLE' : 'Rocket is UNSTABLE'}
          </span>
        </div>
      </div>

      {/* Aerodynamics */}
      <div className="border-b border-gray-200">
        <div className="bg-ui-50 px-3 py-1.5 border-b border-ui-200">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
            <i className="fas fa-wind mr-1 text-purple-500"></i> Aerodynamics
          </h4>
        </div>
        <DataRow label="Reference area (max)" value={metrics.refArea} unit="m²" />
        <DataRow label="Drag coefficient (Cd)" value={rocket.cdOverride} unit="" />
      </div>

      {/* Motor Info */}
      <div>
        <div className="bg-ui-50 px-3 py-1.5 border-b border-ui-200">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
            <i className="fas fa-rocket mr-1 text-orange-500"></i> Motor
          </h4>
        </div>
        <div className="px-3 py-2">
          <div className="text-xs">
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Designation:</span>
              <span className="font-bold text-gray-900">{rocket.motor.name}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Total impulse:</span>
              <span className="font-bold text-gray-900">{rocket.motor.totalImpulse.toFixed(1)} N⋅s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Burn time:</span>
              <span className="font-bold text-gray-900">{rocket.motor.burnTime.toFixed(2)} s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-ui-50 px-3 py-2 border-t border-ui-200 flex space-x-2">
        <button className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 font-medium">
          <i className="fas fa-chart-line mr-1"></i> View Details
        </button>
        <button className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 font-medium">
          <i className="fas fa-file-export mr-1"></i> Export
        </button>
      </div>
    </div>
  );
};

export default RocketDataPanel;

