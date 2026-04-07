import React, { useMemo, useState, useRef, useEffect } from 'react';
import { RocketConfig, RocketComponent } from '../types';
import { calculateCG, calculateCP } from '../services/stability';

interface Props {
  rocket: RocketConfig;
  showCgCp?: boolean;
  zoom?: number;
  viewType?: 'side' | 'back' | '3d';
}

const RocketSchematic: React.FC<Props> = ({ rocket, showCgCp = true, zoom: externalZoom = 100, viewType = 'side' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalZoom, setInternalZoom] = useState(100);
  const [panOffset, setPanOffset] = useState({ x: 50, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Sync external zoom with internal state
  useEffect(() => {
    setInternalZoom(externalZoom);
  }, [externalZoom]);

  const height = 300;
  const scale = (internalZoom / 100) * 2000; // Pixels per meter
  const centerY = height / 2;

  // Mouse handlers for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -10 : 10;
    setInternalZoom(prev => Math.max(20, Math.min(200, prev + delta)));
  };

  // Recursive SVG Renderer
  const renderComponent = (comp: RocketComponent, parentX: number, parentY: number, parentDia: number): JSX.Element[] => {
    const elements: JSX.Element[] = [];
    const currentX = parentX + (comp.position * scale);

    switch (comp.type) {
      case 'STAGE':
        break;
      case 'NOSECONE': {
        const L = comp.length * scale;
        const R = (comp.baseDiameter / 2) * scale;
        const pathD = `M ${currentX} ${centerY} Q ${currentX + L * 0.6} ${centerY - R} ${currentX + L} ${centerY - R} L ${currentX + L} ${centerY + R} Q ${currentX + L * 0.6} ${centerY + R} ${currentX} ${centerY} Z`;
        elements.push(<path key={comp.id} d={pathD} fill="none" stroke="#1e40af" strokeWidth="1.5" />);
        // Shoulder
        const S_L = L * 0.15;
        const S_R = R * 0.9;
        elements.push(<rect key={`${comp.id}-sh`} x={currentX + L} y={centerY - S_R} width={S_L} height={S_R * 2} fill="none" stroke="#64748b" strokeDasharray="3 2" />);
        break;
      }
      case 'BODYTUBE': {
        const L = comp.length * scale;
        const R = (comp.diameter / 2) * scale;
        const rInner = (comp.innerDiameter / 2) * scale;
        elements.push(<rect key={comp.id} x={currentX} y={centerY - R} width={L} height={R * 2} fill="none" stroke="#1e40af" strokeWidth="1.5" />);
        elements.push(<line key={`${comp.id}-top`} x1={currentX} y1={centerY - rInner} x2={currentX + L} y2={centerY - rInner} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />);
        elements.push(<line key={`${comp.id}-bot`} x1={currentX} y1={centerY + rInner} x2={currentX + L} y2={centerY + rInner} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />);
        break;
      }
      case 'TRANSITION': {
        const L = comp.length * scale;
        const R1 = (comp.foreDiameter / 2) * scale;
        const R2 = (comp.aftDiameter / 2) * scale;
        const pathD = `M ${currentX} ${centerY - R1} L ${currentX + L} ${centerY - R2} L ${currentX + L} ${centerY + R2} L ${currentX} ${centerY + R1} Z`;
        elements.push(<path key={comp.id} d={pathD} fill="none" stroke="#1e40af" strokeWidth="1.5" />);
        break;
      }
      case 'FINS': {
        const root = comp.rootChord * scale;
        const tip = comp.tipChord * scale;
        const span = comp.height * scale;
        const sweep = comp.sweep * scale;
        const tubeR = (parentDia / 2) * scale;
        
        const finYTop = centerY - tubeR;
        const finYBot = centerY + tubeR;

        const topFin = `M ${currentX} ${finYTop} L ${currentX + sweep} ${finYTop - span} L ${currentX + sweep + tip} ${finYTop - span} L ${currentX + root} ${finYTop} Z`;
        const botFin = `M ${currentX} ${finYBot} L ${currentX + sweep} ${finYBot + span} L ${currentX + sweep + tip} ${finYBot + span} L ${currentX + root} ${finYBot} Z`;

        elements.push(
          <g key={comp.id}>
            <path d={topFin} fill="none" stroke="#1e40af" strokeWidth="1.5" />
            <path d={botFin} fill="none" stroke="#1e40af" strokeWidth="1.5" />
            {comp.finCount > 2 && <line x1={currentX} y1={centerY} x2={currentX + root} y2={centerY} stroke="#1e40af" strokeWidth="1" />}
          </g>
        );
        break;
      }
      case 'INNER_TUBE': {
        const L = comp.length * scale;
        const R = (comp.outerDiameter / 2) * scale;
        elements.push(<rect key={comp.id} x={currentX} y={centerY - R} width={L} height={R * 2} fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="4 2" />);
        break;
      }
      case 'CENTERING_RING': {
        const thickness = comp.thickness * scale;
        const outerR = (comp.outerDiameter / 2) * scale;
        const innerR = (comp.innerDiameter / 2) * scale;
        elements.push(
          <g key={comp.id}>
            <rect x={currentX} y={centerY - outerR} width={Math.max(thickness, 2)} height={outerR - innerR} fill="#64748b" />
            <rect x={currentX} y={centerY + innerR} width={Math.max(thickness, 2)} height={outerR - innerR} fill="#64748b" />
          </g>
        );
        break;
      }
      case 'ENGINE_BLOCK': {
        const thickness = comp.thickness * scale;
        const outerR = (comp.outerDiameter / 2) * scale;
        const innerR = (comp.innerDiameter / 2) * scale;
        elements.push(
          <g key={comp.id}>
            <rect x={currentX} y={centerY - outerR} width={Math.max(thickness, 2)} height={outerR - innerR} fill="#dc2626" />
            <rect x={currentX} y={centerY + innerR} width={Math.max(thickness, 2)} height={outerR - innerR} fill="#dc2626" />
          </g>
        );
        break;
      }
      case 'PARACHUTE': {
        const L = comp.packedLength * scale;
        const D = comp.packedDiameter * scale;
        // Dashed circle/ellipse for parachute
        elements.push(
          <ellipse key={comp.id} cx={currentX + L/2} cy={centerY} rx={L/2} ry={D/2} fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="4 2" />
        );
        break;
      }
      case 'SHOCK_CORD': {
        elements.push(<path key={comp.id} d={`M ${currentX} ${centerY} Q ${currentX+8} ${centerY-4} ${currentX+16} ${centerY} T ${currentX+32} ${centerY}`} fill="none" stroke="#f59e0b" strokeWidth="1.5" />);
        break;
      }
      case 'LAUNCH_LUG': {
        const L = comp.length * scale;
        const D = comp.outerDiameter * scale;
        const parentR = (parentDia / 2) * scale;
        elements.push(<rect key={comp.id} x={currentX} y={centerY - parentR - D - 2} width={L} height={D} fill="#64748b" stroke="#475569" strokeWidth="0.5" />);
        break;
      }
    }

    if (comp.subComponents && comp.subComponents.length > 0) {
      let myDia = 0;
      if (comp.type === 'BODYTUBE') myDia = comp.diameter;
      if (comp.type === 'INNER_TUBE') myDia = comp.outerDiameter;

      comp.subComponents.forEach(sub => {
        elements.push(...renderComponent(sub, currentX, centerY, myDia));
      });
    }

    return elements;
  };

  // Render back view (cross-section from behind)
  const renderBackView = () => {
    const elements: JSX.Element[] = [];
    const centerX = 400;
    
    // Find max diameter and fin data from rocket
    let maxDiameter = 0;
    let fins: any = null;
    
    const findComponents = (comps: RocketComponent[]) => {
      comps.forEach(c => {
        if (c.type === 'BODYTUBE') {
          maxDiameter = Math.max(maxDiameter, c.diameter);
        }
        if (c.type === 'NOSECONE') {
          maxDiameter = Math.max(maxDiameter, c.baseDiameter);
        }
        if (c.type === 'FINS') {
          fins = c;
        }
        if (c.subComponents) findComponents(c.subComponents);
      });
    };
    findComponents(rocket.stages);
    
    const bodyRadius = (maxDiameter / 2) * scale * 0.8;
    
    // Body tube circle
    elements.push(
      <circle key="body" cx={centerX} cy={centerY} r={bodyRadius} fill="none" stroke="#1e40af" strokeWidth="2" />
    );
    
    // Inner tube circle (smaller)
    elements.push(
      <circle key="inner" cx={centerX} cy={centerY} r={bodyRadius * 0.4} fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="4 2" />
    );
    
    // Draw fins if present
    if (fins) {
      const finCount = fins.finCount || 3;
      const finHeight = fins.height * scale * 0.8;
      
      for (let i = 0; i < finCount; i++) {
        const angle = (i * 2 * Math.PI / finCount) - Math.PI / 2;
        const x1 = centerX + bodyRadius * Math.cos(angle);
        const y1 = centerY + bodyRadius * Math.sin(angle);
        const x2 = centerX + (bodyRadius + finHeight) * Math.cos(angle);
        const y2 = centerY + (bodyRadius + finHeight) * Math.sin(angle);
        
        elements.push(
          <line key={`fin-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1e40af" strokeWidth="3" />
        );
      }
    }
    
    return elements;
  };

  const { paths, cgPos, cpPos } = useMemo(() => {
    const calculatedCG = calculateCG(rocket.stages);
    const calculatedCP = calculateCP(rocket.stages);

    let elements: JSX.Element[];
    if (viewType === 'back') {
      elements = renderBackView();
    } else {
      elements = rocket.stages.flatMap(stage => renderComponent(stage, panOffset.x, centerY, 0));
    }
    
    return { 
      paths: elements, 
      cgPos: calculatedCG, 
      cpPos: calculatedCP
    };
  }, [rocket, panOffset.x, scale, viewType]);

  const cgX = panOffset.x + (cgPos * scale);
  const cpX = panOffset.x + (cpPos * scale);

  // Generate ruler marks
  const rulerMarks = [];
  const startInch = Math.floor(-panOffset.x / (scale * 0.0254));
  const endInch = Math.ceil((800 - panOffset.x) / (scale * 0.0254));
  for (let i = startInch; i <= endInch; i++) {
    const x = panOffset.x + (i * 0.0254 * scale);
    if (x >= 0 && x <= 1200) {
      rulerMarks.push({ x, label: i });
    }
  }

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative bg-white overflow-hidden select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {/* Top Ruler (inches) */}
      <div className="absolute top-0 left-0 right-0 h-5 bg-gray-50 border-b border-gray-300 overflow-hidden">
        <svg width="100%" height="100%">
          {rulerMarks.map(({ x, label }) => (
            <g key={label}>
              <line x1={x} y1={15} x2={x} y2={20} stroke="#666" strokeWidth="1" />
              <text x={x} y={12} fontSize="9" textAnchor="middle" fill="#666">{label}</text>
            </g>
          ))}
        </svg>
      </div>

      {/* Left Ruler (vertical scale) */}
      <div className="absolute top-5 left-0 w-8 bottom-0 bg-gray-50 border-r border-gray-300 flex flex-col items-center justify-center">
        <svg width="100%" height="100%">
          {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map(i => {
            const y = (height / 2) + 20 - (i * 20);
            return (
              <g key={i}>
                <line x1={24} y1={y} x2={32} y2={y} stroke="#666" strokeWidth="1" />
                <text x={20} y={y + 3} fontSize="8" textAnchor="end" fill="#666">{i}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Schematic Area */}
      <div className="absolute top-5 left-8 right-0 bottom-0">
        <svg width="100%" height="100%" className="overflow-visible">
          {/* Grid */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          {/* Center line */}
          <line x1="0" y1={centerY} x2="100%" y2={centerY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />

          {paths}

          {/* CG Marker - only show in side view */}
          {showCgCp && viewType === 'side' && (
            <g transform={`translate(${cgX}, ${centerY})`}>
              <circle r="8" fill="white" stroke="#2563eb" strokeWidth="2" />
              <line x1="-6" y1="0" x2="6" y2="0" stroke="#2563eb" strokeWidth="2" />
              <line x1="0" y1="-6" x2="0" y2="6" stroke="#2563eb" strokeWidth="2" />
            </g>
          )}

          {/* CP Marker - only show in side view */}
          {showCgCp && viewType === 'side' && (
            <g transform={`translate(${cpX}, ${centerY})`}>
              <circle r="8" fill="none" stroke="#dc2626" strokeWidth="2" strokeDasharray="3 2" />
              <circle r="3" fill="#dc2626" />
            </g>
          )}
          
          {/* Back view center marker */}
          {viewType === 'back' && showCgCp && (
            <g transform="translate(400, 150)">
              <circle r="4" fill="#2563eb" />
              <text x="15" y="5" fontSize="10" fill="#2563eb">CG</text>
            </g>
          )}
          
          {/* 3D View placeholder */}
          {viewType === '3d' && (
            <g>
              <text x="400" y="150" textAnchor="middle" fontSize="14" fill="#666">
                3D View - Coming Soon
              </text>
              <text x="400" y="170" textAnchor="middle" fontSize="11" fill="#999">
                Use Flight Simulation tab for 3D visualization
              </text>
            </g>
          )}
        </svg>
      </div>

    </div>
  );
};

export default RocketSchematic;
