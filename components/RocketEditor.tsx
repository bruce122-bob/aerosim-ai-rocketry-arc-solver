import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { RocketConfig, RocketComponent, ComponentType, Stage } from '../types';
import RocketSchematic from './RocketSchematic';
import ComponentEditModal from './ComponentEditModal';
import { analyzeDesign } from '../services/designWarnings';
import { calculateStability } from '../services/stability';
import { calculateDryMass } from '../services/rocketUtils';

interface EditorProps {
  rocket: RocketConfig;
  setRocket: React.Dispatch<React.SetStateAction<RocketConfig>>;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  componentId: string | null;
}

type ViewType = 'side' | 'back' | '3d';

const RocketEditor: React.FC<EditorProps> = ({ rocket, setRocket }) => {
  const [selectedId, setSelectedId] = useState<string | null>(rocket.stages[0]?.id || null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, componentId: null });
  const [showCgCp, setShowCgCp] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(rocket.stages.map(s => s.id)));
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  // View and zoom states
  const [viewType, setViewType] = useState<ViewType>('side');
  const [zoom, setZoom] = useState(100);
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  
  const designWarnings = useMemo(() => analyzeDesign(rocket.stages), [rocket]);
  const stability = useMemo(() => calculateStability(rocket.stages, rocket.simulationSettings?.referenceLength), [rocket]);
  const dryMass = useMemo(() => calculateDryMass(rocket.stages), [rocket]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu({ visible: false, x: 0, y: 0, componentId: null });
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedId || editModalOpen) return;
      
      if (e.key === 'Delete' && selectedId !== rocket.stages[0].id) {
        removeComponent(selectedId);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, rocket, editModalOpen]);

  // Helper functions
  const findComponent = (comps: RocketComponent[], id: string): RocketComponent | null => {
    for (const c of comps) {
      if (c.id === id) return c;
      const found = findComponent(c.subComponents, id);
      if (found) return found;
    }
    return null;
  };

  const findParent = (comps: RocketComponent[], childId: string): RocketComponent | null => {
    for (const c of comps) {
      if (c.subComponents.some(sub => sub.id === childId)) return c;
      const found = findParent(c.subComponents, childId);
      if (found) return found;
    }
    return null;
  };

  const getSelectedComponent = () => selectedId ? findComponent(rocket.stages, selectedId) : null;

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  // Component operations
  const addComponent = (type: ComponentType) => {
    if (!selectedId) return;
    const parent = getSelectedComponent();
    if (!parent) return;

    const id = Math.random().toString(36).substr(2, 9);
    let diameter = 0.066; // Default ~2.6 inches
    
    if (parent.type === 'BODYTUBE') diameter = parent.diameter;
    else if (parent.type === 'NOSECONE') diameter = parent.baseDiameter;

    let newComp: RocketComponent;
    const base = { id, mass: 0.02, color: '#cccccc', position: 0, subComponents: [] };

    switch(type) {
      case 'NOSECONE': 
        newComp = { ...base, type, name: 'Nose Cone', length: 0.15, baseDiameter: diameter, shape: 'OGIVE', parameter: 1, wallThickness: 0.002, material: 'Plastic' }; break;
      case 'BODYTUBE': 
        newComp = { ...base, type, name: 'Body Tube', length: 0.3, diameter: diameter, innerDiameter: diameter * 0.95, isMotorMount: false, wallThickness: 0.001, material: 'Cardboard' }; break;
      case 'TRANSITION': 
        newComp = { ...base, type, name: 'Transition', length: 0.05, foreDiameter: diameter, aftDiameter: diameter * 0.8, shape: 'CONICAL', material: 'Plastic' }; break;
      case 'FINS': 
        newComp = { ...base, type, name: 'Trapezoidal Fins', finCount: 3, rootChord: 0.08, tipChord: 0.04, height: 0.06, sweep: 0.02, thickness: 0.003, crossSection: 'ROUNDED', rotation: 0, material: 'Plywood' }; break;
      case 'INNER_TUBE':
        newComp = { ...base, type, name: 'Inner Tube', length: 0.1, outerDiameter: diameter * 0.5, innerDiameter: diameter * 0.48, material: 'Cardboard' }; break;
      case 'CENTERING_RING':
        newComp = { ...base, type, name: 'Centering Ring', outerDiameter: diameter * 0.95, innerDiameter: diameter * 0.5, thickness: 0.003, material: 'Plywood' }; break;
      case 'PARACHUTE':
        newComp = { ...base, type, name: 'Parachute', diameter: 0.3, cd: 0.8, packedLength: 0.03, packedDiameter: diameter * 0.4, lineLength: 0.4 }; break;
      case 'SHOCK_CORD':
        newComp = { ...base, type, name: 'Shock Cord', length: 0.6, material: 'Elastic' }; break;
      case 'ENGINE_BLOCK':
        newComp = { ...base, type, name: 'Engine Block', outerDiameter: diameter * 0.5, innerDiameter: diameter * 0.45, thickness: 0.005 }; break;
      case 'LAUNCH_LUG':
        newComp = { ...base, type, name: 'Launch Lug', length: 0.025, outerDiameter: 0.005, innerDiameter: 0.004 }; break;
      case 'MASS_COMPONENT':
        newComp = { ...base, type, name: 'Mass Component', length: 0.02, diameter: 0.02, mass: 0.05 }; break;
      default: return;
    }

    const injectChild = (comps: RocketComponent[]): RocketComponent[] => {
      return comps.map(c => {
        if (c.id === selectedId) {
          return { ...c, subComponents: [...c.subComponents, newComp] };
        }
        return { ...c, subComponents: injectChild(c.subComponents) };
      });
    };

    setRocket(prev => ({ ...prev, stages: injectChild(prev.stages) as Stage[] }));
    setSelectedId(id);
    setExpandedNodes(prev => new Set([...prev, selectedId]));
  };

  const removeComponent = (id: string) => {
    const filterRecursive = (comps: RocketComponent[]): RocketComponent[] => {
      return comps.filter(c => c.id !== id).map(c => ({
        ...c, subComponents: filterRecursive(c.subComponents)
      }));
    };
    setRocket(prev => ({ ...prev, stages: filterRecursive(prev.stages) as Stage[] }));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateComponent = (id: string) => {
    const comp = findComponent(rocket.stages, id);
    if (!comp) return;
    
    const cloneWithNewId = (c: RocketComponent): RocketComponent => ({
      ...c,
      id: Math.random().toString(36).substr(2, 9),
      name: c.name + ' (copy)',
      subComponents: c.subComponents.map(cloneWithNewId)
    });
    
    const cloned = cloneWithNewId(comp);
    
    const addSibling = (comps: RocketComponent[]): RocketComponent[] => {
      const newComps: RocketComponent[] = [];
      for (const c of comps) {
        newComps.push(c);
        if (c.id === id) newComps.push(cloned);
        else newComps[newComps.length - 1] = { ...c, subComponents: addSibling(c.subComponents) };
      }
      return newComps;
    };
    
    setRocket(prev => ({ ...prev, stages: addSibling(prev.stages) as Stage[] }));
    setSelectedId(cloned.id);
  };

  const moveComponent = (id: string, direction: 'up' | 'down') => {
    const parent = findParent(rocket.stages, id);
    if (!parent) return;

    const moveInParent = (comps: RocketComponent[]): RocketComponent[] => {
      return comps.map(c => {
        if (c.id === parent.id) {
          const idx = c.subComponents.findIndex(s => s.id === id);
          if (idx === -1) return c;
          const newIdx = direction === 'up' ? Math.max(0, idx - 1) : Math.min(c.subComponents.length - 1, idx + 1);
          if (newIdx === idx) return c;
          const newSubs = [...c.subComponents];
          [newSubs[idx], newSubs[newIdx]] = [newSubs[newIdx], newSubs[idx]];
          return { ...c, subComponents: newSubs };
        }
        return { ...c, subComponents: moveInParent(c.subComponents) };
      });
    };

    setRocket(prev => ({ ...prev, stages: moveInParent(prev.stages) as Stage[] }));
  };

  const updateComponent = (updated: RocketComponent) => {
    const updateRecursive = (comps: RocketComponent[]): RocketComponent[] => {
      return comps.map(c => c.id === updated.id ? updated : { ...c, subComponents: updateRecursive(c.subComponents) });
    };
    setRocket(prev => ({ ...prev, stages: updateRecursive(prev.stages) as Stage[] }));
    setEditModalOpen(false);
  };

  // Add a new stage
  const addStage = () => {
    const newStage: Stage = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'STAGE',
      name: `Stage ${rocket.stages.length + 1}`,
      mass: 0,
      color: '#ffffff',
      position: 0,
      subComponents: []
    };
    setRocket(prev => ({ ...prev, stages: [...prev.stages, newStage] }));
    setSelectedId(newStage.id);
    setExpandedNodes(prev => new Set([...prev, newStage.id]));
  };

  const handleContextMenu = (e: React.MouseEvent, compId: string) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, componentId: compId });
  };

  // Icon mapping (OpenRocket style)
  const getIcon = (type: ComponentType): string => {
    const icons: Record<ComponentType, string> = {
      STAGE: '🚀', NOSECONE: '▲', BODYTUBE: '▭', TRANSITION: '⏷',
      FINS: '◢', INNER_TUBE: '○', CENTERING_RING: '◎', PARACHUTE: '☂',
      SHOCK_CORD: '〰', ENGINE_BLOCK: '■', LAUNCH_LUG: '┃', MASS_COMPONENT: '●'
    };
    return icons[type] || '□';
  };

  // Get component mass (including sub-components)
  const getComponentMass = (comp: RocketComponent): number => {
    const subMass = comp.subComponents.reduce((sum, sub) => sum + getComponentMass(sub), 0);
    return comp.mass + subMass;
  };

  // Recursive tree renderer (OpenRocket style with icons)
  const renderTree = (components: RocketComponent[], level = 0) => {
    return components.map(comp => {
      const hasChildren = comp.subComponents.length > 0;
      const isExpanded = expandedNodes.has(comp.id);
      const isSelected = selectedId === comp.id;
      const compMass = getComponentMass(comp);

  return (
        <div key={comp.id}>
          <div 
            onClick={() => setSelectedId(comp.id)}
            onDoubleClick={() => { setSelectedId(comp.id); setEditModalOpen(true); }}
            onContextMenu={(e) => { setSelectedId(comp.id); handleContextMenu(e, comp.id); }}
            className={`flex items-center py-0.5 cursor-pointer text-sm select-none group ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
          >
            {/* Expand/Collapse Icon */}
            {hasChildren ? (
              <span onClick={(e) => { e.stopPropagation(); toggleExpand(comp.id); }} className="w-4 text-center cursor-pointer">
                {isExpanded ? '▼' : '▶'}
              </span>
            ) : (
              <span className="w-4"></span>
            )}
            
            {/* Component Icon */}
            <span className="mr-1.5">{getIcon(comp.type)}</span>
            
            {/* Component Name */}
            <span className="flex-1">{comp.name}</span>
            
            {/* Quick Action Icons (OpenRocket style) */}
            <div className={`flex items-center space-x-0.5 mr-1 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedId(comp.id); setEditModalOpen(true); }}
                className={`w-5 h-5 flex items-center justify-center rounded hover:bg-blue-500 ${isSelected ? 'text-white' : 'text-blue-600'}`}
                title="Edit component"
              >
                <i className="fas fa-edit text-xs"></i>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); duplicateComponent(comp.id); }}
                className={`w-5 h-5 flex items-center justify-center rounded hover:bg-blue-500 ${isSelected ? 'text-white' : 'text-blue-600'}`}
                title="Duplicate component"
              >
                <i className="fas fa-copy text-xs"></i>
              </button>
                            </div>
                            
            {/* Mass display */}
            {compMass > 0 && (
              <span className={`text-xs mr-2 ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                ({(compMass * 1000).toFixed(0)} g)
              </span>
            )}
                                        </div>
          {hasChildren && isExpanded && renderTree(comp.subComponents, level + 1)}
                                    </div>
      );
    });
  };

  const selectedComp = getSelectedComponent();
  const canAddBody = selectedComp?.type === 'STAGE';
  const canAddInternal = selectedComp?.type === 'BODYTUBE' || selectedComp?.type === 'INNER_TUBE';
  const canAddToNose = selectedComp?.type === 'NOSECONE';

  // Calculate total length for display
  const getTotalLength = (comps: RocketComponent[]): number => {
    let len = 0;
    for (const c of comps) {
      if ('length' in c) len += (c as any).length || 0;
      len += getTotalLength(c.subComponents);
    }
    return len;
  };
  const totalLength = getTotalLength(rocket.stages);
  const totalLengthIn = totalLength * 39.3701;

  // Get max diameter
  let maxDiameter = 0;
  const findMaxDia = (comps: RocketComponent[]) => {
    comps.forEach(c => {
      if (c.type === 'BODYTUBE') maxDiameter = Math.max(maxDiameter, (c as any).diameter);
      if (c.type === 'NOSECONE') maxDiameter = Math.max(maxDiameter, (c as any).baseDiameter);
      findMaxDia(c.subComponents);
    });
  };
  findMaxDia(rocket.stages);
  const maxDiameterIn = maxDiameter * 39.3701;

  return (
    <div className="flex flex-col h-full bg-white text-sm">
      {/* Main Area: Tree + Actions + Add Components */}
      <div className="flex flex-1 overflow-hidden border-b border-gray-300">
        
        {/* Left: Component Tree */}
        <div className="w-64 border-r border-gray-300 flex flex-col bg-white overflow-hidden">
          {/* Tree Header (OpenRocket style) */}
          <div className="border-b border-gray-300 bg-gray-50 px-2 py-1.5">
            <div className="text-sm font-semibold text-gray-800">
              Rocket ({(dryMass * 1000).toFixed(0)} g total)
                            </div>
                        </div>
          
          {/* Component Tree */}
          <div className="flex-1 overflow-y-auto py-1">
            {renderTree(rocket.stages)}
                    </div>
                </div>

        {/* Middle: Action Buttons (OpenRocket style) */}
        <div className="w-36 border-r border-gray-300 flex flex-col bg-gray-50">
          {/* Header */}
          <div className="border-b border-gray-300 bg-gray-100 px-2 py-1.5">
            <div className="text-xs font-semibold text-gray-700">Actions</div>
            </div>
            
          {/* Buttons */}
          <div className="p-2 flex flex-col space-y-1.5">
            <button 
              onClick={() => selectedId && moveComponent(selectedId, 'up')} 
              disabled={!selectedId} 
              className="px-2 py-1.5 text-xs border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-300 text-left flex items-center space-x-2 transition-colors"
            >
              <i className="fas fa-arrow-up w-3"></i>
              <span>Move up</span>
            </button>
                
            <button 
              onClick={() => selectedId && moveComponent(selectedId, 'down')} 
              disabled={!selectedId} 
              className="px-2 py-1.5 text-xs border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-300 text-left flex items-center space-x-2 transition-colors"
            >
              <i className="fas fa-arrow-down w-3"></i>
              <span>Move down</span>
            </button>
                
            <div className="border-t border-gray-300 my-1"></div>
                
            <button 
              onClick={() => { if (selectedId) setEditModalOpen(true); }} 
              disabled={!selectedId} 
              className="px-2 py-1.5 text-xs border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-300 text-left flex items-center space-x-2 transition-colors"
            >
              <i className="fas fa-edit w-3"></i>
              <span>Edit</span>
            </button>
            
            <button 
              onClick={() => selectedId && duplicateComponent(selectedId)} 
              disabled={!selectedId} 
              className="px-2 py-1.5 text-xs border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-300 text-left flex items-center space-x-2 transition-colors"
            >
              <i className="fas fa-copy w-3"></i>
              <span>Duplicate</span>
            </button>
            
            <div className="border-t border-gray-300 my-1"></div>
            
            <button 
              onClick={() => selectedId && selectedId !== rocket.stages[0].id && removeComponent(selectedId)} 
              disabled={!selectedId || selectedId === rocket.stages[0].id} 
              className="px-2 py-1.5 text-xs border border-gray-300 rounded bg-white hover:bg-red-50 hover:border-red-400 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-300 text-left flex items-center space-x-2 text-red-600 transition-colors"
            >
              <i className="fas fa-trash w-3"></i>
              <span>Delete</span>
            </button>
            
            <div className="border-t border-gray-300 my-1"></div>
            
            {/* Component Info */}
            {selectedComp && (
              <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                <div className="font-semibold text-blue-900 mb-1">Selected:</div>
                <div className="text-gray-700">{selectedComp.name}</div>
                <div className="text-gray-600 mt-1">Type: {selectedComp.type}</div>
                {selectedComp.mass > 0 && (
                  <div className="text-gray-600">Mass: {(selectedComp.mass * 1000).toFixed(0)} g</div>
                )}
              </div>
            )}
            </div>
        </div>

        {/* Right: Add Component Panel */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {/* Header */}
          <div className="border-b border-gray-300 bg-gray-100 px-4 py-2 sticky top-0 z-10">
            <h3 className="font-semibold text-gray-800">Add new component</h3>
            {selectedComp && (
              <p className="text-xs text-gray-600 mt-0.5">
                Add to: <span className="font-medium">{selectedComp.name}</span>
              </p>
            )}
          </div>
          
          <div className="p-4">
            
          {/* Assembly Components */}
            <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Assembly Components</h4>
                <div className="flex space-x-2">
              <button 
                onClick={addStage}
                className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 w-20 transition-colors"
                title="Add a new stage"
              >
                <span className="text-2xl mb-1">🚀</span>
                <span className="text-xs">Stage</span>
                    </button>
              <button 
                onClick={addStage}
                className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 w-20 transition-colors"
                title="Add a booster stage"
              >
                <span className="text-2xl mb-1">🔥</span>
                <span className="text-xs">Boosters</span>
                    </button>
              <button disabled className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white opacity-50 cursor-not-allowed w-20">
                <span className="text-2xl mb-1">📦</span>
                <span className="text-xs">Pods</span>
                    </button>
                </div>
            </div>

          {/* Body Components and Fin Sets */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Body Components and Fin Sets</h4>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => addComponent('NOSECONE')} disabled={!canAddBody} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">▲</span>
                <span className="text-xs">Nose Cone</span>
              </button>
              <button onClick={() => addComponent('BODYTUBE')} disabled={!canAddBody} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">▭</span>
                <span className="text-xs">Body Tube</span>
              </button>
              <button onClick={() => addComponent('TRANSITION')} disabled={!canAddBody} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">⏷</span>
                <span className="text-xs">Transition</span>
              </button>
              <button onClick={() => addComponent('FINS')} disabled={!canAddInternal} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">◢</span>
                <span className="text-xs">Trapezoidal</span>
              </button>
            </div>
          </div>

          {/* Internal Components */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Internal Components</h4>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => addComponent('INNER_TUBE')} disabled={!canAddInternal} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">○</span>
                <span className="text-xs">Inner Tube</span>
                    </button>
              <button onClick={() => addComponent('CENTERING_RING')} disabled={!canAddInternal} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">◎</span>
                <span className="text-xs">Centering Ring</span>
                    </button>
              <button onClick={() => addComponent('ENGINE_BLOCK')} disabled={!canAddInternal} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">■</span>
                <span className="text-xs">Engine Block</span>
                    </button>
              <button onClick={() => addComponent('LAUNCH_LUG')} disabled={!canAddInternal} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">┃</span>
                <span className="text-xs">Launch Lug</span>
                    </button>
            </div>
          </div>

          {/* Recovery */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Recovery</h4>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => addComponent('PARACHUTE')} disabled={!canAddInternal && !canAddToNose} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">☂</span>
                <span className="text-xs">Parachute</span>
                    </button>
              <button onClick={() => addComponent('SHOCK_CORD')} disabled={!canAddInternal && !canAddToNose} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20">
                <span className="text-2xl mb-1">〰</span>
                <span className="text-xs">Shock Cord</span>
              </button>
            </div>
          </div>

          {/* Mass Objects */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-600 mb-2">Mass Objects</h4>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => addComponent('MASS_COMPONENT')} disabled={!canAddInternal && !canAddToNose && !canAddBody} className="flex flex-col items-center p-3 border border-gray-300 rounded bg-white hover:bg-blue-50 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed w-20 transition-colors">
                <span className="text-2xl mb-1">●</span>
                <span className="text-xs">Mass</span>
                    </button>
            </div>
          </div>
          
          {/* Component Tips (OpenRocket style) */}
          <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded">
            <h4 className="text-xs font-semibold text-blue-900 mb-2">💡 Component Tips</h4>
            <ul className="text-xs text-gray-700 space-y-1">
              <li>• <strong>Nose Cone</strong>: Must be first component</li>
              <li>• <strong>Body Tube</strong>: Main rocket body structure</li>
              <li>• <strong>Fins</strong>: Add to body tube for stability</li>
              <li>• <strong>Parachute</strong>: Required for safe recovery</li>
              <li>• <strong>Engine Block</strong>: Prevents motor ejection</li>
            </ul>
          </div>
          
          {/* Quick Stats */}
          <div className="mt-4 p-3 bg-gray-100 border border-gray-300 rounded">
            <h4 className="text-xs font-semibold text-gray-800 mb-2">📊 Rocket Stats</h4>
            <div className="text-xs text-gray-700 space-y-1">
              <div className="flex justify-between">
                <span>Total Components:</span>
                <span className="font-semibold">{(() => {
                  let count = 0;
                  const countComponents = (comps: RocketComponent[]) => {
                    comps.forEach(c => { count++; countComponents(c.subComponents); });
                  };
                  countComponents(rocket.stages);
                  return count;
                })()}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Mass:</span>
                <span className="font-semibold">{(dryMass * 1000).toFixed(0)} g</span>
              </div>
              <div className="flex justify-between">
                <span>Stability:</span>
                <span className={`font-semibold ${stability.isStable ? 'text-green-600' : 'text-red-600'}`}>
                  {stability.stabilityMargin.toFixed(2)} cal
                </span>
              </div>
              <div className="flex justify-between">
                <span>Length:</span>
                <span className="font-semibold">{totalLengthIn.toFixed(1)} in</span>
              </div>
              <div className="flex justify-between">
                <span>Max Diameter:</span>
                <span className="font-semibold">{maxDiameterIn.toFixed(1)} in</span>
                </div>
            </div>
          </div>
          
            </div>
        </div>
      </div>

      {/* Bottom: Schematic Controls Bar - OpenRocket Style */}
      <div className="h-10 border-b border-gray-300 flex items-center px-3 space-x-6 bg-white text-xs">
        <div className="flex items-center space-x-2">
          <span className="text-gray-700 font-medium">View Type:</span>
          <div className="flex items-center border border-gray-300 rounded bg-white">
            <select 
              className="px-2 py-1 bg-transparent border-none outline-none text-sm cursor-pointer"
              value={viewType}
              onChange={(e) => setViewType(e.target.value as ViewType)}
            >
              <option value="side">Side view</option>
              <option value="back">Back view</option>
              <option value="3d">Figure 3D</option>
            </select>
            <button 
              className="px-1 py-1 border-l border-gray-300 hover:bg-gray-100"
              onClick={() => setViewType('side')}
              title="Reset view"
            >🔄</button>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-gray-700 font-medium">Zoom:</span>
          <button 
            className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-100"
            onClick={() => setZoom(100)}
            title="Fit to view"
          >🔍</button>
          <span className="text-gray-600 px-1 min-w-[60px] text-center">{zoom}%</span>
          <div className="flex border border-gray-300 rounded overflow-hidden">
            <button 
              className="px-2 py-1 bg-white hover:bg-gray-100"
              onClick={() => setZoom(z => Math.max(20, z - 10))}
              title="Zoom out"
            >−</button>
            <button 
              className="px-2 py-1 bg-white hover:bg-gray-100 border-l border-gray-300"
              onClick={() => setZoom(z => Math.min(200, z + 10))}
              title="Zoom in"
            >+</button>
              </div>
              </div>

        <div className="flex items-center space-x-2">
          <span className="text-gray-700 font-medium">Stability:</span>
          <label className="flex items-center space-x-1 cursor-pointer">
            <input 
              type="checkbox" 
              checked={showCgCp} 
              onChange={(e) => setShowCgCp(e.target.checked)} 
              className="rounded"
            />
                      <span>Show CG/CP</span>
                  </label>
              </div>

        <div className="flex items-center space-x-2">
          <span className="text-gray-700 font-medium">Stages:</span>
          {rocket.stages.map((stage, idx) => (
            <button 
              key={stage.id}
              className={`px-3 py-1 border rounded font-medium transition-colors ${
                selectedStageIndex === idx 
                  ? 'border-blue-500 bg-blue-100 text-blue-700' 
                  : 'border-gray-300 bg-gray-100 hover:bg-gray-200'
              }`}
              onClick={() => {
                setSelectedStageIndex(idx);
                setSelectedId(stage.id);
              }}
            >
              {stage.name || `Stage ${idx + 1}`}
            </button>
          ))}
        </div>

              <div className="flex-1"></div>

        <div className="flex items-center space-x-2">
          <span className="text-gray-700 font-medium">Motor:</span>
          <div className="flex items-center border border-gray-300 rounded bg-white">
            <span className="px-2 py-1 text-sm min-w-[100px]">[{rocket.motor.name || 'No motors'}]</span>
          </div>
        </div>
               </div>

      {/* Schematic View */}
      <div className="flex-1 relative bg-white overflow-hidden" style={{ minHeight: '200px' }}>
        {/* Rocket Info (left) */}
        <div className="absolute top-2 left-2 text-xs text-gray-700 space-y-0.5">
          <div className="font-semibold">Rocket</div>
          <div>Length {totalLengthIn.toFixed(3)} in, max. diameter {maxDiameterIn.toFixed(1)} in</div>
          <div>Mass with no motors {(dryMass * 1000).toFixed(0)} g</div>
        </div>

        {/* Stability Info (right) */}
        <div className="absolute top-2 right-2 text-xs text-gray-700 text-right space-y-0.5">
          <div>
            Stability: <strong className={stability.isStable ? 'text-green-700' : 'text-red-600'}>{stability.stabilityMargin.toFixed(2)} cal</strong> / {((stability.cp - stability.cg) * 39.3701 / maxDiameterIn * 100).toFixed(1)} %
          </div>
          <div className="text-blue-600">✚ CG: {(stability.cg * 39.3701).toFixed(3)} in</div>
          <div className="text-red-600">● CP: {(stability.cp * 39.3701).toFixed(3)} in</div>
          <div className="text-gray-500 text-[10px]">at M=0.300</div>
        </div>

        {/* Schematic */}
        <RocketSchematic rocket={rocket} showCgCp={showCgCp} zoom={zoom} viewType={viewType} />

        {/* Flight Info (bottom left) */}
        <div className="absolute bottom-2 left-2 text-xs text-gray-600 space-y-0.5">
          <div>Flight configuration: <strong>[{rocket.motor.name || 'No motors'}]</strong></div>
          <div>Apogee: <strong>N/A</strong></div>
          <div>Max. velocity: <strong>N/A</strong></div>
          <div>Max. acceleration: <strong>N/A</strong></div>
               </div>
          </div>
          
      {/* Bottom Status Bar (OpenRocket style) */}
      <div className="h-7 border-t border-gray-300 bg-gray-100 flex items-center justify-between px-3 text-xs text-gray-600">
        <div className="flex items-center space-x-4">
          <span className="flex items-center space-x-1">
            <i className="fas fa-mouse-pointer text-blue-600"></i>
            <span>Click: select</span>
          </span>
          <span className="text-gray-400">|</span>
          <span className="flex items-center space-x-1">
            <i className="fas fa-mouse text-blue-600"></i>
            <span>Double-click: edit</span>
          </span>
          <span className="text-gray-400">|</span>
          <span className="flex items-center space-x-1">
            <i className="fas fa-keyboard text-blue-600"></i>
            <span>Delete: remove</span>
          </span>
        </div>
        
        <div className="flex items-center space-x-4">
          {designWarnings.length > 0 && (
            <span className="flex items-center space-x-1 text-orange-600">
              <i className="fas fa-exclamation-triangle"></i>
              <span>{designWarnings.length} warning(s)</span>
            </span>
          )}
          
          <label className="flex items-center space-x-1.5 cursor-pointer hover:text-gray-800">
            <input 
              type="checkbox" 
              checked={showWarnings} 
              onChange={(e) => setShowWarnings(e.target.checked)}
              className="rounded"
            />
            <span>Show warnings</span>
              </label>
          
          <span className="text-gray-400">|</span>
          
          <span className="font-mono">
            {stability.isStable ? (
              <span className="text-green-600">✓ STABLE</span>
            ) : (
              <span className="text-red-600">⚠ UNSTABLE</span>
            )}
          </span>
          </div>
      </div>
          
      {/* Context Menu (OpenRocket style) */}
      {contextMenu.visible && (
        <div 
          ref={contextMenuRef}
          className="fixed bg-white border border-gray-400 shadow-xl z-50 py-1 rounded min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button 
            onClick={() => { if (contextMenu.componentId) moveComponent(contextMenu.componentId, 'up'); setContextMenu({ visible: false, x: 0, y: 0, componentId: null }); }} 
            className="w-full px-4 py-1.5 text-left text-sm hover:bg-blue-50 flex items-center space-x-3 transition-colors"
          >
            <i className="fas fa-arrow-up w-4 text-blue-600"></i>
            <span>Move up</span>
          </button>
          
          <button 
            onClick={() => { if (contextMenu.componentId) moveComponent(contextMenu.componentId, 'down'); setContextMenu({ visible: false, x: 0, y: 0, componentId: null }); }} 
            className="w-full px-4 py-1.5 text-left text-sm hover:bg-blue-50 flex items-center space-x-3 transition-colors"
          >
            <i className="fas fa-arrow-down w-4 text-blue-600"></i>
            <span>Move down</span>
          </button>
          
          <div className="border-t border-gray-200 my-1"></div>
          
          <button 
            onClick={() => { if (contextMenu.componentId) { setSelectedId(contextMenu.componentId); setEditModalOpen(true); } setContextMenu({ visible: false, x: 0, y: 0, componentId: null }); }} 
            className="w-full px-4 py-1.5 text-left text-sm hover:bg-blue-50 flex items-center space-x-3 transition-colors"
          >
            <i className="fas fa-edit w-4 text-blue-600"></i>
            <span>Edit...</span>
          </button>
          
          <button 
            onClick={() => { if (contextMenu.componentId) duplicateComponent(contextMenu.componentId); setContextMenu({ visible: false, x: 0, y: 0, componentId: null }); }} 
            className="w-full px-4 py-1.5 text-left text-sm hover:bg-blue-50 flex items-center space-x-3 transition-colors"
          >
            <i className="fas fa-copy w-4 text-blue-600"></i>
            <span>Duplicate</span>
          </button>
          
          <div className="border-t border-gray-200 my-1"></div>
          
          <button 
            onClick={() => { if (contextMenu.componentId && contextMenu.componentId !== rocket.stages[0].id) removeComponent(contextMenu.componentId); setContextMenu({ visible: false, x: 0, y: 0, componentId: null }); }} 
            disabled={contextMenu.componentId === rocket.stages[0].id} 
            className="w-full px-4 py-1.5 text-left text-sm hover:bg-red-50 text-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-3 transition-colors"
          >
            <i className="fas fa-trash w-4"></i>
            <span>Delete</span>
            <span className="text-xs text-gray-400 ml-auto">Del</span>
          </button>
        </div>
      )}

      {selectedComp && (
        <ComponentEditModal 
          isOpen={editModalOpen} 
          onClose={() => setEditModalOpen(false)} 
          component={selectedComp} 
          onSave={updateComponent}
        />
      )}
    </div>
  );
};

export default RocketEditor;
