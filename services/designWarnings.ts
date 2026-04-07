import { RocketComponent, Stage } from "../types";
import { calculateStability } from "./stability";

export interface DesignWarning {
  type: 'error' | 'warning' | 'info';
  message: string;
  componentId?: string;
  category: 'stability' | 'structure' | 'mass' | 'missing';
}

export const analyzeDesign = (stages: Stage[]): DesignWarning[] => {
  const warnings: DesignWarning[] = [];
  
  // 1. Calculate Stability
  // Note: designWarnings doesn't have access to rocket.simulationSettings,
  // so it will use max diameter as fallback
  const stability = calculateStability(stages);
  const margin = stability.stabilityMargin;
  
  // Stability warnings
  if (margin < 0) {
    warnings.push({
      type: 'error',
      message: `CRITICAL: Rocket is UNSTABLE! CP is ahead of CG (Margin: ${margin.toFixed(2)} cal). Add fins or move weight forward.`,
      category: 'stability'
    });
  } else if (margin < 1.0) {
    warnings.push({
      type: 'warning',
      message: `Low stability margin: ${margin.toFixed(2)} cal. Recommended: > 1.0 cal. Consider adding larger fins or moving CG forward.`,
      category: 'stability'
    });
  } else if (margin > 4.0) {
    warnings.push({
      type: 'warning',
      message: `Very high stability margin: ${margin.toFixed(2)} cal. Rocket may weathercock excessively in wind. Consider reducing fin size.`,
      category: 'stability'
    });
  }
  
  // 2. Check for fins
  let hasFinSystem = false;
  const checkFins = (comps: RocketComponent[]) => {
    comps.forEach(c => {
      if (c.type === 'FINS') hasFinSystem = true;
      if (c.subComponents) checkFins(c.subComponents);
    });
  };
  checkFins(stages);
  
  if (!hasFinSystem) {
    warnings.push({
      type: 'error',
      message: 'No fin system detected! Rocket will be unstable without fins.',
      category: 'missing'
    });
  }
  
  // 3. Check for recovery system
  let hasParachute = false;
  const checkRecovery = (comps: RocketComponent[]) => {
    comps.forEach(c => {
      if (c.type === 'PARACHUTE') hasParachute = true;
      if (c.subComponents) checkRecovery(c.subComponents);
    });
  };
  checkRecovery(stages);
  
  if (!hasParachute) {
    warnings.push({
      type: 'warning',
      message: 'No recovery system (parachute) detected. Rocket will not land safely.',
      category: 'missing'
    });
  }
  
  // 4. Mass check
  const totalMass = calculateTotalMass(stages);
  if (totalMass > 1.5) { // 1.5kg is quite heavy for model rockets
    warnings.push({
      type: 'warning',
      message: `Rocket is very heavy: ${(totalMass * 1000).toFixed(0)}g. May require a powerful motor. Typical range: 100-500g.`,
      category: 'mass'
    });
  } else if (totalMass < 0.05) { // Less than 50g
    warnings.push({
      type: 'warning',
      message: `Rocket is very light: ${(totalMass * 1000).toFixed(0)}g. May be unstable in wind. Consider adding nose weight.`,
      category: 'mass'
    });
  }
  
  // 5. Structural checks
  let hasNoseCone = false;
  let hasBodyTube = false;
  stages.forEach(stage => {
    stage.subComponents.forEach(c => {
      if (c.type === 'NOSECONE') hasNoseCone = true;
      if (c.type === 'BODYTUBE') hasBodyTube = true;
    });
  });
  
  if (!hasNoseCone) {
    warnings.push({
      type: 'error',
      message: 'No nose cone! Rocket needs a nose cone for aerodynamic stability.',
      category: 'structure'
    });
  }
  
  if (!hasBodyTube) {
    warnings.push({
      type: 'error',
      message: 'No body tube! Rocket structure is incomplete.',
      category: 'structure'
    });
  }
  
  // 6. Diameter consistency check
  const diameters: number[] = [];
  const checkDiameters = (comps: RocketComponent[]) => {
    comps.forEach(c => {
      if (c.type === 'BODYTUBE') diameters.push((c as any).diameter);
      if (c.type === 'NOSECONE') diameters.push((c as any).baseDiameter);
      if (c.subComponents) checkDiameters(c.subComponents);
    });
  };
  checkDiameters(stages);
  
  if (diameters.length > 1) {
    const maxD = Math.max(...diameters);
    const minD = Math.min(...diameters);
    if ((maxD - minD) / maxD > 0.2) { // More than 20% difference
      warnings.push({
        type: 'info',
        message: `Diameter varies significantly: ${(minD * 1000).toFixed(0)}mm to ${(maxD * 1000).toFixed(0)}mm. Ensure transitions are used for smooth airflow.`,
        category: 'structure'
      });
    }
  }
  
  return warnings;
};

const calculateTotalMass = (comps: RocketComponent[]): number => {
  return comps.reduce((sum, c) => {
    return sum + c.mass + calculateTotalMass(c.subComponents);
  }, 0);
};

