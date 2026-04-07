// Post-processing effects component
// Implements motion blur, depth of field, color grading and other cinematic effects

import React, { useMemo } from 'react';
import { EffectComposer, Bloom, DepthOfField, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

interface PostProcessingProps {
  enabled?: boolean;
  bloomIntensity?: number;
  depthOfFieldEnabled?: boolean;
  vignetteEnabled?: boolean;
}

const PostProcessingEffects: React.FC<PostProcessingProps> = ({
  enabled = true,
  bloomIntensity = 0.5,
  depthOfFieldEnabled = false,
  vignetteEnabled = true
}) => {
  
  if (!enabled) return null;
  
  return (
    <EffectComposer multisampling={4}>
      {/* Bloom effect: glowing exhaust */}
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={0.6}
        luminanceSmoothing={0.9}
        blendFunction={BlendFunction.ADD}
      />
      
      {/* Depth of field effect (optional) */}
      {depthOfFieldEnabled && (
        <DepthOfField
          focusDistance={0.02}
          focalLength={0.05}
          bokehScale={3}
        />
      )}
      
      {/* Color grading: professional cinematic feel */}
      {vignetteEnabled && (
        <Vignette
          offset={0.3}
          darkness={0.5}
          blendFunction={BlendFunction.NORMAL}
        />
      )}
      
      {/* Chromatic aberration: high-speed motion feel */}
      <ChromaticAberration
        offset={new THREE.Vector2(0.001, 0.001)}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  );
};

export default PostProcessingEffects;

