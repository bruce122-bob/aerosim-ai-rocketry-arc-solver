// @ts-nocheck
/**
 * ============================================================================
 * ENHANCED 3D ROCKET VISUALIZATION
 * - Smooth physics-based animation with interpolation
 * - Advanced particle systems (flame, smoke, exhaust trail)
 * - Real-time data visualization (trajectory, velocity vectors, altitude markers)
 * - Professional camera system with multiple views
 * - Enhanced environment (launch pad, clouds, atmospheric effects)
 * - Realistic parachute deployment and animation
 * ============================================================================
 */

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RocketConfig, SimulationPoint, RocketComponent } from '../types';
import * as THREE from 'three';

interface Rocket3DEnhancedProps {
  config: RocketConfig;
  simulationData: SimulationPoint[];
  isPlaying: boolean;
  playbackTime: number;
  cameraFollow?: boolean;
  controlsRef?: React.RefObject<any>;
  cameraMode?: 'follow' | 'fixed' | 'cinematic' | 'free';
}

const interpolateValue = (a?: number, b?: number, t: number = 0): number | undefined => {
  if (typeof a !== 'number' && typeof b !== 'number') return undefined;
  if (typeof a !== 'number') return b;
  if (typeof b !== 'number') return a;
  return a + (b - a) * t;
};

// ============================================================================
// ADVANCED PARTICLE SYSTEM: ENGINE FLAME
// ============================================================================
const EngineFlame: React.FC<{ 
  thrust: number; 
  visible: boolean;
  time: number;
}> = ({ thrust, visible, time }) => {
  const flameGroupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const middleRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  // Particle system for exhaust
  const particleCount = 200;
  const particles = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.1;
      positions[i * 3 + 1] = -Math.random() * 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
      velocities[i * 3] = (Math.random() - 0.5) * 0.5;
      velocities[i * 3 + 1] = -Math.random() * 2 - 1;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      lifetimes[i] = Math.random();
    }
    
    return { positions, velocities, lifetimes };
  }, []);
  
  useFrame((state, delta) => {
    if (!flameGroupRef.current || !visible) return;

    const thrustScale = Math.min(thrust / 60, 1.0);
    const flicker = 0.85 + Math.sin(time * 30) * 0.15;
    const scale = thrustScale * flicker;

    // Animate flame layers
    if (coreRef.current) {
      coreRef.current.scale.set(1, scale * 1.5 + 0.3, 1);
      const intensity = 0.9 + Math.sin(time * 40) * 0.1;
      coreRef.current.material.opacity = intensity;
    }
    if (middleRef.current) {
      middleRef.current.scale.set(1, scale * 2 + 0.5, 1);
    }
    if (outerRef.current) {
      outerRef.current.scale.set(1, scale * 2.5 + 0.7, 1);
    }

    // Animate particles
    if (particlesRef.current) {
      const positions = particles.positions;
    const velocities = particles.velocities;
      const lifetimes = particles.lifetimes;

      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        
        // Update position
        positions[i3] += velocities[i3] * delta * 2;
        positions[i3 + 1] += velocities[i3 + 1] * delta * 2;
        positions[i3 + 2] += velocities[i3 + 2] * delta * 2;
        
        // Update lifetime
        lifetimes[i] += delta * 0.5;
        
        // Reset particles that are too far or expired
        if (lifetimes[i] > 1 || positions[i3 + 1] < -2) {
          positions[i3] = (Math.random() - 0.5) * 0.1;
          positions[i3 + 1] = 0;
          positions[i3 + 2] = (Math.random() - 0.5) * 0.1;
          velocities[i3] = (Math.random() - 0.5) * 0.5;
          velocities[i3 + 1] = -Math.random() * 2 - 1;
          velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;
          lifetimes[i] = 0;
        }
      }

      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  if (!visible) return null;
  
  return (
    <group ref={flameGroupRef} position={[0, -0.5, 0]}>
      {/* Core - Bright white/yellow */}
      <mesh ref={coreRef} position={[0, -0.1, 0]}>
        <coneGeometry args={[0.015, 0.12, 16]} />
        <meshBasicMaterial 
          color="#ffffaa" 
          transparent 
          opacity={0.95}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Middle - Orange */}
      <mesh ref={middleRef} position={[0, -0.25, 0]}>
        <coneGeometry args={[0.03, 0.3, 20]} />
        <meshBasicMaterial 
          color="#ff6600" 
          transparent 
          opacity={0.8}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Outer - Red/Dark */}
      <mesh ref={outerRef} position={[0, -0.4, 0]}>
        <coneGeometry args={[0.045, 0.5, 24]} />
        <meshBasicMaterial 
          color="#ff3300" 
          transparent 
          opacity={0.6}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Exhaust particles */}
      {particles.positions.length >= particleCount * 3 && particles.positions.length === particleCount * 3 && (
        <points ref={particlesRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={particleCount}
              array={particles.positions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial
            size={0.03} 
            color="#888888" 
            transparent
            opacity={0.4}
            sizeAttenuation
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}
    </group>
  );
};

// ============================================================================
// TRAJECTORY LINE
// ============================================================================
const TrajectoryLine: React.FC<{ 
  simulationData: SimulationPoint[];
  currentTime: number;
}> = ({ simulationData, currentTime }) => {
  const lineRef = useRef<THREE.Line>(null);
  
  const points = useMemo(() => {
    const trajectoryPoints: THREE.Vector3[] = [];
    simulationData.forEach(point => {
      trajectoryPoints.push(
        new THREE.Vector3(
          point.range,
          point.altitude,
          0
        )
      );
    });
    return trajectoryPoints;
  }, [simulationData]);
  
  // Highlight current position
  const currentIndex = useMemo(() => {
    return points.findIndex((_, i) => {
      if (i === points.length - 1) return true;
      const t1 = simulationData[i]?.time || 0;
      const t2 = simulationData[i + 1]?.time || 0;
      return currentTime >= t1 && currentTime < t2;
    });
  }, [currentTime, simulationData, points]);
  
  // Guard: Don't render if no points
  if (points.length === 0) {
    return null;
  }

  // Ensure array size matches count * itemSize
  const validPoints = points.filter(p => p && !isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z));
  if (validPoints.length === 0) {
    return null;
  }

  const positionArray = new Float32Array(validPoints.flatMap(p => [p.x, p.y, p.z]));
  const expectedSize = validPoints.length * 3;
  const actualSize = positionArray.length;
  
  // Ensure exact match
  if (actualSize !== expectedSize) {
    console.warn(`[TrajectoryLine] Buffer size mismatch: expected ${expectedSize}, got ${actualSize}`);
    return null;
  }

  return (
    <>
      {/* Full trajectory - past */}
    <line ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={validPoints.length}
            array={positionArray}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial 
          color="#4a9eff" 
          linewidth={2}
          transparent
          opacity={0.6}
        />
    </line>
      
      {/* Current position marker */}
      {currentIndex >= 0 && currentIndex < points.length && (
        <mesh position={points[currentIndex]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshBasicMaterial color="#ffff00" transparent opacity={0.8} />
        </mesh>
      )}
    </>
  );
};

// ============================================================================
// VELOCITY VECTOR VISUALIZATION
// ============================================================================
const VelocityVector: React.FC<{
  velocityX: number;
  velocityY: number;
  position: THREE.Vector3;
}> = ({ velocityX, velocityY, position }) => {
  const arrowRef = useRef<THREE.ArrowHelper | null>(null);
  
  useEffect(() => {
    const vectorLength = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    const arrowLength = Math.min(vectorLength * 0.1, 5);
    
    if (arrowLength < 0.1) {
      if (arrowRef.current) {
        arrowRef.current.visible = false;
      }
      return;
    }

    const direction = new THREE.Vector3(velocityX, velocityY, 0).normalize();
    
    if (!arrowRef.current) {
      arrowRef.current = new THREE.ArrowHelper(
        direction,
        position,
        arrowLength,
        0xff0000,
        arrowLength * 0.3,
        arrowLength * 0.2
      );
    } else {
      arrowRef.current.setDirection(direction);
      arrowRef.current.setLength(arrowLength, arrowLength * 0.3, arrowLength * 0.2);
      arrowRef.current.position.copy(position);
      arrowRef.current.visible = true;
    }

    return () => {
      if (arrowRef.current) {
        arrowRef.current.dispose();
      }
    };
  }, [velocityX, velocityY, position]);

  if (!arrowRef.current) return null;
  return <primitive object={arrowRef.current} />;
};

const WindVector: React.FC<{
  windX: number;
  windY: number;
  position: THREE.Vector3;
}> = ({ windX, windY, position }) => {
  const arrowRef = useRef<THREE.ArrowHelper | null>(null);

  useEffect(() => {
    const vectorLength = Math.sqrt(windX * windX + windY * windY);
    const arrowLength = Math.min(Math.max(vectorLength * 0.35, 0), 4);

    if (arrowLength < 0.15) {
      if (arrowRef.current) {
        arrowRef.current.visible = false;
      }
      return;
    }

    const direction = new THREE.Vector3(windX, windY, 0).normalize();
    const anchor = position.clone().add(new THREE.Vector3(0, 1.2, 0));

    if (!arrowRef.current) {
      arrowRef.current = new THREE.ArrowHelper(
        direction,
        anchor,
        arrowLength,
        0x38bdf8,
        arrowLength * 0.28,
        arrowLength * 0.18
      );
    } else {
      arrowRef.current.position.copy(anchor);
      arrowRef.current.setDirection(direction);
      arrowRef.current.setLength(arrowLength, arrowLength * 0.28, arrowLength * 0.18);
      arrowRef.current.visible = true;
    }

    return () => {
      if (arrowRef.current) {
        arrowRef.current.dispose();
      }
    };
  }, [windX, windY, position]);

  if (!arrowRef.current) return null;
  return <primitive object={arrowRef.current} />;
};

// ============================================================================
// ALTITUDE MARKERS
// ============================================================================
const AltitudeMarkers: React.FC<{
  maxAltitude: number;
  currentAltitude: number;
}> = ({ maxAltitude, currentAltitude }) => {
  const markers = useMemo(() => {
    const markers: JSX.Element[] = [];
    const step = Math.max(maxAltitude / 10, 10); // Every 10m or 10% of max
    
    for (let alt = 0; alt <= maxAltitude; alt += step) {
      if (alt === 0) continue;
      
      markers.push(
        <group key={alt}>
          {/* Marker line */}
          <line position={[0, alt, 0]}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([-5, alt, 0, 5, alt, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial 
              color={alt <= currentAltitude ? "#00ff00" : "#666666"} 
              linewidth={1}
              transparent
              opacity={0.5}
            />
          </line>
          
          {/* Label (using sprite would be better, but this works) */}
          <mesh position={[-6, alt, 0]}>
            <planeGeometry args={[1, 0.3]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
          </mesh>
    </group>
  );
    }
    
    return markers;
  }, [maxAltitude, currentAltitude]);

  return <>{markers}</>;
};

// ============================================================================
// ENHANCED PARACHUTE
// ============================================================================
const EnhancedParachute: React.FC<{
  position: THREE.Vector3;
  deployed: boolean;
  deployProgress: number;
  time: number;
}> = ({ position, deployed, deployProgress, time }) => {
  const parachuteRef = useRef<THREE.Group>(null);
  const canopyRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!parachuteRef.current || !deployed) return;

    // Swaying motion
    const swayX = Math.sin(time * 1.5) * 0.3 * deployProgress;
    const swayZ = Math.cos(time * 1.2) * 0.25 * deployProgress;
    const swayY = Math.sin(time * 0.8) * 0.1 * deployProgress;
    
    parachuteRef.current.position.copy(position);
    parachuteRef.current.position.y += 1.5 + swayY;
    parachuteRef.current.position.x += swayX;
    parachuteRef.current.position.z += swayZ;

    // Rotation
    parachuteRef.current.rotation.y = time * 0.3;
    parachuteRef.current.rotation.x = Math.sin(time) * 0.1;

    // Canopy inflation animation
    if (canopyRef.current) {
      const scale = 0.3 + deployProgress * 0.7;
      canopyRef.current.scale.set(scale, scale, scale);
    }
  });

  if (!deployed) return null;
  
  return (
    <group ref={parachuteRef}>
      {/* Canopy - Inflated hemisphere */}
      <mesh ref={canopyRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.3, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color="#ff6b35"
          side={THREE.DoubleSide}
          roughness={0.7}
          metalness={0.1}
          transparent
          opacity={0.85}
        />
      </mesh>
      
      {/* Parachute lines */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const x = Math.cos(angle) * 0.3;
        const z = Math.sin(angle) * 0.3;
        
        return (
          <line key={`line-${i}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([x, 0, z, 0, -1.5, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#444444" linewidth={1.5} />
          </line>
        );
      })}
      
      {/* Connection ring */}
      <mesh position={[0, -1.5, 0]}>
        <torusGeometry args={[0.02, 0.005, 16, 32]} />
        <meshStandardMaterial color="#111111" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
};

// ============================================================================
// LAUNCH PAD
// ============================================================================
const LaunchPad: React.FC = () => {
  return (
    <group position={[0, 0, 0]}>
      {/* Base platform */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.02, 32]} />
        <meshStandardMaterial color="#555555" metalness={0.8} roughness={0.2} />
      </mesh>
      
      {/* Launch rail */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.02, 1, 0.02]} />
        <meshStandardMaterial color="#333333" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* Support legs */}
      {[0, 120, 240].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * 0.3;
        const z = Math.sin(rad) * 0.3;
        return (
          <mesh key={i} position={[x, 0.25, z]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.5, 8]} />
            <meshStandardMaterial color="#444444" metalness={0.7} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
};

// ============================================================================
// MAIN ROCKET 3D COMPONENT
// ============================================================================
const Rocket3DEnhanced: React.FC<Rocket3DEnhancedProps> = ({
  config,
  simulationData,
  isPlaying,
  playbackTime,
  cameraFollow = false,
  controlsRef,
  cameraMode = 'follow'
}) => {
  const rocketRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  
  const [trailPoints, setTrailPoints] = useState<THREE.Vector3[]>([]);
  const [apogeeTime, setApogeeTime] = useState(0);
  const [parachuteDeployTime, setParachuteDeployTime] = useState(0);

  // Find apogee
  useEffect(() => {
    if (simulationData.length === 0) return;
    const maxAlt = Math.max(...simulationData.map(p => p.altitude));
    const apogeePoint = simulationData.find(p => p.altitude === maxAlt);
    if (apogeePoint) {
      setApogeeTime(apogeePoint.time);
      setParachuteDeployTime(apogeePoint.time + 0.5);
    }
  }, [simulationData]);

  // Interpolate current state
  const getCurrentState = useMemo(() => {
    return (time: number): SimulationPoint | null => {
      if (!simulationData || simulationData.length === 0) return null;
      
      let idx = 0;
      for (let i = 0; i < simulationData.length; i++) {
        if (simulationData[i].time > time) {
          idx = Math.max(0, i - 1);
          break;
        }
      }
      
      if (idx >= simulationData.length - 1) {
        return simulationData[simulationData.length - 1];
      }
      
      const p1 = simulationData[idx];
      const p2 = simulationData[idx + 1];
      const t = (time - p1.time) / (p2.time - p1.time);
      
      return {
        time,
        altitude: p1.altitude + (p2.altitude - p1.altitude) * t,
        range: p1.range + (p2.range - p1.range) * t,
        velocity: p1.velocity + (p2.velocity - p1.velocity) * t,
        velocityX: p1.velocityX + (p2.velocityX - p1.velocityX) * t,
        velocityY: p1.velocityY + (p2.velocityY - p1.velocityY) * t,
        acceleration: p1.acceleration + (p2.acceleration - p1.acceleration) * t,
        thrust: p1.thrust + (p2.thrust - p1.thrust) * t,
        drag: p1.drag,
        mass: p1.mass,
        airDensity: p1.airDensity,
        cd: p1.cd,
        pitch: interpolateValue(p1.pitch, p2.pitch, t),
        mach: interpolateValue(p1.mach, p2.mach, t),
        angleOfAttack: interpolateValue(p1.angleOfAttack, p2.angleOfAttack, t),
        dragCoefficient: interpolateValue(p1.dragCoefficient, p2.dragCoefficient, t),
        relativeAirspeed: interpolateValue(p1.relativeAirspeed, p2.relativeAirspeed, t),
        dynamicPressure: interpolateValue(p1.dynamicPressure, p2.dynamicPressure, t),
        windSpeedAtAltitude: interpolateValue(p1.windSpeedAtAltitude, p2.windSpeedAtAltitude, t),
        windVelocityX: interpolateValue(p1.windVelocityX, p2.windVelocityX, t),
        windVelocityY: interpolateValue(p1.windVelocityY, p2.windVelocityY, t),
        parachuteDeployed: t < 0.5 ? p1.parachuteDeployed : p2.parachuteDeployed
      };
    };
  }, [simulationData]);

  // Animation loop
  useFrame((state, delta) => {
    if (!rocketRef.current || !simulationData || simulationData.length === 0) return;
    
    const currentState = getCurrentState(playbackTime);
    if (!currentState) return;

    const altitude = currentState.altitude;
    const range = currentState.range;
    
    // Smooth position update with interpolation
    rocketRef.current.position.lerp(new THREE.Vector3(range, altitude, 0), 0.3);
    
    // Smooth rotation based on velocity
    if (typeof currentState.pitch === 'number') {
      const pitchRad = (currentState.pitch * Math.PI) / 180;
      const targetAngle = Math.PI / 2 - pitchRad;
      rocketRef.current.rotation.z = THREE.MathUtils.lerp(
        rocketRef.current.rotation.z,
        -targetAngle,
        0.1
      );
    } else if (currentState.velocityX !== 0 || currentState.velocityY !== 0) {
      const targetAngle = Math.atan2(currentState.velocityX, currentState.velocityY);
      rocketRef.current.rotation.z = THREE.MathUtils.lerp(
        rocketRef.current.rotation.z,
        -targetAngle,
        0.1
      );
    }

    // Add slight roll for realism
    rocketRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 2) * 0.05;

    // Update trail
    if (currentState.thrust > 0 && playbackTime % 0.05 < delta) {
      setTrailPoints(prev => {
        const newPoint = new THREE.Vector3(range, altitude, 0);
        return [...prev.slice(-100), newPoint];
      });
    }

    // Camera following
    if (cameraFollow && cameraMode === 'follow') {
      const targetPos = new THREE.Vector3(range + 10, altitude + 4, 12);
      camera.position.lerp(targetPos, 0.05);
      camera.lookAt(range, altitude, 0);
    } else if (cameraMode === 'cinematic') {
      const angle = state.clock.elapsedTime * 0.1;
      const distance = 18 + altitude * 0.08;
      const targetPos = new THREE.Vector3(
        range + Math.sin(angle) * distance,
        altitude + 8,
        Math.cos(angle) * distance
      );
      camera.position.lerp(targetPos, 0.03);
      camera.lookAt(range, altitude, 0);
    }
  });

  // Generate rocket geometry
  const rocketGeometry = useMemo(() => {
    const elements: JSX.Element[] = [];
    
    const renderComponent = (comp: RocketComponent, parentY: number, key: string): void => {
      const currentTopY = parentY - (comp.position || 0);
    
    switch (comp.type) {
      case 'NOSECONE': {
          const L = comp.length || 0.1;
          const R = (comp.baseDiameter || 0.06) / 2;
        const centerY = currentTopY - L / 2;
          
        elements.push(
            <mesh key={key} position={[0, centerY, 0]} castShadow receiveShadow>
              <coneGeometry args={[R, L, 32]} />
              <meshStandardMaterial 
                color={comp.color || '#e0e0e0'} 
                metalness={0.7}
                roughness={0.2}
              />
          </mesh>
        );
        break;
      }
        
      case 'BODYTUBE': {
          const L = comp.length || 0.3;
          const R = (comp.diameter || 0.06) / 2;
        const centerY = currentTopY - L / 2;
          
        elements.push(
            <mesh key={key} position={[0, centerY, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[R, R, L, 32]} />
              <meshStandardMaterial 
                color={comp.color || '#ffffff'} 
                metalness={0.5}
                roughness={0.4}
              />
          </mesh>
        );
        break;
        }
        
        case 'FINS': {
          const finCount = comp.finCount || 3;
          const rootChord = comp.rootChord || 0.1;
          const tipChord = comp.tipChord || 0.05;
          const span = comp.height || 0.08;
          const sweep = comp.sweep || 0.03;
          const thickness = comp.thickness || 0.003;
          
          const shape = new THREE.Shape();
          shape.moveTo(0, 0);
          shape.lineTo(span, -sweep);
          shape.lineTo(span, -sweep - tipChord);
          shape.lineTo(0, -rootChord);
          shape.closePath();
          
          const parentRadius = (comp.parent?.diameter || 0.06) / 2;
          
          for (let i = 0; i < finCount; i++) {
            const angle = (i / finCount) * Math.PI * 2;
            
            elements.push(
              <group key={`${key}-fin-${i}`} rotation={[0, angle, 0]} position={[0, currentTopY - rootChord / 2, 0]}>
                <mesh position={[parentRadius, 0, -thickness / 2]} castShadow>
                  <extrudeGeometry args={[shape, { depth: thickness, bevelEnabled: true }]} />
                  <meshStandardMaterial 
                    color={comp.color || '#333333'} 
                    metalness={0.4}
                    roughness={0.6}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </group>
            );
          }
          break;
        }
      }

      if (comp.subComponents) {
        comp.subComponents.forEach((sub, idx) => {
          renderComponent(sub, currentTopY, `${key}-${idx}`);
        });
      }
    };

    let topY = 0;
    config.stages.forEach((stage, stageIdx) => {
      renderComponent(stage, topY, `stage-${stageIdx}`);
      topY -= (stage.length || 0);
    });

    return elements;
  }, [config]);
  
  const currentState = getCurrentState(playbackTime);
  const maxAltitude = Math.max(...simulationData.map(p => p.altitude));
  const isParachuteDeployed =
    Boolean(currentState?.parachuteDeployed) ||
    (playbackTime >= parachuteDeployTime && (currentState?.velocityY || 0) < -1);
  const parachuteProgress = isParachuteDeployed 
    ? Math.min((playbackTime - parachuteDeployTime) / 0.5, 1.0)
    : 0;
  
  return (
    <>
      {/* Launch Pad */}
      <LaunchPad />
      
      {/* Trajectory Line */}
      <TrajectoryLine simulationData={simulationData} currentTime={playbackTime} />

      {/* Altitude Markers */}
      <AltitudeMarkers 
        maxAltitude={maxAltitude} 
        currentAltitude={currentState?.altitude || 0} 
      />

      {/* Rocket */}
      <group ref={rocketRef}>
        {rocketGeometry}
        
        {/* Engine Flame */}
        {currentState && (
        <EngineFlame
            thrust={currentState.thrust} 
            visible={currentState.thrust > 0.5}
            time={playbackTime}
          />
        )}
      </group>
      
      {/* Velocity Vector - Only show during ascent */}
      {currentState && currentState.velocityY > 0 && (
        <VelocityVector
          velocityX={currentState.velocityX}
          velocityY={currentState.velocityY}
          position={rocketRef.current?.position || new THREE.Vector3()}
        />
      )}

      {currentState && ((currentState.windVelocityX || 0) !== 0 || (currentState.windVelocityY || 0) !== 0) && (
        <WindVector
          windX={currentState.windVelocityX || 0}
          windY={currentState.windVelocityY || 0}
          position={rocketRef.current?.position || new THREE.Vector3()}
        />
      )}

      {/* Parachute */}
      {currentState && isParachuteDeployed && (
      <EnhancedParachute
          position={rocketRef.current?.position || new THREE.Vector3()}
          deployed={isParachuteDeployed}
          deployProgress={parachuteProgress}
          time={playbackTime}
        />
      )}

      {/* Exhaust Trail */}
      {trailPoints.length > 1 && (() => {
        const trailArray = new Float32Array(trailPoints.flatMap(p => [p.x, p.y, p.z]));
        const expectedTrailSize = trailPoints.length * 3;
        const actualTrailSize = trailArray.length;
        
        let finalTrailArray = trailArray;
        if (actualTrailSize < expectedTrailSize) {
          finalTrailArray = new Float32Array(expectedTrailSize);
          finalTrailArray.set(trailArray, 0);
        } else if (actualTrailSize > expectedTrailSize) {
          finalTrailArray = trailArray.slice(0, expectedTrailSize);
        }
        
        return (
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={trailPoints.length}
                array={finalTrailArray}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial 
              color="#ff6600" 
              linewidth={1}
              transparent
              opacity={0.3}
            />
          </line>
        );
      })()}

      {/* Enhanced Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000, 50, 50]} />
        <meshStandardMaterial 
          color="#5a8f5a" 
          roughness={0.9}
          metalness={0.0}
        />
      </mesh>

      {/* Grid Helper */}
      <gridHelper args={[2000, 200, '#666666', '#444444']} position={[0, 0.01, 0]} />

      {/* Enhanced Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[10, 30, 10]} 
        intensity={1.2} 
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={200}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <hemisphereLight args={['#87CEEB', '#5a8f5a', 0.6]} />
      <pointLight position={[0, 100, 0]} intensity={0.3} color="#ffffff" />
    </>
  );
};

export default Rocket3DEnhanced;
