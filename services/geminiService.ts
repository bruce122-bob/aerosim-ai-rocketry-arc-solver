import { AnalysisResult, RocketConfig, Environment, RocketComponent } from "../types";
import { calculateDryMass, calculateReferenceArea } from "./rocketUtils";

// Helper: Recursively generate component summary string
const getComponentSummary = (components: RocketComponent[], indent = 0): string => {
  return components.map(c => {
    const prefix = ' '.repeat(indent);
    let line = `${prefix}- ${c.type}: ${c.name} (Mass: ${c.mass}kg)`;
    if (c.subComponents && c.subComponents.length > 0) {
      line += '\n' + getComponentSummary(c.subComponents, indent + 2);
    }
    return line;
  }).join('\n');
};

export const analyzeFlightData = async (
  csvContent: string, 
  currentConfig: RocketConfig,
  env: Environment
): Promise<AnalysisResult> => {
  try {
    // Get API Key (Vite environment variable)
    const apiKey = (import.meta.env?.VITE_GEMINI_API_KEY as string) || 
                   (import.meta.env?.GEMINI_API_KEY as string) || 
                   '';

    if (!apiKey) {
      console.warn("API Key not found. Please set VITE_GEMINI_API_KEY in .env.local for AI analysis features.");
      // Return mock result instead of throwing
      return {
        estimatedCd: currentConfig.cdOverride,
        confidence: "N/A",
        recommendations: [
          "AI Analysis requires VITE_GEMINI_API_KEY to be set in .env.local",
          "The current simulation uses Cd = " + currentConfig.cdOverride.toFixed(3),
          "Manually adjust Cd in the design panel to fine-tune results"
        ]
      };
    }

    // Dynamic import to avoid breaking the app if package is missing
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash"
    });
    
    // Calculate derived physics properties for context
    const calculatedMass = calculateDryMass(currentConfig.stages);
    const calculatedArea = calculateReferenceArea(currentConfig.stages);

    const componentSummary = getComponentSummary(currentConfig.stages);

    const prompt = `
      You are an expert rocketry physicist for an ARC (American Rocketry Challenge) team.
      The user designed a rocket in the "OpenRocket-lite" editor but the simulation is off.
      
      Rocket Design (Tree Structure):
      ${componentSummary}
      
      Physics Parameters:
      - Total Dry Mass (Sum of parts): ${calculatedMass.toFixed(3)} kg
      - Motor: ${currentConfig.motor.name} (Impulse: ${currentConfig.motor.totalImpulse} Ns)
      - Current Global Cd: ${currentConfig.cdOverride}
      - Reference Area (Max Cross-section): ${calculatedArea.toFixed(4)} m^2
      - Air Density: ${env.airDensity} kg/m^3

      Attached is a sample of the CSV Altimeter Data (Time, Altitude).
      
      Task:
      1. Analyze the flight profile.
      2. Calculate an estimated 'True Drag Coefficient' (Cd) that fits the data.
      3. Provide 3 construction or design recommendations.

      Return ONLY valid JSON with this structure:
      {
        "estimatedCd": <number>,
        "confidence": "High" | "Medium" | "Low",
        "recommendations": ["string1", "string2", "string3"]
      }
    `;

    const lines = csvContent.split('\n');
    const header = lines[0];
    const samples = lines.slice(1).filter((_, i) => i % 5 === 0).slice(0, 50).join('\n');
    const dataContext = `CSV HEADERS: ${header}\nDATA SAMPLES:\n${samples}`;

    const result = await model.generateContent([prompt, dataContext]);
    const responseText = result.response.text();

    if (responseText) {
      return JSON.parse(responseText) as AnalysisResult;
    } else {
      throw new Error("Empty response from AI");
    }

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    return {
      estimatedCd: currentConfig.cdOverride,
      confidence: "Error",
      recommendations: [
        "AI Analysis encountered an error. Using current Cd value.",
        "Check console for details or verify API key configuration.",
        "Manual adjustment is still available in the design panel."
      ]
    };
  }
};
