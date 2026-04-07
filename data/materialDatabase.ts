// Material database for rocket components
export interface Material {
  name: string;
  density: number; // kg/m³
  category: 'bulk' | 'surface' | 'line';
  description: string;
  typical_use: string;
}

export const MATERIAL_DATABASE: Material[] = [
  // Bulk Materials (for body tubes, nose cones, transitions)
  {
    name: 'Cardboard',
    density: 680,
    category: 'bulk',
    description: 'Standard kraft paper tube',
    typical_use: 'Body tubes, transitions'
  },
  {
    name: 'Cardboard (heavy)',
    density: 900,
    category: 'bulk',
    description: 'Thick wall paper tube',
    typical_use: 'Motor mounts, couplers'
  },
  {
    name: 'Plastic (polystyrene)',
    density: 1050,
    category: 'bulk',
    description: 'Lightweight rigid plastic',
    typical_use: 'Nose cones, fins'
  },
  {
    name: 'Plastic (polycarbonate)',
    density: 1200,
    category: 'bulk',
    description: 'Strong transparent plastic',
    typical_use: 'Nose cones, payload bays'
  },
  {
    name: 'Plastic (PVC)',
    density: 1380,
    category: 'bulk',
    description: 'Rigid durable plastic',
    typical_use: 'Body tubes, couplers'
  },
  {
    name: 'ABS Plastic',
    density: 1040,
    category: 'bulk',
    description: 'Strong thermoplastic',
    typical_use: '3D printed parts'
  },
  {
    name: 'PLA Plastic',
    density: 1250,
    category: 'bulk',
    description: 'Biodegradable thermoplastic',
    typical_use: '3D printed parts'
  },
  {
    name: 'PETG Plastic',
    density: 1270,
    category: 'bulk',
    description: 'Strong flexible plastic',
    typical_use: '3D printed parts'
  },
  {
    name: 'Balsa',
    density: 170,
    category: 'bulk',
    description: 'Very lightweight wood',
    typical_use: 'Fins, nose cones'
  },
  {
    name: 'Birch',
    density: 670,
    category: 'bulk',
    description: 'Medium density hardwood',
    typical_use: 'Fins, centering rings'
  },
  {
    name: 'Plywood',
    density: 550,
    category: 'bulk',
    description: 'Layered wood composite',
    typical_use: 'Fins, centering rings'
  },
  {
    name: 'Basswood',
    density: 420,
    category: 'bulk',
    description: 'Light hardwood',
    typical_use: 'Fins, internal structures'
  },
  {
    name: 'Fiberglass',
    density: 1850,
    category: 'bulk',
    description: 'Glass fiber reinforced plastic',
    typical_use: 'High-power body tubes, nose cones'
  },
  {
    name: 'Carbon fiber',
    density: 1600,
    category: 'bulk',
    description: 'Ultra-strong lightweight composite',
    typical_use: 'High-performance rockets'
  },
  {
    name: 'G10 Fiberglass',
    density: 1800,
    category: 'bulk',
    description: 'Epoxy glass laminate',
    typical_use: 'Fins, centering rings'
  },
  {
    name: 'Phenolic',
    density: 1400,
    category: 'bulk',
    description: 'Resin impregnated paper',
    typical_use: 'Motor mount tubes'
  },
  {
    name: 'Blue tube',
    density: 1100,
    category: 'bulk',
    description: 'Phenolic tubing',
    typical_use: 'Body tubes, motor mounts'
  },
  {
    name: 'Aluminum',
    density: 2700,
    category: 'bulk',
    description: 'Lightweight metal',
    typical_use: 'Nose cones, airframes'
  },
  {
    name: 'Brass',
    density: 8500,
    category: 'bulk',
    description: 'Heavy metal alloy',
    typical_use: 'Nose weight, ballast'
  },
  {
    name: 'Steel',
    density: 7850,
    category: 'bulk',
    description: 'Strong heavy metal',
    typical_use: 'Nose weight, ballast'
  },
  {
    name: 'Titanium',
    density: 4500,
    category: 'bulk',
    description: 'Strong lightweight metal',
    typical_use: 'High-performance components'
  },
  {
    name: 'Acrylic',
    density: 1180,
    category: 'bulk',
    description: 'Clear rigid plastic',
    typical_use: 'Windows, nose cones'
  },
  {
    name: 'Depron foam',
    density: 40,
    category: 'bulk',
    description: 'Ultra-lightweight foam',
    typical_use: 'Indoor models'
  },
  {
    name: 'Styrofoam',
    density: 60,
    category: 'bulk',
    description: 'Lightweight foam',
    typical_use: 'Nose cones, bulkheads'
  },
  {
    name: 'Foam (PU)',
    density: 30,
    category: 'bulk',
    description: 'Polyurethane foam',
    typical_use: 'Filler, insulation'
  },
  {
    name: 'Quantum tubing',
    density: 1060,
    category: 'bulk',
    description: 'High-strength spiral wound tube',
    typical_use: 'Body tubes'
  },

  // Surface Materials (for coatings, finish)
  {
    name: 'Smooth finish',
    density: 1400,
    category: 'surface',
    description: 'Polished surface',
    typical_use: 'Final finish coat'
  },
  {
    name: 'Regular paint',
    density: 1200,
    category: 'surface',
    description: 'Standard paint finish',
    typical_use: 'Decoration'
  },
  {
    name: 'Rough paint',
    density: 1300,
    category: 'surface',
    description: 'Textured paint finish',
    typical_use: 'Quick finish'
  },
  {
    name: 'Unfinished',
    density: 0,
    category: 'surface',
    description: 'No surface treatment',
    typical_use: 'Test flights'
  },

  // Line Materials (for shock cords, strings)
  {
    name: 'Elastic cord (round)',
    density: 1200,
    category: 'line',
    description: 'Stretchy round cord',
    typical_use: 'Shock cords'
  },
  {
    name: 'Elastic cord (flat)',
    density: 1100,
    category: 'line',
    description: 'Flat elastic band',
    typical_use: 'Shock cords'
  },
  {
    name: 'Nylon braided',
    density: 1140,
    category: 'line',
    description: 'Strong braided cord',
    typical_use: 'Parachute lines, harnesses'
  },
  {
    name: 'Kevlar thread',
    density: 1440,
    category: 'line',
    description: 'Heat-resistant aramid fiber',
    typical_use: 'Motor ejection shock cords'
  },
  {
    name: 'Cotton thread',
    density: 1500,
    category: 'line',
    description: 'Natural fiber thread',
    typical_use: 'Small shock cords'
  },
  {
    name: 'Braided steel cable',
    density: 7800,
    category: 'line',
    description: 'Very strong metal cable',
    typical_use: 'Heavy duty harnesses'
  },
  {
    name: 'Tubular nylon',
    density: 950,
    category: 'line',
    description: 'Hollow braided nylon',
    typical_use: 'Parachute harnesses'
  }
];

// Material categories
export const MATERIAL_CATEGORIES = ['All', 'Bulk', 'Surface', 'Line'] as const;

// Filter materials by category
export const filterMaterialsByCategory = (category: string): Material[] => {
  if (category === 'All') {
    return MATERIAL_DATABASE;
  }
  return MATERIAL_DATABASE.filter(m => m.category === category.toLowerCase());
};

// Search materials
export const searchMaterials = (query: string): Material[] => {
  const lowerQuery = query.toLowerCase();
  return MATERIAL_DATABASE.filter(
    m => 
      m.name.toLowerCase().includes(lowerQuery) ||
      m.description.toLowerCase().includes(lowerQuery) ||
      m.typical_use.toLowerCase().includes(lowerQuery)
  );
};

// Get material by name
export const getMaterialByName = (name: string): Material | undefined => {
  return MATERIAL_DATABASE.find(m => m.name === name);
};

// Get default material for component type
export const getDefaultMaterial = (componentType: string): string => {
  const defaults: Record<string, string> = {
    NOSECONE: 'Plastic (polystyrene)',
    BODYTUBE: 'Cardboard',
    TRANSITION: 'Cardboard',
    FINS: 'Plywood',
    INNER_TUBE: 'Cardboard',
    CENTERING_RING: 'Plywood',
    PARACHUTE: 'Nylon braided',
    SHOCK_CORD: 'Elastic cord (round)',
    ENGINE_BLOCK: 'Plywood',
    LAUNCH_LUG: 'Plastic (PVC)',
    MASS_COMPONENT: 'Brass'
  };
  return defaults[componentType] || 'Cardboard';
};

// Calculate mass from material, volume or area
export const calculateMassFromMaterial = (
  materialName: string,
  volume: number
): number => {
  const material = getMaterialByName(materialName);
  if (!material) {
    console.warn(`Material "${materialName}" not found, using default density`);
    return volume * 680; // Default to cardboard density
  }
  return volume * material.density;
};

