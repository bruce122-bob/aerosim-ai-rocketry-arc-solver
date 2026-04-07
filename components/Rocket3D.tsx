// @ts-nocheck
import React, { useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RocketConfig, SimulationPoint, RocketComponent } from '../types';
import * as THREE from 'three';

interface Rocket3DProps {
  config: RocketConfig;
  simulationData: SimulationPoint[];
  isPlaying: boolean;
  playbackTime: number;
  cameraFollow?: boolean;
  controlsRef?: React.RefObject<any>;
}

/**
 * ============================================================================
 * PROFESSIONAL ROCKET 3D VISUALIZATION
 * - Accurate physics-driven animation
 * - High-quality materials and lighting
 * - Realistic effects (flame, smoke, parachute)
 * - Smooth camera tracking
 * ============================================================================
 */
const Rocket3D: React.FC<Rocket3DProps> = ({ 
  config, 
  simulationData, 
  isPlaying, 
  playbackTime, 
  cameraFollow = false, 
  controlsRef 
}) => {
  const rocketRef = useRef<THREE.Group>(null!);
  const flameRef = useRef<THREE.Group>(null!);
  const parachuteRef = useRef<THREE.Group>(null!);
  const smokeParticlesRef = useRef<THREE.Points>(null!);
  const exhaustTrailRef = useRef<THREE.Group>(null!);
  
  const { camera } = useThree();
  const [cameraOffset] = useState(new THREE.Vector3(5, 2, 8));

  // ============================================================================
  // INTERPOLATE SIMULATION DATA FOR SMOOTH ANIMATION
  // ============================================================================
  const getCurrentState = useMemo(() => {
    return (time: number): SimulationPoint | null => {
      if (!simulationData || simulationData.length === 0) return null;
      
      // Find surrounding data points
      let idx = 0;
      for (let i = 0; i < simulationData.length; i++) {
        if (simulationData[i].time > time) {
          idx = Math.max(0, i - 1);
          break;
        }
      }
      
      if (idx >= simulationData.length - 1) return simulationData[simulationData.length - 1];
      
      const p1 = simulationData[idx];
      const p2 = simulationData[idx + 1];
      
      // Linear interpolation
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
        cd: p1.cd
      };
    };
  }, [simulationData]);

  // ============================================================================
  // ANIMATION UPDATE LOOP
  // ============================================================================
  useFrame((state, delta) => {
    if (!rocketRef.current || !simulationData || simulationData.length === 0) return;
    
    const currentState = getCurrentState(playbackTime);
    if (!currentState) return;

    // Convert feet to meters for 3D space (simulation uses imperial units)
    const altitude = currentState.altitude * 0.3048; // ft to m
    const range = currentState.range * 0.3048;
    
    // Update rocket position
    rocketRef.current.position.set(range, altitude, 0);
    
    // Rocket orientation based on velocity vector
    if (currentState.velocityX !== 0 || currentState.velocityY !== 0) {
      const angle = Math.atan2(currentState.velocityX, currentState.velocityY);
      rocketRef.current.rotation.z = -angle;
    }

    // ============================================================================
    // ENGINE FLAME - Only during thrust phase
    // ============================================================================
    if (flameRef.current) {
      const isThrusting = currentState.thrust > 0.5; // Threshold for visible thrust
      flameRef.current.visible = isThrusting;
      
      if (isThrusting) {
        // Animate flame intensity and size based on thrust
        const thrustScale = currentState.thrust / 60; // Normalize to ~60N max
        flameRef.current.scale.set(1, thrustScale * 2 + 0.5, 1);
        
        // Flicker effect
        const flicker = 0.9 + Math.random() * 0.2;
        flameRef.current.scale.multiplyScalar(flicker);
      }
    }

    // ============================================================================
    // PARACHUTE DEPLOYMENT
    // ============================================================================
    if (parachuteRef.current) {
      const isDescending = currentState.velocityY < -1.0;
      const pastApogee = playbackTime > (simulationData.find(d => d.altitude === Math.max(...simulationData.map(p => p.altitude)))?.time || 999);
      const parachuteDeployed = isDescending && pastApogee;
      
      parachuteRef.current.visible = parachuteDeployed;
      
      if (parachuteDeployed) {
        // Position above rocket
        parachuteRef.current.position.copy(rocketRef.current.position);
        parachuteRef.current.position.y += 1.5;
        
        // Animate parachute swaying
        const swayX = Math.sin(state.clock.elapsedTime * 2) * 0.2;
        const swayZ = Math.cos(state.clock.elapsedTime * 1.5) * 0.15;
        parachuteRef.current.position.x += swayX;
        parachuteRef.current.position.z += swayZ;
        
        // Parachute rotation
        parachuteRef.current.rotation.y = state.clock.elapsedTime * 0.5;
      }
    }

    // ============================================================================
    // SMOOTH CAMERA TRACKING
    // ============================================================================
    if (cameraFollow && !controlsRef?.current?.enabled) {
      const targetPos = new THREE.Vector3(
        range + cameraOffset.x,
        altitude + cameraOffset.y,
        cameraOffset.z
      );
      
      // Smooth lerp
      camera.position.lerp(targetPos, 0.05);
      camera.lookAt(range, altitude, 0);
    }
  });

  // ============================================================================
  // GENERATE ROCKET GEOMETRY FROM CONFIG
  // ============================================================================
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
                metalness={0.6}
                roughness={0.3}
                envMapIntensity={1.0}
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
                metalness={0.4}
                roughness={0.5}
                envMapIntensity={0.8}
              />
            </mesh>
          );
          break;
        }
        
        case 'TRANSITION': {
          const L = comp.length || 0.1;
          const R1 = (comp.foreDiameter || 0.05) / 2;
          const R2 = (comp.aftDiameter || 0.06) / 2;
          const centerY = currentTopY - L / 2;
          
          elements.push(
            <mesh key={key} position={[0, centerY, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[R1, R2, L, 32]} />
              <meshStandardMaterial 
                color={comp.color || '#cccccc'} 
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
          
          // Create fin shape
          const shape = new THREE.Shape();
          shape.moveTo(0, 0);
          shape.lineTo(span, -sweep);
          shape.lineTo(span, -sweep - tipChord);
          shape.lineTo(0, -rootChord);
          shape.closePath();
          
          const extrudeSettings = { 
            depth: thickness, 
            bevelEnabled: true,
            bevelThickness: 0.0005,
            bevelSize: 0.0005
          };
          
          const parentRadius = (comp.parent?.diameter || 0.06) / 2;
          
          for (let i = 0; i < finCount; i++) {
            const angle = (i / finCount) * Math.PI * 2;
            
            elements.push(
              <group key={`${key}-fin-${i}`} rotation={[0, angle, 0]} position={[0, currentTopY - rootChord / 2, 0]}>
                <mesh 
                  position={[parentRadius, 0, -thickness / 2]} 
                  castShadow 
                  receiveShadow
                >
                  <extrudeGeometry args={[shape, extrudeSettings]} />
                  <meshStandardMaterial 
                    color={comp.color || '#333333'} 
                    metalness={0.3}
                    roughness={0.7}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </group>
            );
          }
          break;
        }
      }

      // Recursively render subcomponents
      if (comp.subComponents) {
        comp.subComponents.forEach((sub, idx) => {
          renderComponent(sub, currentTopY, `${key}-${idx}`);
        });
      }
    };

    // Start rendering from stages
    let topY = 0;
    config.stages.forEach((stage, stageIdx) => {
      renderComponent(stage, topY, `stage-${stageIdx}`);
      topY -= (stage.length || 0);
    });

    return elements;
  }, [config]);

  // ============================================================================
  // PARTICLE SYSTEMS FOR SMOKE TRAIL
  // ============================================================================
  const smokeParticles = useMemo(() => {
    const particleCount = 1000;
    const positions = new Float32Array(particleCount * 3);
    const alphas = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 1] = -Math.random() * 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      alphas[i] = Math.random();
    }
    
    return { positions, alphas };
  }, []);

  return (
    <>
      {/* ========== ROCKET GROUP ========== */}
      <group ref={rocketRef}>
        {rocketGeometry}
        
        {/* ========== ENGINE FLAME ========== */}
        <group ref={flameRef} position={[0, -0.5, 0]} visible={false}>
          {/* Inner core - bright white */}
          <mesh position={[0, -0.15, 0]}>
            <coneGeometry args={[0.02, 0.15, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
          
          {/* Middle flame - orange */}
          <mesh position={[0, -0.3, 0]}>
            <coneGeometry args={[0.035, 0.3, 12]} />
            <meshBasicMaterial color="#ff6600" transparent opacity={0.7} />
          </mesh>
          
          {/* Outer flame - red */}
          <mesh position={[0, -0.45, 0]}>
            <coneGeometry args={[0.05, 0.5, 16]} />
            <meshBasicMaterial color="#ff3300" transparent opacity={0.5} />
          </mesh>
        </group>
        
        {/* ========== EXHAUST SMOKE (during thrust) ========== */}
        <points ref={smokeParticlesRef} position={[0, -0.6, 0]}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={smokeParticles.positions.length / 3}
              array={smokeParticles.positions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial 
            size={0.05} 
            color="#888888" 
            transparent 
            opacity={0.3}
            sizeAttenuation
            depthWrite={false}
          />
        </points>
      </group>

      {/* ========== PARACHUTE ========== */}
      <group ref={parachuteRef} visible={false}>
        {/* Canopy - Hemisphere */}
        <mesh position={[0, 0, 0]} castShadow>
          <sphereGeometry args={[0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial 
            color="#ff6b35"
            side={THREE.DoubleSide}
            roughness={0.8}
            metalness={0.1}
            transparent
            opacity={0.9}
          />
        </mesh>
        
        {/* Parachute lines */}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const x = Math.cos(angle) * 0.25;
          const z = Math.sin(angle) * 0.25;
          
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
              <lineBasicMaterial color="#333333" linewidth={2} />
            </line>
          );
        })}
        
        {/* Connection ring */}
        <mesh position={[0, -1.5, 0]}>
          <torusGeometry args={[0.02, 0.005, 8, 16]} />
          <meshStandardMaterial color="#111111" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* ========== GROUND PLANE ========== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[1000, 1000]} />
        <meshStandardMaterial 
          color="#5a8f5a" 
          roughness={0.8}
          metalness={0.0}
        />
      </mesh>

      {/* ========== GRID HELPER ========== */}
      <gridHelper args={[1000, 100, '#666666', '#444444']} position={[0, 0.01, 0]} />

      {/* ========== ENHANCED LIGHTING ========== */}
      <ambientLight intensity={0.4} />
      <directionalLight 
        position={[10, 20, 10]} 
        intensity={1.0} 
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <hemisphereLight args={['#87CEEB', '#5a8f5a', 0.5]} />
    </>
  );
};

export default Rocket3D;
