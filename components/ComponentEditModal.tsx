import React, { useState, useEffect } from 'react';
import { RocketComponent, ComponentType } from '../types';
import { MATERIAL_DATABASE, filterMaterialsByCategory, MATERIAL_CATEGORIES } from '../data/materialDatabase';

interface Props {
  component: RocketComponent;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedComp: RocketComponent) => void;
}

type TabType = 'general' | 'figure' | 'appearance' | 'overrides';

const ComponentEditModal: React.FC<Props> = ({ component, isOpen, onClose, onSave }) => {
  const [data, setData] = useState<any>({ ...component });
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [massOverride, setMassOverride] = useState(false);
  const [cgOverride, setCgOverride] = useState(false);

  useEffect(() => {
    setData({ ...component });
    setActiveTab('general');
  }, [component]);

  if (!isOpen) return null;

  const handleChange = (field: string, value: any) => {
    setData((prev: any) => ({ ...prev, [field]: value }));
  };

  // Tab rendering
  const renderGeneralTab = () => {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Component name</label>
            <input 
              type="text" 
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
              value={data.name} 
              onChange={(e) => handleChange('name', e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Material</label>
            <select 
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
              value={data.material || 'Cardboard'} 
              onChange={(e) => handleChange('material', e.target.value)}
            >
              <optgroup label="Common Materials">
                <option value="Cardboard">Cardboard</option>
                <option value="Plastic (polystyrene)">Plastic (polystyrene)</option>
                <option value="Plywood">Plywood</option>
                <option value="Balsa">Balsa</option>
              </optgroup>
              <optgroup label="Wood">
                <option value="Balsa">Balsa</option>
                <option value="Basswood">Basswood</option>
                <option value="Birch">Birch</option>
                <option value="Plywood">Plywood</option>
              </optgroup>
              <optgroup label="Plastics">
                <option value="Plastic (polystyrene)">Plastic (polystyrene)</option>
                <option value="Plastic (polycarbonate)">Plastic (polycarbonate)</option>
                <option value="Plastic (PVC)">Plastic (PVC)</option>
                <option value="ABS Plastic">ABS Plastic</option>
                <option value="PLA Plastic">PLA Plastic</option>
                <option value="PETG Plastic">PETG Plastic</option>
                <option value="Acrylic">Acrylic</option>
              </optgroup>
              <optgroup label="Composites">
                <option value="Fiberglass">Fiberglass</option>
                <option value="Carbon fiber">Carbon fiber</option>
                <option value="G10 Fiberglass">G10 Fiberglass</option>
                <option value="Phenolic">Phenolic</option>
                <option value="Blue tube">Blue tube</option>
                <option value="Quantum tubing">Quantum tubing</option>
              </optgroup>
              <optgroup label="Metals">
                <option value="Aluminum">Aluminum</option>
                <option value="Brass">Brass</option>
                <option value="Steel">Steel</option>
                <option value="Titanium">Titanium</option>
              </optgroup>
              <optgroup label="Paper/Cardboard">
                <option value="Cardboard">Cardboard</option>
                <option value="Cardboard (heavy)">Cardboard (heavy)</option>
              </optgroup>
              <optgroup label="Foam">
                <option value="Styrofoam">Styrofoam</option>
                <option value="Depron foam">Depron foam</option>
                <option value="Foam (PU)">Foam (PU)</option>
              </optgroup>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {MATERIAL_DATABASE.find(m => m.name === (data.material || 'Cardboard'))?.description || ''}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Component position</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Position from parent (m)</label>
              <input 
                type="number" 
                step="0.001" 
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                value={data.position || 0} 
                onChange={(e) => handleChange('position', parseFloat(e.target.value) || 0)} 
              />
            </div>
            <div className="flex items-end">
              <button className="px-3 py-2 text-xs border border-gray-300 rounded hover:bg-gray-50">
                <i className="fas fa-crosshairs mr-1"></i> Auto-position
              </button>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-3">
          <i className="fas fa-info-circle mr-2 text-blue-600"></i>
          Component mass: <strong>{(data.mass || 0).toFixed(4)} kg</strong>
        </div>
      </div>
    );
  };

  const renderFigureTab = () => {
    switch (data.type) {
      case 'NOSECONE':
        return (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Nose cone shape</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Shape type</label>
                <select 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.shape} 
                  onChange={(e) => handleChange('shape', e.target.value)}
                >
                  <option value="OGIVE">Ogive</option>
                  <option value="CONICAL">Conical</option>
                  <option value="ELLIPSOID">Ellipsoid</option>
                  <option value="POWER_SERIES">Power series</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Shape parameter</label>
                <input 
                  type="number" 
                  step="0.1" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.parameter || 1} 
                  onChange={(e) => handleChange('parameter', parseFloat(e.target.value) || 1)} 
                />
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-6">Dimensions</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Length (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.length} 
                  onChange={(e) => handleChange('length', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Base diameter (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.baseDiameter} 
                  onChange={(e) => handleChange('baseDiameter', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Wall thickness (m)</label>
                <input 
                  type="number" 
                  step="0.0001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.wallThickness} 
                  onChange={(e) => handleChange('wallThickness', parseFloat(e.target.value))} 
                />
              </div>
            </div>
          </div>
        );

      case 'BODYTUBE':
        return (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Dimensions</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Length (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.length} 
                  onChange={(e) => handleChange('length', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Outer diameter (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.diameter} 
                  onChange={(e) => handleChange('diameter', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Inner diameter (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.innerDiameter} 
                  onChange={(e) => handleChange('innerDiameter', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Wall thickness (m)</label>
                <input 
                  type="number" 
                  step="0.0001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.wallThickness} 
                  onChange={(e) => handleChange('wallThickness', parseFloat(e.target.value))} 
                />
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-6">Motor mount</h4>
            <div className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                id="motorMount"
                className="rounded" 
                checked={data.isMotorMount || false} 
                onChange={(e) => handleChange('isMotorMount', e.target.checked)} 
              />
              <label htmlFor="motorMount" className="text-sm text-gray-700">This body tube is a motor mount</label>
            </div>
          </div>
        );

      case 'FINS':
        return (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Fin set configuration</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Number of fins</label>
                <input 
                  type="number" 
                  step="1" 
                  min="1"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.finCount} 
                  onChange={(e) => handleChange('finCount', parseInt(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Rotation (degrees)</label>
                <input 
                  type="number" 
                  step="1" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.rotation || 0} 
                  onChange={(e) => handleChange('rotation', parseFloat(e.target.value) || 0)} 
                />
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-6">Fin shape</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Root chord (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.rootChord} 
                  onChange={(e) => handleChange('rootChord', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tip chord (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.tipChord} 
                  onChange={(e) => handleChange('tipChord', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Height (span) (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.height} 
                  onChange={(e) => handleChange('height', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Sweep length (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.sweep} 
                  onChange={(e) => handleChange('sweep', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Thickness (m)</label>
                <input 
                  type="number" 
                  step="0.0001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.thickness} 
                  onChange={(e) => handleChange('thickness', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Cross section</label>
                <select 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.crossSection} 
                  onChange={(e) => handleChange('crossSection', e.target.value)}
                >
                  <option value="SQUARE">Square</option>
                  <option value="ROUNDED">Rounded</option>
                  <option value="AIRFOIL">Airfoil</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 'TRANSITION':
        return (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Dimensions</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Length (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.length} 
                  onChange={(e) => handleChange('length', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Shape</label>
                <select 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.shape} 
                  onChange={(e) => handleChange('shape', e.target.value)}
                >
                  <option value="CONICAL">Conical</option>
                  <option value="OGIVE">Ogive</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Fore diameter (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.foreDiameter} 
                  onChange={(e) => handleChange('foreDiameter', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Aft diameter (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.aftDiameter} 
                  onChange={(e) => handleChange('aftDiameter', parseFloat(e.target.value))} 
                />
              </div>
            </div>
          </div>
        );

      case 'PARACHUTE':
        return (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Parachute properties</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Canopy diameter (m)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.diameter} 
                  onChange={(e) => handleChange('diameter', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Drag coefficient</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.cd} 
                  onChange={(e) => handleChange('cd', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Line length (m)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.lineLength} 
                  onChange={(e) => handleChange('lineLength', parseFloat(e.target.value))} 
                />
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-6">Packed size</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Packed length (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.packedLength} 
                  onChange={(e) => handleChange('packedLength', parseFloat(e.target.value))} 
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Packed diameter (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.packedDiameter} 
                  onChange={(e) => handleChange('packedDiameter', parseFloat(e.target.value))} 
                />
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="text-sm text-gray-500 italic py-8 text-center">
            No specific figure properties for this component type.
          </div>
        );
    }
  };

  const renderAppearanceTab = () => {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Component appearance</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Color</label>
            <div className="flex space-x-2">
              <input 
                type="color" 
                className="h-10 w-16 rounded border border-gray-300 cursor-pointer" 
                value={data.color || '#e2e8f0'} 
                onChange={(e) => handleChange('color', e.target.value)} 
              />
              <input 
                type="text" 
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                value={data.color || '#e2e8f0'} 
                onChange={(e) => handleChange('color', e.target.value)} 
                placeholder="#RRGGBB"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Finish</label>
            <select 
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
              value={data.finish || 'Normal'} 
              onChange={(e) => handleChange('finish', e.target.value)}
            >
              <option value="Rough">Rough</option>
              <option value="Normal">Normal</option>
              <option value="Smooth">Smooth</option>
              <option value="Polished">Polished</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-3 mt-4">
          <i className="fas fa-paint-brush mr-2 text-yellow-600"></i>
          Surface finish affects drag coefficient calculations.
        </div>

        <div className="mt-6">
          <h5 className="text-xs font-semibold text-gray-600 mb-2">Preview</h5>
          <div className="border border-gray-300 rounded p-4 bg-gray-50 flex items-center justify-center" style={{ height: '120px' }}>
            <div 
              className="rounded shadow-md" 
              style={{ 
                width: '100px', 
                height: '40px', 
                backgroundColor: data.color || '#e2e8f0' 
              }}
            ></div>
          </div>
        </div>
      </div>
    );
  };

  const renderOverridesTab = () => {
    return (
      <div className="space-y-4">
        <div className="text-xs text-gray-500 bg-orange-50 border border-orange-200 rounded p-3">
          <i className="fas fa-exclamation-triangle mr-2 text-orange-600"></i>
          <strong>Warning:</strong> Overriding automatic calculations may lead to inaccurate simulations.
        </div>

        <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-4">Mass override</h4>
        <div className="flex items-start space-x-3">
          <input 
            type="checkbox" 
            id="massOverride"
            className="mt-1 rounded" 
            checked={massOverride} 
            onChange={(e) => setMassOverride(e.target.checked)} 
          />
          <div className="flex-1">
            <label htmlFor="massOverride" className="block text-sm text-gray-700 mb-2">Override component mass</label>
            {massOverride && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Custom mass (kg)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.mass} 
                  onChange={(e) => handleChange('mass', parseFloat(e.target.value))} 
                />
              </div>
            )}
          </div>
        </div>

        <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-6">Center of gravity override</h4>
        <div className="flex items-start space-x-3">
          <input 
            type="checkbox" 
            id="cgOverride"
            className="mt-1 rounded" 
            checked={cgOverride} 
            onChange={(e) => setCgOverride(e.target.checked)} 
          />
          <div className="flex-1">
            <label htmlFor="cgOverride" className="block text-sm text-gray-700 mb-2">Override CG position</label>
            {cgOverride && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">CG position from component top (m)</label>
                <input 
                  type="number" 
                  step="0.001" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.cgOverride || 0} 
                  onChange={(e) => handleChange('cgOverride', parseFloat(e.target.value))} 
                />
              </div>
            )}
          </div>
        </div>

        <h4 className="text-sm font-semibold text-gray-700 border-b pb-2 mt-6">Drag coefficient override</h4>
        <div className="flex items-start space-x-3">
          <input 
            type="checkbox" 
            id="cdOverride"
            className="mt-1 rounded" 
            checked={data.cdOverride !== undefined} 
            onChange={(e) => handleChange('cdOverride', e.target.checked ? 0.5 : undefined)} 
          />
          <div className="flex-1">
            <label htmlFor="cdOverride" className="block text-sm text-gray-700 mb-2">Override component drag coefficient</label>
            {data.cdOverride !== undefined && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Drag coefficient (Cd)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                  value={data.cdOverride} 
                  onChange={(e) => handleChange('cdOverride', parseFloat(e.target.value))} 
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-[650px] max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-3 flex justify-between items-center">
          <h3 className="font-bold text-white text-lg">
            <i className={`fas ${getComponentIcon(data.type)} mr-2`}></i>
            {data.name}
          </h3>
          <button onClick={onClose} className="text-white hover:text-gray-200 text-xl">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-ui-100 border-b border-ui-300 flex px-2 pt-2">
          <button 
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-t border-l border-r ${
              activeTab === 'general' 
                ? 'bg-white border-ui-300 text-blue-600 -mb-[1px]' 
                : 'bg-ui-200 border-transparent text-gray-600 hover:bg-ui-50'
            }`}
          >
            <i className="fas fa-cog mr-1"></i> General
          </button>
          <button 
            onClick={() => setActiveTab('figure')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-t border-l border-r ${
              activeTab === 'figure' 
                ? 'bg-white border-ui-300 text-blue-600 -mb-[1px]' 
                : 'bg-ui-200 border-transparent text-gray-600 hover:bg-ui-50'
            }`}
          >
            <i className="fas fa-ruler-combined mr-1"></i> Figure
          </button>
          <button 
            onClick={() => setActiveTab('appearance')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-t border-l border-r ${
              activeTab === 'appearance' 
                ? 'bg-white border-ui-300 text-blue-600 -mb-[1px]' 
                : 'bg-ui-200 border-transparent text-gray-600 hover:bg-ui-50'
            }`}
          >
            <i className="fas fa-palette mr-1"></i> Appearance
          </button>
          <button 
            onClick={() => setActiveTab('overrides')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-t border-l border-r ${
              activeTab === 'overrides' 
                ? 'bg-white border-ui-300 text-orange-600 -mb-[1px]' 
                : 'bg-ui-200 border-transparent text-gray-600 hover:bg-ui-50'
            }`}
          >
            <i className="fas fa-exclamation-triangle mr-1"></i> Overrides
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {activeTab === 'general' && renderGeneralTab()}
          {activeTab === 'figure' && renderFigureTab()}
          {activeTab === 'appearance' && renderAppearanceTab()}
          {activeTab === 'overrides' && renderOverridesTab()}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-5 py-3 border-t border-ui-300 flex justify-between items-center">
          <div className="text-xs text-gray-500">
            <i className="fas fa-info-circle mr-1"></i>
            Type: <strong>{data.type}</strong>
          </div>
          <div className="flex space-x-2">
            <button 
              onClick={onClose} 
              className="px-4 py-2 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium"
            >
              Cancel
            </button>
            <button 
              onClick={() => onSave(data)} 
              className="px-5 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md"
            >
              <i className="fas fa-check mr-1"></i> Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function for component icons
const getComponentIcon = (type: ComponentType): string => {
  const icons: Record<ComponentType, string> = {
    STAGE: 'fa-space-shuttle',
    NOSECONE: 'fa-caret-up',
    BODYTUBE: 'fa-grip-lines-vertical',
    TRANSITION: 'fa-filter',
    FINS: 'fa-vector-square',
    INNER_TUBE: 'fa-minus',
    CENTERING_RING: 'fa-dot-circle',
    PARACHUTE: 'fa-parachute-box',
    SHOCK_CORD: 'fa-wave-square',
    ENGINE_BLOCK: 'fa-stop',
    LAUNCH_LUG: 'fa-map-pin',
    MASS_COMPONENT: 'fa-weight-hanging'
  };
  return icons[type] || 'fa-cube';
};

export default ComponentEditModal;
