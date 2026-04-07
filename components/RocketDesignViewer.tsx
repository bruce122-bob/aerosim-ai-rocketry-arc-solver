import React, { useDeferredValue, useMemo, useState } from 'react';
import { RocketComponent, RocketConfig } from '../types';
import { calculateCG, calculateCP, resolveStabilityReferenceLength } from '../services/stability';
import { calculateDryMass, findMaxDiameter } from '../services/rocketUtils';

interface Props {
  rocket: RocketConfig;
}

type ComponentLane = 'external' | 'internal' | 'recovery' | 'hardware';
type LaneVisibility = Record<ComponentLane, boolean>;

interface PositionedComponent {
  component: RocketComponent;
  absoluteTop: number;
  absoluteBottom: number;
  length: number;
  diameter: number;
  lane: ComponentLane;
}

const toInches = (meters: number) => meters * 39.3701;
const toGrams = (kg: number) => kg * 1000;

const getComponentLength = (component: RocketComponent): number => {
  switch (component.type) {
    case 'NOSECONE':
    case 'BODYTUBE':
    case 'TRANSITION':
    case 'INNER_TUBE':
    case 'SHOCK_CORD':
    case 'MASS_COMPONENT':
    case 'LAUNCH_LUG':
      return (component as any).length || 0;
    case 'FINS':
      return (component as any).rootChord || 0;
    case 'CENTERING_RING':
    case 'ENGINE_BLOCK':
      return (component as any).thickness || 0;
    case 'PARACHUTE':
      return (component as any).packedLength || 0.08;
    default:
      return 0;
  }
};

const getComponentDiameter = (component: RocketComponent, parentDiameter: number): number => {
  switch (component.type) {
    case 'NOSECONE':
      return component.baseDiameter || parentDiameter;
    case 'BODYTUBE':
      return component.diameter || parentDiameter;
    case 'TRANSITION':
      return Math.max(component.foreDiameter || 0, component.aftDiameter || 0, parentDiameter);
    case 'INNER_TUBE':
      return component.outerDiameter || parentDiameter;
    case 'CENTERING_RING':
      return component.outerDiameter || parentDiameter;
    case 'ENGINE_BLOCK':
      return component.outerDiameter || parentDiameter;
    case 'MASS_COMPONENT':
      return component.diameter || parentDiameter;
    case 'PARACHUTE':
      return component.packedDiameter || parentDiameter * 0.5;
    case 'LAUNCH_LUG':
      return component.outerDiameter || parentDiameter * 0.15;
    case 'FINS':
      return parentDiameter;
    default:
      return parentDiameter;
  }
};

const resolveChildOffset = (parent: RocketComponent, child: RocketComponent): number => {
  const raw = child.position || 0;
  const parentLen = getComponentLength(parent);
  const childLen = getComponentLength(child);

  if (child.relativeTo === 'absolute') return raw;
  if (child.relativeTo === 'bottom') return parentLen - childLen + raw;
  if (child.relativeTo === 'middle') return (parentLen - childLen) / 2 + raw;
  return raw;
};

const getLane = (component: RocketComponent, insideBody: boolean): ComponentLane => {
  if (
    component.type === 'TRANSITION' &&
    Math.abs(((component as any).aftDiameter || 0) - ((component as any).foreDiameter || 0)) < 0.002 &&
    getComponentLength(component) < 0.002
  ) {
    return 'hardware';
  }
  if (component.type === 'PARACHUTE' || component.type === 'SHOCK_CORD') return 'recovery';
  if (component.type === 'LAUNCH_LUG' || component.type === 'CENTERING_RING' || component.type === 'ENGINE_BLOCK') return 'hardware';
  if (component.type === 'INNER_TUBE' || component.type === 'MASS_COMPONENT') return 'internal';
  if (insideBody) return 'internal';
  return 'external';
};

const isExternalStructural = (entry: PositionedComponent): boolean => {
  if (entry.lane !== 'external') return false;
  if (entry.component.type === 'NOSECONE' || entry.component.type === 'BODYTUBE') return true;
  if (entry.component.type === 'TRANSITION') {
    const diaDelta = Math.abs(((entry.component as any).aftDiameter || 0) - ((entry.component as any).foreDiameter || 0));
    return entry.length >= 0.002 || diaDelta >= 0.002;
  }
  return false;
};

const getComponentTypeLabel = (component: RocketComponent): string => {
  switch (component.type) {
    case 'NOSECONE':
      return 'Nose';
    case 'BODYTUBE':
      return 'Body tube';
    case 'TRANSITION':
      return 'Transition';
    case 'FINS':
      return 'Fins';
    case 'INNER_TUBE':
      return 'Inner tube';
    case 'CENTERING_RING':
      return 'Centering ring';
    case 'PARACHUTE':
      return 'Parachute';
    case 'SHOCK_CORD':
      return 'Shock cord';
    case 'ENGINE_BLOCK':
      return 'Engine block';
    case 'MASS_COMPONENT':
      return 'Mass';
    case 'LAUNCH_LUG':
      return 'Launch lug';
    default:
      return component.type;
  }
};

const laneStyle: Record<ComponentLane, string> = {
  external: 'border border-cyan-500/20 bg-cyan-500/15 text-cyan-200',
  internal: 'border border-slate-700 bg-slate-800 text-slate-300',
  recovery: 'border border-rose-500/20 bg-rose-500/15 text-rose-200',
  hardware: 'border border-amber-500/20 bg-amber-500/15 text-amber-200',
};

const laneLabel: Record<ComponentLane, string> = {
  external: 'External',
  internal: 'Internal',
  recovery: 'Recovery',
  hardware: 'Hardware',
};

const RocketDesignViewer: React.FC<Props> = ({ rocket }) => {
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [search, setSearch] = useState('');
  const [laneVisibility, setLaneVisibility] = useState<LaneVisibility>({
    external: true,
    internal: true,
    recovery: true,
    hardware: true,
  });
  const deferredSearch = useDeferredValue(search);

  const designData = useMemo(() => {
    const positioned: PositionedComponent[] = [];

    const traverse = (
      component: RocketComponent,
      currentAbsPos: number,
      parentDiameter: number,
      insideBody: boolean
    ) => {
      if (component.type === 'STAGE') {
        let siblingEnd = 0;
        component.subComponents.forEach((child, index) => {
          let childOffset = child.position || 0;
          const structural = ['NOSECONE', 'BODYTUBE', 'TRANSITION', 'STAGE'].includes(child.type);

          if (structural) {
            if (index === 0) childOffset = 0;
            else if (child.relativeTo !== 'absolute' && childOffset > 0.01) childOffset = 0;
          }

          const absOffset = child.relativeTo === 'absolute' ? childOffset : siblingEnd + childOffset;
          traverse(child, currentAbsPos + absOffset, parentDiameter, insideBody);

          if (structural) {
            siblingEnd = absOffset + getComponentLength(child);
          }
        });
        return;
      }

      let length = getComponentLength(component);
      const diameter = getComponentDiameter(component, parentDiameter);
      const lane = getLane(component, insideBody);

      if (component.type === 'TRANSITION' && length < 0.001) {
        const diaDelta = Math.abs(((component as any).aftDiameter || 0) - ((component as any).foreDiameter || 0));
        length = diaDelta > 0.002 ? diaDelta / 0.364 : length;
      }

      const absoluteTop = currentAbsPos;
      const absoluteBottom = absoluteTop + length;

      if (length > 0) {
        positioned.push({
          component,
          absoluteTop,
          absoluteBottom,
          length,
          diameter,
          lane,
        });
      }

      const nextInsideBody = insideBody || component.type === 'BODYTUBE';
      component.subComponents.forEach((child) => {
        traverse(
          child,
          currentAbsPos + resolveChildOffset(component, child),
          diameter || parentDiameter,
          nextInsideBody
        );
      });
    };

    rocket.stages.forEach((stage) => traverse(stage, 0, 0, false));

    const externalStructure = positioned
      .filter((entry) => isExternalStructural(entry))
      .sort((a, b) => a.absoluteTop - b.absoluteTop);

    const totalLength = externalStructure.length
      ? Math.max(...externalStructure.map((entry) => entry.absoluteBottom))
      : 0.1;

    const maxDiameter = Math.max(findMaxDiameter(rocket.stages), 0.01);
    const bodyTail = externalStructure.length ? externalStructure[externalStructure.length - 1].absoluteBottom : totalLength;

    return {
      positioned,
      externalStructure,
      totalLength,
      maxDiameter,
      bodyTail,
    };
  }, [rocket]);

  const stability = useMemo(() => {
    const calculatedCG = calculateCG(rocket.stages);
    const calculatedCP = calculateCP(rocket.stages);
    const cg = rocket.manualOverride?.cg ?? rocket.simulationSettings?.cg ?? calculatedCG;
    const cp = rocket.manualOverride?.cp ?? rocket.simulationSettings?.cp ?? calculatedCP;
    const referenceLength = resolveStabilityReferenceLength(rocket.stages, rocket.simulationSettings?.referenceLength);
    const stabilityCal = referenceLength > 0 ? (cp - cg) / referenceLength : 0;
    const stabilityPercent = designData.totalLength > 0 ? ((cp - cg) / designData.totalLength) * 100 : 0;
    return { cg, cp, stabilityCal, stabilityPercent };
  }, [rocket, designData.totalLength]);

  const masses = useMemo(() => {
    const dryMass = rocket.manualOverride?.mass ?? calculateDryMass(rocket.stages);
    const withMotor = dryMass + (rocket.motor?.totalMass || 0);
    return { dryMass, withMotor };
  }, [rocket]);

  const motorPlacement = useMemo(() => {
    if (!rocket.motor) return null;

    const motorLength = rocket.motor.length || 0.1;
    const motorDiameter = rocket.motor.diameter || 0.029;

    const mountCandidates = designData.positioned.filter((entry) => {
      if (entry.absoluteBottom > designData.bodyTail + 1e-6) return false;
      // INNER_TUBE: accept if explicitly marked as motor mount (regardless of diameter),
      // or if diameter is compatible (motor tubes can be narrower than the motor due to centering rings)
      if (entry.component.type === 'INNER_TUBE') {
        return (entry.component as any).isMotorMount === true || entry.diameter >= motorDiameter * 0.9;
      }
      if (entry.component.type === 'BODYTUBE') return (entry.component as any).isMotorMount && entry.diameter >= motorDiameter * 0.9;
      return false;
    });

    const anchor = mountCandidates.sort((a, b) => b.absoluteBottom - a.absoluteBottom)[0];
    const bottom = anchor?.absoluteBottom ?? designData.bodyTail;
    const top = Math.max(0, bottom - motorLength);
    const diameter = anchor?.diameter ?? motorDiameter;

    return { top, bottom, diameter };
  }, [rocket.motor, designData]);

  const inventoryRows = useMemo(
    () =>
      [...designData.positioned]
        .sort((a, b) => a.absoluteTop - b.absoluteTop)
        .map((entry) => ({
          key: `${entry.component.id}-${entry.absoluteTop}`,
          componentId: entry.component.id,
          name: entry.component.name,
          type: getComponentTypeLabel(entry.component),
          start: toInches(entry.absoluteTop),
          end: toInches(entry.absoluteBottom),
          length: toInches(entry.length),
          mass: toGrams(entry.component.mass || 0),
          lane: entry.lane,
        })),
    [designData.positioned]
  );

  const filteredInventoryRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return inventoryRows.filter((row) => {
      if (!laneVisibility[row.lane]) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.type.toLowerCase().includes(q) ||
        row.lane.toLowerCase().includes(q)
      );
    });
  }, [inventoryRows, laneVisibility, deferredSearch]);

  const selectedPosition = useMemo(
    () => designData.positioned.find((entry) => entry.component.id === selectedComponentId) || null,
    [designData.positioned, selectedComponentId]
  );

  const diagnostics = useMemo(() => {
    const tinyComponents = designData.positioned.filter((entry) => entry.length < 0.0025);
    let gapCount = 0;
    let overlapCount = 0;
    const structural = [...designData.externalStructure].sort((a, b) => a.absoluteTop - b.absoluteTop);
    for (let i = 1; i < structural.length; i++) {
      const prev = structural[i - 1];
      const current = structural[i];
      const delta = current.absoluteTop - prev.absoluteBottom;
      if (delta > 0.002) gapCount++;
      if (delta < -0.002) overlapCount++;
    }
    const outsideBody = designData.positioned.filter(
      (entry) =>
        entry.lane !== 'recovery' &&
        entry.component.type !== 'FINS' &&
        entry.absoluteBottom > designData.bodyTail + 0.002
    ).length;
    return {
      tinyComponents,
      gapCount,
      overlapCount,
      outsideBody,
    };
  }, [designData]);

  const totalLengthIn = toInches(designData.totalLength);
  const maxDiameterIn = toInches(designData.maxDiameter);
  const cgIn = toInches(stability.cg);
  const cpIn = toInches(stability.cp);

  const schematicWidth = Math.max(960, totalLengthIn * 14 * zoom + 160);
  const scale = (schematicWidth - 140) / Math.max(totalLengthIn, 1);
  const headerHeight = 34;
  const centerY = 146;
  const bodyHalfHeight = Math.max(18, maxDiameterIn * scale * 0.45);
  const finHeight = Math.max(22, bodyHalfHeight * 0.9);
  const internalHeight = Math.max(14, bodyHalfHeight * 0.75);
  const schematicHeight = 320;
  const originX = 70;

  const xFor = (meters: number) => originX + toInches(meters) * scale;
  const widthFor = (meters: number) => Math.max(2, toInches(meters) * scale);

  const tickCount = Math.max(10, Math.ceil(totalLengthIn) + 2);
  const visiblePositioned = designData.positioned.filter((entry) => laneVisibility[entry.lane]);
  const isSelected = (componentId: string) => selectedComponentId === componentId;
  const toggleLane = (lane: ComponentLane) => {
    setLaneVisibility((current) => ({ ...current, [lane]: !current[lane] }));
  };
  const selectComponent = (componentId: string) => setSelectedComponentId(componentId);

  return (
    <div className="h-full overflow-auto bg-[#0a1020] text-slate-100">
      <div className="border-b border-slate-800 bg-[#0b1220] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-100">{rocket.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              ORK-driven design view with geometry, internals, propulsion placement, and parsed stability values.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] px-3 py-2">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Length</div>
              <div className="mt-1 font-semibold text-slate-100">{totalLengthIn.toFixed(2)} in</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] px-3 py-2">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Diameter</div>
              <div className="mt-1 font-semibold text-slate-100">{maxDiameterIn.toFixed(2)} in</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] px-3 py-2">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Dry Mass</div>
              <div className="mt-1 font-semibold text-slate-100">{toGrams(masses.dryMass).toFixed(1)} g</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] px-3 py-2">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Loaded Mass</div>
              <div className="mt-1 font-semibold text-slate-100">{toGrams(masses.withMotor).toFixed(1)} g</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
            <div className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300">Stability</div>
            <div className="mt-1 text-lg font-semibold text-cyan-200">{stability.stabilityCal.toFixed(2)} cal</div>
            <div className="text-sm text-cyan-300/80">{stability.stabilityPercent.toFixed(1)}% of body length</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0f172a] px-4 py-3">
            <div className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">CG / CP</div>
            <div className="mt-1 text-sm text-slate-100">CG {cgIn.toFixed(2)} in</div>
            <div className="text-sm text-slate-100">CP {cpIn.toFixed(2)} in</div>
          </div>
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3">
            <div className="font-mono text-xs uppercase tracking-[0.22em] text-indigo-300">Motor</div>
            <div className="mt-1 text-sm font-semibold text-indigo-200">{rocket.motor?.name || 'No motor selected'}</div>
            <div className="text-sm text-indigo-300/80">
              {rocket.motor ? `${(rocket.motor.averageThrust || 0).toFixed(1)} N avg · ${rocket.motor.burnTime.toFixed(2)} s` : 'No propulsion data'}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-800 bg-[#0b1220] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['external', 'internal', 'recovery', 'hardware'] as ComponentLane[]).map((lane) => (
              <button
                key={lane}
                type="button"
                onClick={() => toggleLane(lane)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  laneVisibility[lane] ? laneStyle[lane] : 'border-slate-700 bg-[#020817] text-slate-500'
                }`}
              >
                {laneLabel[lane]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span>Zoom</span>
              <input
                type="range"
                min="0.8"
                max="1.8"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
              />
              <span className="w-10 text-right">{zoom.toFixed(1)}x</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
              Show labels
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter components..."
              className="rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>
        </div>
      </div>

      <div className="border-b border-slate-800 bg-[#0f172a] px-5 py-3 text-sm text-slate-400">
        This schematic uses the parsed ORK component tree. External airframe length is measured from the structural chain only,
        while internals and recovery parts are overlaid in separate lanes.
      </div>

      <div className="overflow-x-auto border-b border-slate-800 bg-[#0b1220] px-4 py-4">
        <svg width={schematicWidth} height={schematicHeight} role="img" aria-label="Rocket design schematic">
          <rect x="0" y="0" width={schematicWidth} height={schematicHeight} fill="#0b1220" />
          <line x1={originX} y1={headerHeight} x2={schematicWidth - 20} y2={headerHeight} stroke="#334155" strokeWidth="1" />

          {Array.from({ length: tickCount }).map((_, index) => {
            const x = originX + index * scale;
            const major = index % 5 === 0;
            return (
              <g key={`tick-${index}`}>
                <line x1={x} y1={headerHeight} x2={x} y2={major ? headerHeight + 16 : headerHeight + 10} stroke="#64748b" strokeWidth={major ? 1.5 : 1} />
                <text x={x} y={headerHeight - 6} textAnchor="middle" fontSize="10" fill="#94a3b8">
                  {index}
                </text>
              </g>
            );
          })}

          <line x1={originX} y1={centerY} x2={schematicWidth - 20} y2={centerY} stroke="#334155" strokeDasharray="3 4" />

          {designData.externalStructure
            .filter((entry) => laneVisibility[entry.lane])
            .map((entry) => {
            const x = xFor(entry.absoluteTop);
            const width = widthFor(entry.length);
            const selected = isSelected(entry.component.id);

            if (entry.component.type === 'NOSECONE') {
              return (
                <path
                  key={entry.component.id}
                  d={[
                    `M ${x} ${centerY}`,
                    `Q ${x + width * 0.42} ${centerY - bodyHalfHeight * 0.85} ${x + width} ${centerY - bodyHalfHeight}`,
                    `L ${x + width} ${centerY + bodyHalfHeight}`,
                    `Q ${x + width * 0.42} ${centerY + bodyHalfHeight * 0.85} ${x} ${centerY}`,
                    'Z',
                  ].join(' ')}
                  fill="#0f172a"
                  stroke={selected ? '#1d4ed8' : '#2563eb'}
                  strokeWidth={selected ? '3' : '2'}
                  className="cursor-pointer"
                  onClick={() => selectComponent(entry.component.id)}
                />
              );
            }

            if (entry.component.type === 'TRANSITION') {
              const fore = widthFor((entry.component as any).foreDiameter || entry.diameter) * 0.5;
              const aft = widthFor((entry.component as any).aftDiameter || entry.diameter) * 0.5;
              return (
                <polygon
                  key={entry.component.id}
                  points={`${x},${centerY - fore} ${x + width},${centerY - aft} ${x + width},${centerY + aft} ${x},${centerY + fore}`}
                  fill="#0f172a"
                  stroke={selected ? '#1d4ed8' : '#2563eb'}
                  strokeWidth={selected ? '3' : '2'}
                  className="cursor-pointer"
                  onClick={() => selectComponent(entry.component.id)}
                />
              );
            }

            return (
              <rect
                key={entry.component.id}
                x={x}
                y={centerY - bodyHalfHeight}
                width={width}
                height={bodyHalfHeight * 2}
                fill="#0f172a"
                stroke={selected ? '#1d4ed8' : '#2563eb'}
                strokeWidth={selected ? '3' : '2'}
                className="cursor-pointer"
                onClick={() => selectComponent(entry.component.id)}
              />
            );
          })}

          {visiblePositioned
            .filter((entry) => entry.component.type === 'FINS')
            .map((entry) => {
              const x = xFor(entry.absoluteTop);
              const root = widthFor((entry.component as any).rootChord || entry.length);
              const tip = widthFor((entry.component as any).tipChord || entry.length * 0.5);
              const sweep = widthFor((entry.component as any).sweep || 0);
              const selected = isSelected(entry.component.id);
              return (
                <g key={entry.component.id} className="cursor-pointer" onClick={() => selectComponent(entry.component.id)}>
                  <polygon
                    points={`${x},${centerY - bodyHalfHeight} ${x + sweep},${centerY - bodyHalfHeight - finHeight} ${x + sweep + tip},${centerY - bodyHalfHeight - finHeight} ${x + root},${centerY - bodyHalfHeight}`}
                    fill="#2563eb"
                    stroke={selected ? '#0f172a' : '#1d4ed8'}
                    strokeWidth={selected ? '2.5' : '1.5'}
                  />
                  <polygon
                    points={`${x},${centerY + bodyHalfHeight} ${x + sweep},${centerY + bodyHalfHeight + finHeight} ${x + sweep + tip},${centerY + bodyHalfHeight + finHeight} ${x + root},${centerY + bodyHalfHeight}`}
                    fill="#2563eb"
                    stroke={selected ? '#0f172a' : '#1d4ed8'}
                    strokeWidth={selected ? '2.5' : '1.5'}
                  />
                </g>
              );
            })}

          {visiblePositioned
            .filter((entry) => entry.lane === 'internal' || entry.lane === 'hardware')
            .map((entry) => {
              const x = xFor(entry.absoluteTop);
              const width = widthFor(entry.length);
              const height = entry.lane === 'hardware' ? internalHeight * 0.65 : internalHeight;
              const y = centerY - height / 2;
              const selected = isSelected(entry.component.id);
              return (
                <rect
                  key={entry.component.id}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={entry.lane === 'hardware' ? '#451a03' : 'transparent'}
                  stroke={selected ? '#111827' : entry.lane === 'hardware' ? '#d97706' : '#64748b'}
                  strokeWidth={selected ? '2.5' : '1.5'}
                  strokeDasharray={entry.lane === 'hardware' ? '0' : '4 4'}
                  opacity={0.9}
                  className="cursor-pointer"
                  onClick={() => selectComponent(entry.component.id)}
                />
              );
            })}

          {visiblePositioned
            .filter((entry) => entry.lane === 'recovery')
            .map((entry) => {
              const x = xFor(entry.absoluteTop);
              const width = widthFor(entry.length);
              const selected = isSelected(entry.component.id);
              if (entry.component.type === 'PARACHUTE') {
                return (
                  <ellipse
                    key={entry.component.id}
                    cx={x + width / 2}
                    cy={centerY}
                    rx={Math.max(width / 2, 10)}
                    ry={Math.max(internalHeight * 0.7, 10)}
                    fill="none"
                    stroke={selected ? '#991b1b' : '#ef4444'}
                    strokeWidth={selected ? '2.5' : '1.5'}
                    strokeDasharray="4 3"
                    className="cursor-pointer"
                    onClick={() => selectComponent(entry.component.id)}
                  />
                );
              }

              const segments = Math.max(4, Math.floor(width / 16));
              const points = Array.from({ length: segments + 1 }).map((_, i) => {
                const xPos = x + (width * i) / segments;
                const yPos = centerY + (i % 2 === 0 ? -4 : 4);
                return `${xPos},${yPos}`;
              });
              return (
                <polyline
                  key={entry.component.id}
                  points={points.join(' ')}
                  fill="none"
                  stroke={selected ? '#991b1b' : '#ef4444'}
                  strokeWidth={selected ? '2.5' : '1.5'}
                  strokeDasharray="3 3"
                  className="cursor-pointer"
                  onClick={() => selectComponent(entry.component.id)}
                />
              );
            })}

          {motorPlacement && (
            <g>
              <rect
                x={xFor(motorPlacement.top)}
                y={centerY - Math.max(bodyHalfHeight * 0.6, 12)}
                width={widthFor(motorPlacement.bottom - motorPlacement.top)}
                height={Math.max(bodyHalfHeight * 1.2, 24)}
                fill="#312e81"
                stroke="#7c3aed"
                strokeWidth="1.8"
              />
              <text
                x={xFor(motorPlacement.top) + widthFor(motorPlacement.bottom - motorPlacement.top) / 2}
                y={centerY + Math.max(bodyHalfHeight * 0.9, 20)}
                textAnchor="middle"
                fontSize="11"
                fill="#c4b5fd"
                fontWeight="600"
              >
                {rocket.motor?.name}
              </text>
            </g>
          )}

          {[
            { label: 'CG', x: xFor(stability.cg), color: '#2563eb' },
            { label: 'CP', x: xFor(stability.cp), color: '#ef4444' },
          ].map((marker) => (
            <g key={marker.label}>
              <line x1={marker.x} y1={centerY - bodyHalfHeight - finHeight - 16} x2={marker.x} y2={centerY + bodyHalfHeight + finHeight + 16} stroke={marker.color} strokeDasharray="4 4" />
              <circle cx={marker.x} cy={centerY - bodyHalfHeight - 12} r="7" fill="#020817" stroke={marker.color} strokeWidth="2" />
              <text x={marker.x} y={centerY - bodyHalfHeight - 24} textAnchor="middle" fontSize="10" fill={marker.color} fontWeight="700">
                {marker.label}
              </text>
            </g>
          ))}

          {showLabels && (() => {
            const labelEntries = visiblePositioned
              .filter((entry) => entry.component.type !== 'SHOCK_CORD' && entry.component.type !== 'CENTERING_RING')
              .map((entry) => ({
                entry,
                centerX: xFor(entry.absoluteTop) + widthFor(entry.length) / 2,
              }))
              .sort((a, b) => a.centerX - b.centerX);

            // Stagger overlapping labels: track last used x per lane+level
            const lastX: Record<string, number> = {};
            return labelEntries.map(({ entry, centerX }) => {
              const baseY = entry.lane === 'external'
                ? centerY - bodyHalfHeight - finHeight - 30
                : centerY + bodyHalfHeight + finHeight + 22;
              const laneKey0 = `${entry.lane}-0`;
              const laneKey1 = `${entry.lane}-1`;
              // Use stagger level 1 (offset ±14px) if too close to last label at level 0
              let level = 0;
              if (lastX[laneKey0] !== undefined && Math.abs(centerX - lastX[laneKey0]) < 60) {
                level = 1;
              }
              const y = entry.lane === 'external'
                ? baseY - level * 14
                : baseY + level * 14;
              const laneKey = `${entry.lane}-${level}`;
              lastX[laneKey] = centerX;
              return (
                <text
                  key={`label-${entry.component.id}`}
                  x={centerX}
                  y={y}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#94a3b8"
                >
                  {entry.component.name}
                </text>
              );
            });
          })()}
        </svg>
      </div>

      <div className="grid grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="rounded-2xl border border-slate-800 bg-[#0b1220] shadow-sm">
          <div className="border-b border-slate-800 px-4 py-3">
            <h3 className="text-base font-semibold text-slate-100">Component Inventory</h3>
            <p className="mt-1 text-sm text-slate-500">Parsed ORK components with absolute start/end positions along the rocket axis.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#020817] text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Component</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">End</th>
                  <th className="px-4 py-3">Length</th>
                  <th className="px-4 py-3">Mass</th>
                  <th className="px-4 py-3">Lane</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventoryRows.map((row) => (
                  <tr
                    key={row.key}
                    className={`cursor-pointer border-t border-slate-800 ${selectedComponentId === row.componentId ? 'bg-cyan-500/10' : 'hover:bg-[#0f172a]'}`}
                    onClick={() => setSelectedComponentId(row.componentId)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-100">{row.name}</td>
                    <td className="px-4 py-3 text-slate-400">{row.type}</td>
                    <td className="px-4 py-3 text-slate-400">{row.start.toFixed(2)} in</td>
                    <td className="px-4 py-3 text-slate-400">{row.end.toFixed(2)} in</td>
                    <td className="px-4 py-3 text-slate-400">{row.length.toFixed(2)} in</td>
                    <td className="px-4 py-3 text-slate-400">{row.mass.toFixed(1)} g</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${laneStyle[row.lane]}`}>
                        {row.lane}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-4 shadow-sm">
            <h3 className="text-base font-semibold text-slate-100">Checks</h3>
            <div className="mt-3 space-y-2 text-sm text-slate-400">
              <div className="flex items-center justify-between">
                <span>CG / CP source</span>
                <span className="font-medium text-slate-100">
                  {rocket.manualOverride?.cp !== undefined || rocket.manualOverride?.cg !== undefined
                    ? 'Manual override'
                    : rocket.simulationSettings?.cp !== undefined || rocket.simulationSettings?.cg !== undefined
                      ? 'Imported ORK'
                      : 'Calculated'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Reference length</span>
                <span className="font-medium text-slate-100">
                  {toInches(resolveStabilityReferenceLength(rocket.stages, rocket.simulationSettings?.referenceLength)).toFixed(2)} in
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Motor anchored</span>
                <span className="font-medium text-slate-100">{motorPlacement ? 'Yes' : 'Fallback tail placement'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Tiny components</span>
                <span className="font-medium text-slate-100">{diagnostics.tinyComponents.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>External gaps</span>
                <span className="font-medium text-slate-100">{diagnostics.gapCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>External overlaps</span>
                <span className="font-medium text-slate-100">{diagnostics.overlapCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Non-recovery beyond tail</span>
                <span className="font-medium text-slate-100">{diagnostics.outsideBody}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-4 shadow-sm">
            <h3 className="text-base font-semibold text-slate-100">Selected Component</h3>
            {selectedPosition ? (
              <div className="mt-3 space-y-2 text-sm text-slate-400">
                <div className="text-sm font-semibold text-slate-100">{selectedPosition.component.name}</div>
                <div className="flex items-center justify-between">
                  <span>Type</span>
                  <span className="font-medium text-slate-100">{getComponentTypeLabel(selectedPosition.component)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Start</span>
                  <span className="font-medium text-slate-100">{toInches(selectedPosition.absoluteTop).toFixed(2)} in</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>End</span>
                  <span className="font-medium text-slate-100">{toInches(selectedPosition.absoluteBottom).toFixed(2)} in</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Length</span>
                  <span className="font-medium text-slate-100">{toInches(selectedPosition.length).toFixed(2)} in</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Diameter</span>
                  <span className="font-medium text-slate-100">{toInches(selectedPosition.diameter).toFixed(2)} in</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Mass</span>
                  <span className="font-medium text-slate-100">{toGrams(selectedPosition.component.mass || 0).toFixed(1)} g</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Lane</span>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${laneStyle[selectedPosition.lane]}`}>
                    {laneLabel[selectedPosition.lane]}
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Select a component in the schematic or the inventory table to inspect it.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-4 shadow-sm">
            <h3 className="text-base font-semibold text-slate-100">What This View Is Good For</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li>Verifying ORK import geometry without needing to run a flight simulation.</li>
              <li>Checking whether internals and recovery hardware sit in believable axial locations.</li>
              <li>Comparing displayed CG/CP against OpenRocket-style imported values.</li>
              <li>Reviewing component lengths, masses, and placement in one place.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RocketDesignViewer;
