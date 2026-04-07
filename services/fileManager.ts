import { RocketConfig } from '../types';

// Save rocket design to JSON file
export const saveRocketDesign = (rocket: RocketConfig, filename: string = 'rocket-design.json') => {
  const data = JSON.stringify(rocket, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Load rocket design from file
export const loadRocketDesign = (): Promise<RocketConfig> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.ork';
    
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const rocket = JSON.parse(content) as RocketConfig;
          resolve(rocket);
        } catch (error) {
          reject(new Error('Invalid file format'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    
    input.click();
  });
};

// Export to OpenRocket-compatible format (.ork)
// Note: This is a simplified format, full .ork compatibility would require XML generation
export const exportToORK = (rocket: RocketConfig, filename: string = 'rocket-design.ork') => {
  // For now, we'll use JSON format with .ork extension
  // In a full implementation, this would generate proper ORK XML
  const data = JSON.stringify({
    format: 'OpenRocket-compatible',
    version: '1.0',
    rocket: rocket
  }, null, 2);
  
  const blob = new Blob([data], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Save to browser localStorage
export const saveToLocalStorage = (rocket: RocketConfig, name: string = 'auto-save') => {
  try {
    const key = `rocket_design_${name}`;
    localStorage.setItem(key, JSON.stringify(rocket));
    localStorage.setItem('last_saved_rocket', key);
    return true;
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
    return false;
  }
};

// Load from browser localStorage
export const loadFromLocalStorage = (name: string = 'auto-save'): RocketConfig | null => {
  try {
    const key = `rocket_design_${name}`;
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data) as RocketConfig;
    }
    return null;
  } catch (error) {
    console.error('Failed to load from localStorage:', error);
    return null;
  }
};

// Get all saved designs from localStorage
export const getAllSavedDesigns = (): { name: string; timestamp: number; rocket: RocketConfig }[] => {
  const designs: { name: string; timestamp: number; rocket: RocketConfig }[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('rocket_design_')) {
      try {
        const data = localStorage.getItem(key);
        if (data) {
          const rocket = JSON.parse(data) as RocketConfig;
          const name = key.replace('rocket_design_', '');
          designs.push({
            name,
            timestamp: Date.now(), // In real implementation, store this separately
            rocket
          });
        }
      } catch (error) {
        console.error(`Failed to parse design ${key}:`, error);
      }
    }
  }
  
  return designs;
};

// Delete saved design from localStorage
export const deleteSavedDesign = (name: string): boolean => {
  try {
    const key = `rocket_design_${name}`;
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error('Failed to delete design:', error);
    return false;
  }
};

// Auto-save functionality (call this periodically)
export const autoSave = (rocket: RocketConfig) => {
  saveToLocalStorage(rocket, 'auto-save');
};

