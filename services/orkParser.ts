// OpenRocket .ork File Parser
// .ork files are ZIP archives containing XML rocket design files

import { RocketConfig, RocketComponent, ComponentType, Stage, MotorData } from "../types";
import { MOTOR_DATABASE } from "../data/motorDatabase";
import { findMotorByDesignation } from "./motorMatcher";

// Import JSZip (bundled by Vite)
import JSZipLib from 'jszip';

// Get DOMParser (browser native, Node.js uses @xmldom/xmldom)
async function getDOMParser(): Promise<{ new(): DOMParser }> {
  if (typeof DOMParser !== 'undefined') {
    return DOMParser;
  }
  // Node.js: use @xmldom/xmldom
  const xmldom = await import('@xmldom/xmldom');
  return xmldom.DOMParser as any;
}

// ============= ZIP file extraction =============

// Extract XML content from ZIP file (using JSZip) - enhanced version
async function extractXMLFromZip(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // Load ZIP file (enhanced error handling)
    console.log('Decompressing ZIP file with JSZip...');
    let zip: any;
    try {
      zip = await JSZipLib.loadAsync(arrayBuffer);
    } catch (zipError) {
      throw new Error(`ZIP file corrupted or invalid format: ${zipError instanceof Error ? zipError.message : 'unknown error'}`);
    }

    const fileNames = Object.keys(zip.files);
    console.log(`ZIP file contains ${fileNames.length} files:`, fileNames);

    // Extended filename list (supports more OpenRocket versions)
    const possibleFiles = [
      'rocket.ork',
      'document.xml',
      'rocket.xml',
      'openrocket.xml',
      'design.xml',
      'data.xml'
    ];

    let xmlContent = '';
    let bestMatch: { fileName: string, size: number, score: number } | null = null;

    // First try known filenames (by priority)
    for (const fileName of possibleFiles) {
      const file = zip.files[fileName];
      if (file && !file.dir) {
        try {
          console.log(`Attempting to read known file: ${fileName}`);
          const content = await file.async('text');
          const hasRocketTag = content.includes('<rocket') || content.includes('<openrocket');
          const size = content.length;

          if (hasRocketTag) {
            // Calculate match score (larger files more likely to be main file)
            const score = size + (fileName.includes('rocket') ? 1000 : 0);
            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { fileName, size, score };
              xmlContent = content;
            }
          }
        } catch (readError) {
          console.warn(`Failed to read file ${fileName}:`, readError);
        }
      }
    }

    // If best match found, return directly
    if (bestMatch && xmlContent) {
      console.log(`✅ Found best match: ${bestMatch.fileName} (${bestMatch.size} chars)`);
      return xmlContent;
    }

    // If not found, iterate all files for XML (sorted by size, prefer larger)
    const xmlFiles: Array<{ name: string, size: number }> = [];
    for (const fileName in zip.files) {
      const file = zip.files[fileName];
      if (!file.dir && (fileName.endsWith('.ork') || fileName.endsWith('.xml'))) {
        xmlFiles.push({ name: fileName, size: file._data?.uncompressedSize || 0 });
      }
    }

    // Sort by size (larger files first)
    xmlFiles.sort((a, b) => b.size - a.size);

    for (const { name: fileName } of xmlFiles) {
      try {
        console.log(`Attempting to read XML file: ${fileName}`);
        const content = await zip.files[fileName].async('text');
        if (content.includes('<rocket') || content.includes('<openrocket')) {
          console.log(`✅ Found valid XML: ${fileName} (${content.length} chars)`);
          return content;
        }
      } catch (readError) {
        console.warn(`Failed to read file ${fileName}:`, readError);
      }
    }

    // Last attempt: read all non-directory files, find XML content
    for (const fileName in zip.files) {
      const file = zip.files[fileName];
      if (!file.dir && !xmlFiles.find(f => f.name === fileName)) {
        try {
          const content = await file.async('text');
          if (content.trim().startsWith('<?xml') || content.includes('<rocket') || content.includes('<openrocket')) {
            console.log(`✅ Found content in non-XML file: ${fileName}`);
            return content;
          }
        } catch (readError) {
          // Ignore binary files
        }
      }
    }

    // If still not found, provide detailed error
    const fileList = fileNames.length > 0 ? fileNames.join(', ') : 'no files';
    throw new Error(`No valid XML content found in ZIP file. File list: ${fileList}`);
  } catch (error) {
    console.error('ZIP extraction error:', error);
    if (error instanceof Error && error.message.includes('No valid XML')) {
      throw error; // Re-throw detailed error
    }
    throw new Error(`Unable to decompress .ork file: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

// ============= ORK file parsing =============

export interface ORKParseResult {
  success: boolean;
  rocket?: RocketConfig;
  error?: string;
  warnings?: string[];
  parseStats?: {
    totalComponents: number;
    totalStages: number;
    hasMotor: boolean;
    hasParachute: boolean;
    hasCG: boolean;
    hasCP: boolean;
    hasReferenceLength: boolean;
    validationErrors: number;
    validationWarnings: number;
  };
}

/**
 * ============= FlightData class (strictly aligned with OpenRocket flightdata structure) =============
 * Reliable implementation based on Python code, ensures 1:1 match with OpenRocket output
 *
 * Core principles:
 * 1. Strictly parse types string, build column name to index mapping
 * 2. Validate each row's column count must match types
 * 3. Don't assume units, don't hardcode column order
 * 4. Don't filter data, preserve original column index correspondence
 */
class FlightData {
  private types: string[] = [];
  private rows: number[][] = [];
  private index: Map<string, number> = new Map(); // column name to index mapping
  private columnCache: Map<string, number[]> = new Map();
  private isValid: boolean = false;

  constructor(xmlRoot: Element) {
    try {
      // Find flightdata element
      const flightdata = xmlRoot.querySelector("flightdata");
      if (!flightdata) {
        console.warn("FlightData: <flightdata> element not found");
        return;
      }

      // Find databranch element
      const databranch = flightdata.querySelector("databranch");
      if (!databranch) {
        console.warn("FlightData: <databranch> element not found");
        return;
      }

      // Parse types attribute for column names (strictly following Python code)
      const typesAttr = databranch.getAttribute("types");
      if (!typesAttr) {
        console.warn("FlightData: databranch missing types attribute");
        return;
      }

      // Parse types: split by comma and trim spaces
      this.types = typesAttr.split(",").map(t => t.trim());

      // Build column name to index mapping (critical: ensure column index correct)
      this.index = new Map();
      this.types.forEach((name, i) => {
        this.index.set(name, i);
      });

      console.log(`FlightData: Found ${this.types.length} columns`);
      console.log(`FlightData: Column names:`, this.types.slice(0, 10).join(", "), this.types.length > 10 ? "..." : "");

      // Parse all datapoint rows (strictly validate column count consistency)
      const datapoints = databranch.querySelectorAll("datapoint");
      const expectedColumnCount = this.types.length;

      this.rows = [];
      let validRowCount = 0;
      let invalidRowCount = 0;

      for (const dp of Array.from(datapoints)) {
        if (!dp.textContent) {
          invalidRowCount++;
          continue;
        }

        // Parse row data: split by comma and convert to float
        const rowText = dp.textContent.trim();
        const rowValues = rowText.split(",").map(v => {
          const trimmed = v.trim();
          const parsed = parseFloat(trimmed);
          // If cannot parse, return NaN (don't skip, preserve column index correspondence)
          return isNaN(parsed) ? NaN : parsed;
        });

        // Strict validation: column count must match types
        if (rowValues.length !== expectedColumnCount) {
          console.warn(`FlightData: Row column count mismatch (expected ${expectedColumnCount}, got ${rowValues.length}), skipping row`);
          console.warn(`  Row content: ${rowText.substring(0, 100)}...`);
          invalidRowCount++;
          continue;
        }

        this.rows.push(rowValues);
        validRowCount++;
      }

      console.log(`FlightData: Parsed ${validRowCount} valid rows, skipped ${invalidRowCount} invalid rows`);

      if (this.rows.length === 0) {
        console.warn("FlightData: No valid data rows");
        return;
      }

      // Validate first and last row data integrity
      if (this.rows.length > 0) {
        const firstRow = this.rows[0];
        const lastRow = this.rows[this.rows.length - 1];
        const firstRowValid = firstRow.every((v, i) => !isNaN(v) || i >= firstRow.length);
        const lastRowValid = lastRow.every((v, i) => !isNaN(v) || i >= lastRow.length);

        if (!firstRowValid) {
          console.warn("FlightData: First row contains NaN, may affect results");
        }
        if (!lastRowValid) {
          console.warn("FlightData: Last row contains NaN, may affect results");
        }
      }

      this.isValid = true;
    } catch (error) {
      console.error("FlightData constructor error:", error);
      this.isValid = false;
    }
  }

  /**
   * Get all values for specified column name
   * Extract strictly by column index, no filtering (preserve row correspondence)
   */
  column(name: string): number[] {
    // Check if column exists
    if (!this.index.has(name)) {
      console.warn(`FlightData: Column "${name}" not found`);
      console.warn(`FlightData: Available columns:`, Array.from(this.index.keys()).slice(0, 20).join(", "), "...");
      return [];
    }

    // Use cache for performance
    if (this.columnCache.has(name)) {
      return this.columnCache.get(name)!;
    }

    // Extract values by column index (strict correspondence, no filtering)
    const idx = this.index.get(name)!;
    const values = this.rows.map(row => row[idx]);

    // Check for NaN values
    const nanCount = values.filter(v => isNaN(v)).length;
    if (nanCount > 0) {
      console.warn(`FlightData: Column "${name}" contains ${nanCount} NaN values`);
    }

    this.columnCache.set(name, values);
    return values;
  }

  /**
   * Get value at specified time point (find closest time point)
   * Improvement: if closest point is NaN, find first non-NaN value (consistent with Python code logic)
   */
  valueAtTime(name: string, targetTime: number = 0): number | null {
    const times = this.column("Time");
    const values = this.column(name);

    if (times.length === 0 || values.length === 0) {
      return null;
    }

    if (times.length !== values.length) {
      console.error(`FlightData: Time column (${times.length} values) and ${name} column (${values.length} values) length mismatch`);
      return null;
    }

    // Find point closest to target time (consistent with Python code logic)
    let closestIndex = 0;
    let minDiff = Math.abs(times[0] - targetTime);

    for (let i = 1; i < times.length; i++) {
      const diff = Math.abs(times[i] - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    let result = values[closestIndex];

    // If closest point is NaN, find first non-NaN value (important fix)
    if (isNaN(result)) {
      console.warn(`FlightData: valueAtTime("${name}", ${targetTime}) closest point (${closestIndex}) is NaN, searching for first valid value...`);

      // From closest point, search forward and backward for first non-NaN value
      let foundIndex = -1;
      let foundDiff = Infinity;

      // Search backward first (closer to target time)
      for (let i = closestIndex + 1; i < values.length; i++) {
        if (!isNaN(values[i]) && isFinite(values[i])) {
          const diff = Math.abs(times[i] - targetTime);
          if (diff < foundDiff) {
            foundDiff = diff;
            foundIndex = i;
          }
        }
      }

      // Then search forward
      for (let i = closestIndex - 1; i >= 0; i--) {
        if (!isNaN(values[i]) && isFinite(values[i])) {
          const diff = Math.abs(times[i] - targetTime);
          if (diff < foundDiff) {
            foundDiff = diff;
            foundIndex = i;
          }
        }
      }

      if (foundIndex >= 0) {
        result = values[foundIndex];
        console.log(`FlightData: Found valid value at index ${foundIndex} (t=${times[foundIndex].toFixed(3)}s)`);
      } else {
        console.warn(`FlightData: All values in column "${name}" are NaN`);
        return null;
      }
    }

    // Final result validation
    if (isNaN(result) || !isFinite(result)) {
      console.warn(`FlightData: valueAtTime("${name}", ${targetTime}) final result invalid`);
      return null;
    }

    return result;
  }

  /**
   * Check if specified column exists
   */
  hasColumn(name: string): boolean {
    return this.index.has(name);
  }

  /**
   * Get all available column names
   */
  getAvailableColumns(): string[] {
    return [...this.types];
  }

  /**
   * Get data row count
   */
  getRowCount(): number {
    return this.rows.length;
  }

  /**
   * Check if FlightData is valid
   */
  isValidData(): boolean {
    return this.isValid && this.rows.length > 0 && this.types.length > 0;
  }
}

/**
 * ============= Improved FlightData extraction function =============
 * Extract CG, CP and Mass from simulation (based on Python code method)
 */
/**
 * ============= Improved FlightData extraction (strictly aligned with OpenRocket) =============
 * Extract CG, CP and Mass from simulation
 * Ensure exact match with OpenRocket GUI displayed values (error < 1e-6)
 */
const extractFlightDataValues = (simulation: Element): {
  cg: number | null;
  cp: number | null;
  mass: number | null;
  source: string;
} | null => {
  try {
    const flightData = new FlightData(simulation);

    // Validate FlightData
    if (!flightData.isValidData()) {
      console.warn("FlightData: Data invalid or empty");
      return null;
    }

    // Display available columns (for debug and validation)
    const availableColumns = flightData.getAvailableColumns();
    console.log(`\n======= FlightData parsing =======`);
    console.log(`Available columns (${availableColumns.length}):`, availableColumns.join(", "));

    // Check if required columns exist
    const requiredColumns = ["Time", "CG location", "CP location", "Mass"];
    const missingColumns = requiredColumns.filter(col => !flightData.hasColumn(col));

    if (missingColumns.length > 0) {
      console.warn(`FlightData: Missing required columns:`, missingColumns.join(", "));
      console.warn(`FlightData: This may cause incomplete data extraction`);
    }

    // Extract value at t=0 (initial value, most accurate, matches OpenRocket GUI)
    // Improvement: if t=0 is NaN, find first non-NaN value (usually around t=0.01s, closest to initial)
    let cg = flightData.valueAtTime("CG location", 0);
    let cp = flightData.valueAtTime("CP location", 0);
    let mass = flightData.valueAtTime("Mass", 0);

    // If valueAtTime returns null (no valid value found), manually find first non-NaN
    if (cg === null) {
      console.warn("FlightData: CG at t=0 is NaN, searching for first valid value...");
      const times = flightData.column("Time");
      const cgValues = flightData.column("CG location");
      // Find first valid value within 0.1s (OpenRocket usually has value at t=0.01s)
      for (let i = 0; i < times.length && times[i] < 0.1; i++) {
        if (!isNaN(cgValues[i]) && isFinite(cgValues[i]) && cgValues[i] > 0) {
          cg = cgValues[i];
          console.log(`FlightData: Found valid CG at t=${times[i].toFixed(3)}s: ${cg.toFixed(6)}m (${(cg * 39.3701).toFixed(3)}in)`);
          break;
        }
      }
    }

    if (cp === null) {
      console.warn("FlightData: CP at t=0 is NaN, searching for first valid value...");
      const times = flightData.column("Time");
      const cpValues = flightData.column("CP location");
      // Find first valid value within 0.1s
      for (let i = 0; i < times.length && times[i] < 0.1; i++) {
        if (!isNaN(cpValues[i]) && isFinite(cpValues[i]) && cpValues[i] > 0) {
          cp = cpValues[i];
          console.log(`FlightData: Found valid CP at t=${times[i].toFixed(3)}s: ${cp.toFixed(6)}m (${(cp * 39.3701).toFixed(3)}in)`);
          break;
        }
      }
    }

    // Mass may need to distinguish dry mass and total mass (including motor)
    // OpenRocket Mass column is usually total mass (dry mass + motor mass)
    if (mass === null) {
      console.warn("FlightData: Mass at t=0 is NaN, attempting to find first valid value...");
      const times = flightData.column("Time");
      const massValues = flightData.column("Mass");
      for (let i = 0; i < times.length && times[i] < 0.1; i++) {
        if (!isNaN(massValues[i]) && isFinite(massValues[i]) && massValues[i] > 0) {
          mass = massValues[i];
          console.log(`FlightData: Found valid Mass at t=${times[i].toFixed(3)}s: ${(mass * 1000).toFixed(2)}g`);
          break;
        }
      }
    }

    // If Mass found, check for "Motor mass" column for dry mass calculation
    // OpenRocket Mass column = dry mass + Motor mass
    if (mass !== null && flightData.hasColumn("Motor mass")) {
      const motorMass = flightData.valueAtTime("Motor mass", 0);
      if (motorMass !== null && motorMass > 0) {
        const dryMass = mass - motorMass;
        console.log(`FlightData: Mass=${(mass * 1000).toFixed(2)}g, Motor mass=${(motorMass * 1000).toFixed(2)}g, dry mass=${(dryMass * 1000).toFixed(2)}g`);
        // Note: we keep total mass here, but can also provide dryMass for validation
        (flightData as any)._dryMass = dryMass;
      }
    }

    // Validate value validity (stricter validation)
    const hasValidCG = cg !== null && !isNaN(cg) && isFinite(cg) && cg > 0;
    const hasValidCP = cp !== null && !isNaN(cp) && isFinite(cp) && cp > 0;
    const hasValidMass = mass !== null && !isNaN(mass) && isFinite(mass) && mass > 0;

    if (!hasValidCG && !hasValidCP && !hasValidMass) {
      console.warn("FlightData: All extracted values invalid");
      return null;
    }

    const result = {
      cg: hasValidCG ? cg : null,
      cp: hasValidCP ? cp : null,
      mass: hasValidMass ? mass : null,
      source: "flightdata/databranch"
    };

    // Detailed debug output (compare with OpenRocket)
    console.log(`\n======= FlightData extraction result =======`);
    if (hasValidCG) {
      console.log(`✅ CG location (t=0): ${cg!.toFixed(6)} m (${(cg! * 39.3701).toFixed(3)} in)`);
    } else {
      console.warn(`❌ CG location: extraction failed or invalid`);
    }

    if (hasValidCP) {
      console.log(`✅ CP location (t=0): ${cp!.toFixed(6)} m (${(cp! * 39.3701).toFixed(3)} in)`);
    } else {
      console.warn(`❌ CP location: extraction failed or invalid`);
    }

    if (hasValidMass) {
      console.log(`✅ Mass (t=0): ${(mass! * 1000).toFixed(2)} g (${mass!.toFixed(6)} kg)`);
    } else {
      console.warn(`❌ Mass: extraction failed or invalid`);
    }

    // Validate data consistency: check first and last row
    if (flightData.getRowCount() > 1) {
      const firstMass = flightData.valueAtTime("Mass", 0);
      const lastTime = flightData.column("Time")[flightData.getRowCount() - 1];
      const lastMass = flightData.valueAtTime("Mass", lastTime);

      if (firstMass && lastMass) {
        const massChange = firstMass - lastMass;
        console.log(`Mass change (t=0 to t=${lastTime.toFixed(2)}s): ${(massChange * 1000).toFixed(2)} g`);
      }
    }

    return result;
  } catch (error) {
    console.error("Error extracting FlightData values:", error);
    return null;
  }
};

/**
 * Backward compatibility: keep original extractCGCPFromFlightData function
 * But internally use new FlightData class
 */
const extractCGCPFromFlightData = (simulation: Element): { cg: number; cp: number } | null => {
  const result = extractFlightDataValues(simulation);
  if (result && result.cg !== null && result.cp !== null) {
    return { cg: result.cg, cp: result.cp };
  }
  return null;
};

// Parse .ork file (ZIP format or pure XML format)
export const parseLegacyORKFile = async (file: File): Promise<ORKParseResult> => {
  try {
    console.log('Parsing .ork file:', file.name);

    // Read file content as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Check file format (ZIP files start with PK)
    const isZip = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B; // PK

    console.log('File size:', arrayBuffer.byteLength, 'bytes');
    console.log('File format:', isZip ? 'ZIP archive' : 'pure XML');

    let text: string;

    if (isZip) {
      // .ork file is ZIP format, needs decompression
      console.log('Detected ZIP format, extracting...');
      text = await extractXMLFromZip(arrayBuffer);
      console.log('Extracted XML size:', text.length, 'characters');
    } else {
      // Pure XML format (older OpenRocket versions)
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(uint8Array);
    }

    console.log('First 100 chars of file:', text.substring(0, 100));

    // Enhanced XML parsing (supports multiple formats and encodings)
    const DOMParserClass = await getDOMParser();
    const parser = new DOMParserClass();

    // Clean XML text (remove BOM, fix common encoding issues)
    let cleanedText = text.trim();
    // Remove BOM (Byte Order Mark)
    if (cleanedText.charCodeAt(0) === 0xFEFF) {
      cleanedText = cleanedText.slice(1);
    }
    // Ensure XML declaration exists
    if (!cleanedText.startsWith('<?xml')) {
      console.warn('XML file missing declaration, adding default');
      cleanedText = '<?xml version="1.0" encoding="UTF-8"?>\n' + cleanedText;
    }

    // Try multiple parsing methods
    let xmlDoc: Document | null = null;
    let parserError: Element | null = null;
    const mimeTypes: DOMParserSupportedType[] = ['application/xml', 'text/xml', 'application/xhtml+xml'];

    for (const mimeType of mimeTypes) {
      try {
        xmlDoc = parser.parseFromString(cleanedText, mimeType);
        parserError = xmlDoc.querySelector("parsererror");
        if (!parserError) {
          console.log(`✅ XML parsing success (${mimeType})`);
          break;
        }
      } catch (e) {
        console.warn(`XML parsing failed (${mimeType}):`, e);
      }
    }

    // If all methods fail
    if (!xmlDoc || parserError) {
      const errorMsg = parserError?.textContent || 'XML format error';
      console.error('XML parsing error:', errorMsg);

      // Try to extract more error info
      let detailedError = errorMsg.substring(0, 200);
      if (parserError) {
        const errorLine = parserError.getAttribute('line') || '';
        const errorCol = parserError.getAttribute('column') || '';
        if (errorLine) {
          detailedError += ` (line ${errorLine}${errorCol ? `, col ${errorCol}` : ''})`;
        }
      }

      return {
        success: false,
        error: `XML parsing failed. Please ensure this is a valid OpenRocket .ork file.\nError details: ${detailedError}\n\nSuggestions:\n1. Check if file is corrupted\n2. Try re-saving the file in OpenRocket\n3. Ensure using OpenRocket 1.0 or higher`
      };
    }

    console.log('XML parsing success');
    console.log('Root element:', xmlDoc.documentElement.tagName);

    // Find rocket definition (supports multiple possible structures)
    let rocket = xmlDoc.querySelector("rocket");

    // If not found directly, try under openrocket tag
    if (!rocket) {
      const openrocket = xmlDoc.querySelector("openrocket");
      if (openrocket) {
        rocket = openrocket.querySelector("rocket");
      }
    }

    // If still not found, check if root element is rocket
    if (!rocket && xmlDoc.documentElement.tagName.toLowerCase() === 'rocket') {
      rocket = xmlDoc.documentElement;
    }

    if (!rocket) {
      console.error('Rocket definition not found');
      console.log('Document structure:', xmlDoc.documentElement.outerHTML.substring(0, 500));
      return {
        success: false,
        error: "Rocket definition not found in file. Please ensure this is an OpenRocket-saved .ork file."
      };
    }

    console.log('Found rocket definition:', rocket.tagName);

    // Debug: output first 2000 chars of XML structure
    console.log('======= XML Structure Preview =======');
    console.log(xmlDoc.documentElement.outerHTML.substring(0, 2000));
    console.log('======= End Preview =======');

    const warnings: string[] = [];

    // Extract Rocket name
    const nameElement = rocket.querySelector("name");
    const rocketName = nameElement?.textContent || "Imported Rocket";

    // Create config object to collect Cd, stage override mass, and CG
    const configData: { cd?: number; overrideMass?: number; overrideCG?: number } = {};

    // Extract component tree (and Cd)
    const stages = parseStages(rocket, warnings, configData);

    // Extract Motor config (pass configData for stage overridecd)
    const motorConfig = parseMotorConfiguration(rocket, warnings, configData);

    // Extract simulation config (return empty object even without simulationconfiguration tag)
    const simSettings = parseSimulationConfig(xmlDoc.documentElement);

    // Improved CG/CP extraction logic - fully based on .ork file, no predictions
    console.log("Extracting CG/CP values (fully based on .ork file data)...");

    let foundCG = 0;
    let foundCP = 0;
    let cgSource = '';
    let cpSource = '';

    // First, globally search all CG/CP tags, record their positions and values (for debug)
    console.log("🔍 Searching all CG/CP tags...");
    const allCGElements: Array<{ element: Element, parent: string, value: number }> = [];
    const allCPElements: Array<{ element: Element, parent: string, value: number }> = [];
    const allElements = xmlDoc.getElementsByTagName("*");

    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      const tagName = el.tagName.toLowerCase();
      const parentTag = el.parentElement?.tagName?.toLowerCase() || '';
      const grandParentTag = el.parentElement?.parentElement?.tagName?.toLowerCase() || '';

      if (tagName === 'cg' || tagName === 'centerofgravity') {
        const val = parseFloat(el.textContent || "0");
        if (val > 0) {
          allCGElements.push({
            element: el,
            parent: `${grandParentTag}/${parentTag}`,
            value: val
          });
          console.log(`  Found CG tag: value=${val}m (${(val * 39.3701).toFixed(2)}in), location=${grandParentTag}/${parentTag}`);
        }
      }

      if (tagName === 'cp' || tagName === 'centerofpressure') {
        const val = parseFloat(el.textContent || "0");
        if (val > 0) {
          allCPElements.push({
            element: el,
            parent: `${grandParentTag}/${parentTag}`,
            value: val
          });
          console.log(`  Found CP tag: value=${val}m (${(val * 39.3701).toFixed(2)}in), location=${grandParentTag}/${parentTag}`);
        }
      }
    }

    console.log(`📊 Total found: ${allCGElements.length} CG tags, ${allCPElements.length} CP tags`);

    // Priority 1: Extract from simulation results (most accurate, usually OpenRocket's latest computed values)
    // Based on OpenRocket source: CG/CP stored in simulation/flightdata or flightconditions
    // Prefer latest simulation result (usually the last one)
    const simulationsContainer = xmlDoc.querySelector("simulations");
    const simulations = simulationsContainer
      ? Array.from(simulationsContainer.querySelectorAll("simulation"))
      : xmlDoc.querySelectorAll("simulation");

    let latestSimCG = 0;
    let latestSimCP = 0;
    let latestSimMass = 0; // Add Mass extraction
    let latestSimIndex = -1;
    let latestSimTime = 0; // Use simulation timestamp or index to determine latest

    console.log(`🔍 Checking ${simulations.length} simulations...`);

    // Improvement: collect all simulation values, then select most reasonable
    // Traverse from end (latest simulation usually at end)
    const allSimResults: Array<{
      index: number;
      cg: number | null;
      cp: number | null;
      mass: number | null;
    }> = [];

    for (let i = simulations.length - 1; i >= 0; i--) {
      const sim = simulations[i];

      // 🎯 Priority: try extracting from FlightData databranch (most accurate method, based on Python code)
      const flightDataResult = extractFlightDataValues(sim);
      if (flightDataResult) {
        allSimResults.push({
          index: i,
          cg: flightDataResult.cg,
          cp: flightDataResult.cp,
          mass: flightDataResult.mass
        });

        // Extract CG (use first valid value found, but continue collecting all)
        if (flightDataResult.cg !== null && flightDataResult.cg > 0 && latestSimCG === 0) {
          latestSimCG = flightDataResult.cg;
          latestSimIndex = i;
          cgSource = `simulation[${i}]/flightdata/databranch`;
          console.log(`>>> 🎯 Extracted CG from simulation[${i}]/flightdata/databranch: ${latestSimCG.toFixed(5)} m (${(latestSimCG * 39.3701).toFixed(3)}in) <<<`);
        }

        // Extract CP
        if (flightDataResult.cp !== null && flightDataResult.cp > 0 && latestSimCP === 0) {
          latestSimCP = flightDataResult.cp;
          latestSimIndex = i;
          cpSource = `simulation[${i}]/flightdata/databranch`;
          console.log(`>>> 🎯 Extracted CP from simulation[${i}]/flightdata/databranch: ${latestSimCP.toFixed(5)} m (${(latestSimCP * 39.3701).toFixed(3)}in) <<<`);
        }

        // Extract Mass (new)
        if (flightDataResult.mass !== null && flightDataResult.mass > 0 && latestSimMass === 0) {
          latestSimMass = flightDataResult.mass;
          console.log(`>>> 🎯 Extracted Mass from simulation[${i}]/flightdata/databranch: ${(latestSimMass * 1000).toFixed(1)} g <<<`);
        }
      }
    }

    // If collected multiple simulation results, select most reasonable value
    if (allSimResults.length > 1) {
      console.log(`\n======= Comparing all Simulation values =======`);

      // For CG: select largest value (usually more accurate, includes all components)
      const validCGs = allSimResults.filter(r => r.cg !== null && r.cg > 0).map(r => r.cg!);
      if (validCGs.length > 0) {
        const maxCG = Math.max(...validCGs);
        const maxCGIndex = allSimResults.findIndex(r => r.cg === maxCG);
        if (maxCGIndex >= 0 && maxCG > latestSimCG) {
          latestSimCG = maxCG;
          latestSimIndex = allSimResults[maxCGIndex].index;
          cgSource = `simulation[${allSimResults[maxCGIndex].index}]/flightdata/databranch (selected max)`;
          console.log(`>>> ✅ Selected max CG from ${validCGs.length} simulations: ${latestSimCG.toFixed(5)} m (${(latestSimCG * 39.3701).toFixed(3)}in) <<<`);
        }
      }

      // For CP: select largest value
      const validCPs = allSimResults.filter(r => r.cp !== null && r.cp > 0).map(r => r.cp!);
      if (validCPs.length > 0) {
        const maxCP = Math.max(...validCPs);
        const maxCPIndex = allSimResults.findIndex(r => r.cp === maxCP);
        if (maxCPIndex >= 0 && maxCP > latestSimCP) {
          latestSimCP = maxCP;
          latestSimIndex = allSimResults[maxCPIndex].index;
          cpSource = `simulation[${allSimResults[maxCPIndex].index}]/flightdata/databranch (selected max)`;
          console.log(`>>> ✅ Selected max CP from ${validCPs.length} simulations: ${latestSimCP.toFixed(5)} m (${(latestSimCP * 39.3701).toFixed(3)}in) <<<`);
        }
      }

      // For Mass: select closest to calculated value (or largest if calculated unavailable)
      const validMasses = allSimResults.filter(r => r.mass !== null && r.mass > 0).map(r => r.mass!);
      if (validMasses.length > 0) {
        // Temporarily use first found value, will handle in Mass validation later
        console.log(`Found Mass values from ${validMasses.length} simulations: ${validMasses.map(m => (m * 1000).toFixed(1)).join(', ')}g`);
      }
    }

    // Continue traversing simulations, try other methods to extract CG/CP (as fallback)
    for (let i = simulations.length - 1; i >= 0; i--) {
      const sim = simulations[i];

      // If already found values via FlightData, skip fallback methods
      if (latestSimCG > 0 && latestSimCP > 0) {
        break;
      }

      // Check simulation timestamp (if any)
      const simTimeEl = sim.querySelector("time") || sim.getAttribute("time");
      const simTime = simTimeEl ? parseFloat(simTimeEl.toString()) : i; // use index as fallback

      // Check flightdata (OpenRocket's main storage location)
      const flightData = sim.querySelector("flightdata");
      if (flightData) {
        // CG may be in multiple child elements, try various tag names
        const cgEl = flightData.querySelector("cg")
          || flightData.querySelector("centerofgravity")
          || flightData.querySelector("centerofgravity");
        const cpEl = flightData.querySelector("cp")
          || flightData.querySelector("centerofpressure")
          || flightData.querySelector("centerofpressure");

        // Also try direct search of all child elements
        const allChildren = Array.from(flightData.children);
        const cgChild = allChildren.find((el: Element) =>
          el.tagName.toLowerCase() === 'cg' ||
          el.tagName.toLowerCase() === 'centerofgravity'
        );
        const cpChild = allChildren.find((el: Element) =>
          el.tagName.toLowerCase() === 'cp' ||
          el.tagName.toLowerCase() === 'centerofpressure'
        );

        const finalCgEl = cgEl || cgChild;
        const finalCpEl = cpEl || cpChild;

        if (finalCgEl && finalCgEl.textContent && latestSimCG === 0) {
          const val = parseFloat(finalCgEl.textContent);
          if (val > 0 && simTime >= latestSimTime) {
            latestSimCG = val;
            latestSimIndex = i;
            latestSimTime = simTime;
            cgSource = `simulation[${i}]/flightdata/cg`;
            console.log(`>>> 🎯 Extracted CG from simulation[${i}]/flightdata: ${latestSimCG} m (${(latestSimCG * 39.3701).toFixed(3)}in) <<<`);
          }
        }
        if (finalCpEl && finalCpEl.textContent && latestSimCP === 0) {
          const val = parseFloat(finalCpEl.textContent);
          if (val > 0 && simTime >= latestSimTime) {
            latestSimCP = val;
            latestSimIndex = i;
            latestSimTime = simTime;
            cpSource = `simulation[${i}]/flightdata/cp`;
            console.log(`>>> 🎯 Extracted CP from simulation[${i}]/flightdata: ${latestSimCP} m (${(latestSimCP * 39.3701).toFixed(3)}in) <<<`);
          }
        }
      }

      // Check flightconditions (sometimes CG/CP here, especially initial conditions)
      const flightConditions = sim.querySelector("flightconditions");
      if (flightConditions) {
        const cgEl = flightConditions.querySelector("cg") || flightConditions.querySelector("centerofgravity");
        const cpEl = flightConditions.querySelector("cp") || flightConditions.querySelector("centerofpressure");

        if (cgEl && cgEl.textContent && latestSimCG === 0) {
          const val = parseFloat(cgEl.textContent);
          if (val > 0 && simTime >= latestSimTime) {
            latestSimCG = val;
            latestSimIndex = i;
            latestSimTime = simTime;
            cgSource = `simulation[${i}]/flightconditions/cg`;
            console.log(`>>> 🎯 Extracted CG from simulation[${i}]/flightconditions: ${latestSimCG} m (${(latestSimCG * 39.3701).toFixed(3)}in) <<<`);
          }
        }
        if (cpEl && cpEl.textContent && latestSimCP === 0) {
          const val = parseFloat(cpEl.textContent);
          if (val > 0 && simTime >= latestSimTime) {
            latestSimCP = val;
            latestSimIndex = i;
            latestSimTime = simTime;
            cpSource = `simulation[${i}]/flightconditions/cp`;
            console.log(`>>> 🎯 Extracted CP from simulation[${i}]/flightconditions: ${latestSimCP} m (${(latestSimCP * 39.3701).toFixed(3)}in) <<<`);
          }
        }
      }

      // If already found latest values, can exit early
      if (latestSimCG > 0 && latestSimCP > 0) {
        break;
      }
    }

    // Use latest simulation result (usually last one, i.e. latest computed result)
    if (latestSimCG > 0) foundCG = latestSimCG;
    if (latestSimCP > 0) foundCP = latestSimCP;

    // If not found yet, use last found value (usually OpenRocket's latest computed result)
    if (foundCG === 0 && allCGElements.length > 0) {
      // Use last found CG value (usually latest computed result)
      const lastCG = allCGElements[allCGElements.length - 1];
      foundCG = lastCG.value;
      cgSource = lastCG.parent;
      console.log(`>>> 🎯 Using last found CG: ${foundCG} m (${(foundCG * 39.3701).toFixed(2)}in), source=${cgSource} <<<`);
    }

    if (foundCP === 0 && allCPElements.length > 0) {
      // Use last found CP value (usually latest computed result)
      const lastCP = allCPElements[allCPElements.length - 1];
      foundCP = lastCP.value;
      cpSource = lastCP.parent;
      console.log(`>>> 🎯 Using last found CP: ${foundCP} m (${(foundCP * 39.3701).toFixed(2)}in), source=${cpSource} <<<`);
    }

    // Priority 2: Extract from rocket override values (check all possible child elements)
    if (foundCG === 0 || foundCP === 0) {
      const rocketOverride = xmlDoc.querySelector("rocket");
      if (rocketOverride) {
        // Direct query
        const cgEl = rocketOverride.querySelector("cg");
        const cpEl = rocketOverride.querySelector("cp");

        // Also check for overridecg/overridecp
        const overrideCGEl = rocketOverride.querySelector("overridecg");
        const overrideCPEl = rocketOverride.querySelector("overridecp");

        if (foundCG === 0) {
          if (overrideCGEl && overrideCGEl.textContent) {
            const val = parseFloat(overrideCGEl.textContent);
            if (val > 0) {
              foundCG = val;
              cgSource = 'rocket/overridecg';
              console.log(`>>> 🎯 Extracted CG from rocket/overridecg: ${foundCG} m <<<`);
            }
          } else if (cgEl && cgEl.textContent) {
            const val = parseFloat(cgEl.textContent);
            if (val > 0) {
              foundCG = val;
              cgSource = 'rocket/cg';
              console.log(`>>> 🎯 Extracted CG from rocket/cg: ${foundCG} m <<<`);
            }
          }
        }

        if (foundCP === 0) {
          if (overrideCPEl && overrideCPEl.textContent) {
            const val = parseFloat(overrideCPEl.textContent);
            if (val > 0) {
              foundCP = val;
              cpSource = 'rocket/overridecp';
              console.log(`>>> 🎯 Extracted CP from rocket/overridecp: ${foundCP} m <<<`);
            }
          } else if (cpEl && cpEl.textContent) {
            const val = parseFloat(cpEl.textContent);
            if (val > 0) {
              foundCP = val;
              cpSource = 'rocket/cp';
              console.log(`>>> 🎯 Extracted CP from rocket/cp: ${foundCP} m <<<`);
            }
          }
        }
      }
    }

    // Priority 3: Extract from stage
    if (foundCG === 0 || foundCP === 0) {
      const stages = xmlDoc.querySelectorAll("stage");
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (foundCG === 0) {
          const cgEl = stage.querySelector("cg");
          if (cgEl && cgEl.textContent) {
            const val = parseFloat(cgEl.textContent);
            if (val > 0) {
              foundCG = val;
              cgSource = `stage[${i}]`;
              console.log(`>>> 🎯 Extracted CG from stage: ${foundCG} m <<<`);
            }
          }
        }
        if (foundCP === 0) {
          const cpEl = stage.querySelector("cp");
          if (cpEl && cpEl.textContent) {
            const val = parseFloat(cpEl.textContent);
            if (val > 0) {
              foundCP = val;
              cpSource = `stage[${i}]`;
              console.log(`>>> 🎯 Extracted CP from stage: ${foundCP} m <<<`);
            }
          }
        }
      }
    }

    // Priority 4: Search from all possible child elements (thorough search)
    if (foundCG === 0 || foundCP === 0) {
      // First try searching from all simulation child elements
      const allSimElements = xmlDoc.querySelectorAll("simulation *");
      for (let i = 0; i < allSimElements.length; i++) {
        const el = allSimElements[i];
        const tagName = el.tagName.toLowerCase();
        const parentTag = el.parentElement?.tagName?.toLowerCase() || '';

        if ((tagName === 'cg' || tagName === 'centerofgravity') && foundCG === 0) {
          const val = parseFloat(el.textContent || "0");
          if (val > 0) {
            foundCG = val;
            cgSource = `simulation/${parentTag}`;
            console.log(`>>> 🎯 Extracted CG from simulation/${parentTag}: ${foundCG} m <<<`);
          }
        }

        if ((tagName === 'cp' || tagName === 'centerofpressure') && foundCP === 0) {
          const val = parseFloat(el.textContent || "0");
          if (val > 0) {
            foundCP = val;
            cpSource = `simulation/${parentTag}`;
            console.log(`>>> 🎯 Extracted CP from simulation/${parentTag}: ${foundCP} m <<<`);
          }
        }
      }
    }

    // Priority 5: Global search (fallback)
    if (foundCG === 0 || foundCP === 0) {
      const allElements = xmlDoc.getElementsByTagName("*");
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        const tagName = el.tagName.toLowerCase();
        const parentTag = el.parentElement?.tagName?.toLowerCase() || '';

        // Skip already checked locations
        if (parentTag === 'flightdata' || parentTag === 'flightconditions' ||
          parentTag === 'rocket' || parentTag === 'stage' ||
          parentTag === 'simulation' || parentTag.startsWith('simulation')) {
          continue;
        }

        if ((tagName === 'cg' || tagName === 'centerofgravity') && foundCG === 0) {
          const val = parseFloat(el.textContent || "0");
          if (val > 0) {
            foundCG = val;
            cgSource = `global/${parentTag}`;
            console.log(`>>> 🎯 Extracted CG from global search: ${foundCG} m (source: ${parentTag}) <<<`);
          }
        }

        if ((tagName === 'cp' || tagName === 'centerofpressure') && foundCP === 0) {
          const val = parseFloat(el.textContent || "0");
          if (val > 0) {
            foundCP = val;
            cpSource = `global/${parentTag}`;
            console.log(`>>> 🎯 Extracted CP from global search: ${foundCP} m (source: ${parentTag}) <<<`);
          }
        }
      }
    }

    // Check referenceType and referenceLength (OpenRocket uses these for stability calculation)
    // Based on OpenRocket source: referenceLength is reference length for stability calculation
    // referenceType can be: maximum (max diameter), nose (nose cone length), custom
    const rocketEl = xmlDoc.querySelector("rocket");
    let referenceLength = 0;
    let referenceType = 'maximum'; // OpenRocket default

    if (rocketEl) {
      // Try multiple possible tag names
      const refLenEl = rocketEl.querySelector("referencelength")
        || rocketEl.querySelector("referencelength")
        || rocketEl.querySelector("refLength");

      if (refLenEl && refLenEl.textContent) {
        const refLenText = refLenEl.textContent.trim();
        // Handle "auto" value (OpenRocket may use auto for automatic calculation)
        if (refLenText.toLowerCase() !== 'auto') {
          referenceLength = parseFloat(refLenText);
          if (!isNaN(referenceLength) && referenceLength > 0) {
            console.log(`📏 Found referenceLength: ${referenceLength} m (${(referenceLength * 39.3701).toFixed(2)}in)`);
          }
        }
      }

      // If referenceLength not found, try calculating from max diameter (OpenRocket default behavior)
      if (referenceLength === 0) {
        // Recursively find max diameter of all bodytube, nosecone, transition
        const findMaxDiameter = (element: Element): number => {
          let maxD = 0;

          // Check current element
          const radiusEl = element.querySelector("radius") || element.querySelector("aftradius") || element.querySelector("foreradius");
          if (radiusEl && radiusEl.textContent) {
            const radius = parseFloat(radiusEl.textContent);
            if (!isNaN(radius) && radius > 0) {
              maxD = Math.max(maxD, radius * 2);
            }
          }

          // Recursively check all subcomponents
          const subcomponents = element.querySelector("subcomponents");
          if (subcomponents) {
            const children = Array.from(subcomponents.children);
            children.forEach(child => {
              const childMaxD = findMaxDiameter(child);
              maxD = Math.max(maxD, childMaxD);
            });
          }

          return maxD;
        };

        const maxDiameter = findMaxDiameter(rocketEl);
        if (maxDiameter > 0) {
          referenceLength = maxDiameter;
          console.log(`📏 Calculated referenceLength from max diameter: ${referenceLength} m (${(referenceLength * 39.3701).toFixed(2)}in)`);
        }
      }

      const refTypeEl = rocketEl.querySelector("referencetype")
        || rocketEl.querySelector("referenceType")
        || rocketEl.querySelector("reftype");

      if (refTypeEl && refTypeEl.textContent) {
        referenceType = refTypeEl.textContent.toLowerCase().trim();
        // Normalize referenceType value
        if (referenceType === 'max' || referenceType === 'maximum') {
          referenceType = 'maximum';
        } else if (referenceType === 'nose' || referenceType === 'nosecone') {
          referenceType = 'nose';
        } else if (referenceType === 'custom' || referenceType === 'user') {
          referenceType = 'custom';
        }
        console.log(`📏 Found referenceType: ${referenceType}`);
      }

      // Save to simSettings for stability calculation
      if (referenceLength > 0) {
        simSettings.referenceLength = referenceLength;
        simSettings.referenceType = referenceType;
      }
    }

    // Apply found values (consider referenceLength effect)
    if (foundCG > 0) {
      // OpenRocket CG/CP may be relative to referenceLength, needs verification
      simSettings.cg = foundCG;
      const cgInches = foundCG * 39.3701;
      console.log(`✅ Final CG used: ${foundCG} m (${cgInches.toFixed(3)} in) - source: ${cgSource}`);
      if (referenceLength > 0) {
        const cgPercent = (foundCG / referenceLength) * 100;
        console.log(`   CG position: ${cgPercent.toFixed(1)}% of reference length (${referenceLength}m)`);
      }
    } else {
      console.warn("⚠️ CG value not found, will use calculated value");
    }

    if (foundCP > 0) {
      simSettings.cp = foundCP;
      const cpInches = foundCP * 39.3701;
      console.log(`✅ Final CP used: ${foundCP} m (${cpInches.toFixed(3)} in) - source: ${cpSource}`);
      if (referenceLength > 0) {
        const cpPercent = (foundCP / referenceLength) * 100;
        console.log(`   CP position: ${cpPercent.toFixed(1)}% of reference length (${referenceLength}m)`);
      }
    } else {
      console.warn("⚠️ CP value not found, will use calculated value");
    }

    // If parseSimulationConfig also has values, compare and select most accurate
    if (simSettings.cg && foundCG > 0 && Math.abs(simSettings.cg - foundCG) > 0.0001) {
      const diff = Math.abs(simSettings.cg - foundCG);
      const diffInches = diff * 39.3701;
      console.log(`📊 CG comparison: parseSimulationConfig=${simSettings.cg}m, extracted=${foundCG}m, diff=${(diff * 1000).toFixed(2)}mm (${diffInches.toFixed(3)}in)`);
      // Prefer simulation result values (more accurate)
      if (cgSource.includes('simulation')) {
        console.log(`✅ Using CG from simulation result (more accurate)`);
        simSettings.cg = foundCG; // Ensure using simulation result
      } else if (simSettings.cg > foundCG) {
        console.log(`✅ Using CG from parseSimulationConfig (possibly more accurate)`);
      }
    }

    if (simSettings.cp && foundCP > 0 && Math.abs(simSettings.cp - foundCP) > 0.0001) {
      const diff = Math.abs(simSettings.cp - foundCP);
      const diffInches = diff * 39.3701;
      console.log(`📊 CP comparison: parseSimulationConfig=${simSettings.cp}m, extracted=${foundCP}m, diff=${(diff * 1000).toFixed(2)}mm (${diffInches.toFixed(3)}in)`);
      // Prefer simulation result values (more accurate)
      if (cpSource.includes('simulation')) {
        console.log(`✅ Using CP from simulation result (more accurate)`);
        simSettings.cp = foundCP; // Ensure using simulation result
      } else if (simSettings.cp > foundCP) {
        console.log(`✅ Using CP from parseSimulationConfig (possibly more accurate)`);
      }
    }
    const finishEl = rocket.querySelector("finish");
    const finish = finishEl?.textContent || undefined;

    // ============= Improvement: Use Mass from flightdata to validate total mass =============
    // Define temporary calcMass function (for total mass calculation, will be redefined in detailed analysis)
    const calcMassTemp = (comps: RocketComponent[]): number => {
      return comps.reduce((sum, c) => {
        if (c.overridesSubComponents) {
          return sum + (c.mass || 0);
        }
        const subMass = c.subComponents ? calcMassTemp(c.subComponents) : 0;
        return sum + (c.mass || 0) + subMass;
      }, 0);
    };

    let flightDataMass = latestSimMass; // Mass extracted from flightdata (may be total mass)
    const calculatedDryMass = calcMassTemp(stages); // Calculated dry mass (excluding motor)

    // Check if FlightData Mass includes motor mass
    // If FlightData Mass ≈ calculated dry mass + motor mass, it's total mass
    // If FlightData Mass ≈ calculated dry mass, it's dry mass
    const motorTotalMass = motorConfig.motor.totalMass || 0;
    const expectedTotalMass = calculatedDryMass + motorTotalMass;

    if (flightDataMass > 0) {
      // Determine if FlightData Mass is total or dry mass
      const diffAsTotal = Math.abs(flightDataMass - expectedTotalMass);
      const diffAsDry = Math.abs(flightDataMass - calculatedDryMass);

      const isTotalMass = diffAsTotal < diffAsDry; // Closer to total mass
      const flightDataDryMass = isTotalMass ? flightDataMass - motorTotalMass : flightDataMass;

      console.log(`\n======= Mass Verification =======`);
      console.log(`FlightData Mass (t=0): ${(flightDataMass * 1000).toFixed(1)} g`);
      if (isTotalMass) {
        console.log(`  → Identified as total mass (incl. motor), dry mass: ${(flightDataDryMass * 1000).toFixed(1)} g`);
      } else {
        console.log(`  → Identified as dry mass`);
      }
      console.log(`Calculated dry Mass: ${(calculatedDryMass * 1000).toFixed(1)} g`);
      console.log(`Motor total Mass: ${(motorTotalMass * 1000).toFixed(1)} g`);
      console.log(`Expected total Mass: ${(expectedTotalMass * 1000).toFixed(1)} g`);

      // Compare dry mass (more accurate)
      const dryMassDiff = Math.abs(calculatedDryMass - flightDataDryMass);
      const dryMassDiffPercent = (dryMassDiff / flightDataDryMass) * 100;

      console.log(`Dry mass difference: ${(dryMassDiff * 1000).toFixed(1)} g (${dryMassDiffPercent.toFixed(1)}%)`);

      // If difference exceeds 5%, emit warning
      if (dryMassDiffPercent > 5) {
        warnings.push(`Significant mass difference: FlightData dry mass=${(flightDataDryMass * 1000).toFixed(1)}g, calculated=${(calculatedDryMass * 1000).toFixed(1)}g, diff=${dryMassDiffPercent.toFixed(1)}%`);
        console.warn(`⚠️ Dry mass difference exceeds 5%, component mass data may need verification`);
      } else {
        console.log(`✅ Dry mass difference within acceptable range`);
      }

      // If difference is large (>10%), consider using FlightData value as reference
      if (dryMassDiffPercent > 10) {
        console.warn(`⚠️ Large dry mass difference, consider verifying component mass settings. FlightData value may be more accurate.`);
      }
    } else {
      console.log(`\n======= Mass Verification =======`);
      console.log(`Mass value not extracted from FlightData, using calculated value: ${(calculatedDryMass * 1000).toFixed(1)} g`);
    }

    // Use Cd from stage, or from motorConfig if not found
    const finalCd = configData.cd || motorConfig.cd || 0.5;
    console.log('Final Cd value used:', finalCd);

    // Only warn when Cd is truly not found
    if (!configData.cd && (!motorConfig.cd || motorConfig.cd === 0.5)) {
      warnings.push("Cd not found in file, using default value 0.5");
    }

    // Propagate stage-level override mass/CG into simulationSettings
    // When the .ork file has <overridemass> at the stage level with <overridesubcomponentsmass>true,
    // this is the user-measured total dry mass — more accurate than summing individual components.
    if (configData.overrideMass && configData.overrideMass > 0) {
      // Stage override mass is the total dry mass (structure only, no motor)
      // This takes priority over component-sum calculation
      if (!simSettings.mass || Math.abs(simSettings.mass - configData.overrideMass) > 0.01) {
        console.log(`[Stage Override] Using stage override mass: ${(configData.overrideMass * 1000).toFixed(1)}g (replaces calculated ${(calculatedDryMass * 1000).toFixed(1)}g)`);
        simSettings.mass = configData.overrideMass + (motorConfig.motor.totalMass || 0);
        console.log(`[Stage Override] Total launch mass (dry + motor): ${(simSettings.mass * 1000).toFixed(1)}g`);
      }
    }

    if (configData.overrideCG && configData.overrideCG > 0) {
      // The stage overridecg is the STRUCTURAL CG (without motor mass).
      // OpenRocket computes the actual CG by combining structure + motor masses.
      // We must do the same: CG_total = (m_struct * CG_struct + m_motor * CG_motor) / (m_struct + m_motor)
      const structMass = configData.overrideMass || calculatedDryMass;
      const motorMass = motorConfig.motor.totalMass || 0;
      const motorCenter = findMotorCenterFromXML(rocket);

      if (motorCenter > 0 && motorMass > 0 && structMass > 0) {
        const adjustedCG = (structMass * configData.overrideCG + motorMass * motorCenter) / (structMass + motorMass);
        simSettings.cg = adjustedCG;
        console.log(`[Stage Override] Structural CG: ${configData.overrideCG.toFixed(4)}m (${(configData.overrideCG * 39.3701).toFixed(2)}in)`);
        console.log(`[Stage Override] Motor center: ${motorCenter.toFixed(4)}m, motor mass: ${(motorMass * 1000).toFixed(1)}g`);
        console.log(`[Stage Override] ✅ Adjusted CG (incl. motor): ${adjustedCG.toFixed(4)}m (${(adjustedCG * 39.3701).toFixed(2)}in)`);
      } else {
        // Fallback: use structural CG as-is
        simSettings.cg = configData.overrideCG;
        console.log(`[Stage Override] Using structural CG as-is (no motor position data): ${configData.overrideCG.toFixed(4)}m`);
      }
    }

    // Build RocketConfig
    const rocketConfig: RocketConfig = {
      stages: stages.filter(s => s.type === 'STAGE') as Stage[],
      motor: motorConfig.motor,
      cdOverride: finalCd,
      name: rocketName,
      finish,
      simulationSettings: simSettings
    };

    // ============= Improvement: Output component tree structure (similar to Python summary method) =============
    console.log('======= Parsing Results (Improved Tree Structure) =======');
    console.log('Rocket name:', rocketName);
    console.log('Number of stages:', stages.length);

    // Output component tree structure, showing absolute positions
    const printComponentTree = (comps: RocketComponent[], indent: string = '') => {
      comps.forEach((comp, i) => {
        const absPos = (comp as any).absolutePosition !== undefined
          ? (comp as any).absolutePosition.toFixed(4)
          : comp.position.toFixed(4);
        const length = (comp as any).length || 0;
        const massG = (comp.mass * 1000).toFixed(1);
        const axialOffset = (comp as any).axialOffset !== undefined
          ? (comp as any).axialOffset.toFixed(4)
          : 'N/A';

        console.log(`${indent}${i + 1}. ${comp.type}: ${comp.name}`);
        console.log(`${indent}   Position: abs=${absPos}m, offset=${axialOffset}m, length=${length.toFixed(4)}m, mass=${massG}g`);

        // If FINS, show fin data
        if (comp.type === 'FINS' && (comp as any).finData) {
          const finData = (comp as any).finData;
          console.log(`${indent}   Fin data: count=${finData.count}, root=${finData.root.toFixed(4)}m, tip=${finData.tip.toFixed(4)}m, span=${finData.span.toFixed(4)}m`);
        }

        if (comp.subComponents && comp.subComponents.length > 0) {
          printComponentTree(comp.subComponents, indent + '  ');
        }
      });
    };

    stages.forEach((stage, idx) => {
      console.log(`\n========== Stage ${idx + 1}: ${stage.name} ==========`);
      if (stage.subComponents && stage.subComponents.length > 0) {
        printComponentTree(stage.subComponents, '  ');
      }
    });

    // Output flattened list of all components (similar to Python get_fins, get_bodytubes, etc.)
    const allComponents = flattenComponents(stages);
    const fins = allComponents.filter(c => c.type === 'FINS');
    const bodyTubes = allComponents.filter(c => c.type === 'BODYTUBE');

    console.log(`\n======= Component Summary =======`);
    console.log(`Total components: ${allComponents.length}`);
    console.log(`Fins count: ${fins.length}`);
    console.log(`BodyTubes count: ${bodyTubes.length}`);

    if (fins.length > 0) {
      console.log(`\nFINS details:`);
      fins.forEach(f => {
        const finData = (f as any).finData;
        if (finData) {
          console.log(`  ${f.name}: count=${finData.count}, root=${finData.root.toFixed(4)}m, tip=${finData.tip.toFixed(4)}m, span=${finData.span.toFixed(4)}m, sweep=${finData.sweep.toFixed(4)}m`);
        }
      });
    }

    // Output mass distribution (similar to Python get_mass_distribution)
    const massDistribution = allComponents
      .filter(c => c.mass > 0)
      .map(c => ({
        position: (c as any).absolutePosition !== undefined ? (c as any).absolutePosition : c.position,
        mass: c.mass
      }))
      .sort((a, b) => a.position - b.position);

    if (massDistribution.length > 0) {
      console.log(`\nMass distribution:`);
      massDistribution.forEach(({ position, mass }) => {
        console.log(`  Position: ${position.toFixed(4)}m, mass: ${(mass * 1000).toFixed(1)}g`);
      });
    }

    // Detailed debug info - includes component tree structure and Mass calculation
    console.log('\n======= Detailed Mass Analysis =======');

    // Recursively calculate total Mass
    const calcMass = (comps: RocketComponent[]): number => {
      return comps.reduce((sum, c) => {
        // If current component overrides subcomponent Mass, use only current component Mass
        if (c.overridesSubComponents) {
          return sum + (c.mass || 0);
        }
        // Otherwise sum current component Mass and subcomponent Mass
        const subMass = c.subComponents ? calcMass(c.subComponents) : 0;
        return sum + (c.mass || 0) + subMass;
      }, 0);
    };

    stages.forEach((stage, idx) => {
      console.log(`\n========== Stage ${idx + 1}: ${stage.name} ==========`);
      console.log(`Top-level Components: ${stage.subComponents.length}`);

      // Recursively print all components and their Mass (with detailed debug info)
      const printComponentTree = (comps: RocketComponent[], indent: string = '') => {
        comps.forEach((comp, i) => {
          const massG = (comp.mass * 1000).toFixed(1);
          const override = comp.overridesSubComponents ? ' [Overrides subcomponents]' : '';
          const massWarning = comp.mass === 0 ? ' ⚠️ MASS=0!' : '';
          console.log(`${indent}${i + 1}. ${comp.type}: ${comp.name} = ${massG}g${override}${massWarning}`);

          if (comp.subComponents && comp.subComponents.length > 0) {
            if (comp.overridesSubComponents) {
              console.log(`${indent}   └─ (${comp.subComponents.length} subcomponents overridden, not counted in total Mass)`);
            } else {
              console.log(`${indent}   └─ Contains ${comp.subComponents.length} subcomponents:`);
              printComponentTree(comp.subComponents, indent + '      ');
            }
          }
        });
      };

      printComponentTree(stage.subComponents, '  ');

      const stageMass = calcMass([stage]);
      console.log(`  >> Stage total Mass: ${(stageMass * 1000).toFixed(1)}g`);
      console.log(`========================================`);
    });

    const totalMass = calcMass(stages);
    console.log(`\n╔═══════════════════════════════════════╗`);
    console.log(`║  🎯 Rocket total dry Mass: ${(totalMass * 1000).toFixed(1)}g`.padEnd(40) + `║`);
    console.log(`╚═══════════════════════════════════════╝`);

    // Detailed Mass breakdown (including components with mass 0)
    console.log(`\n📊 Mass breakdown details:`);
    const componentMasses: { type: string, count: number, totalMass: number, zeroMassCount: number }[] = [];
    const analyzeComponents = (comps: RocketComponent[]) => {
      comps.forEach(comp => {
        const existing = componentMasses.find(c => c.type === comp.type);
        if (existing) {
          existing.count++;
          existing.totalMass += comp.mass;
          if (comp.mass === 0) existing.zeroMassCount++;
        } else {
          componentMasses.push({
            type: comp.type,
            count: 1,
            totalMass: comp.mass,
            zeroMassCount: comp.mass === 0 ? 1 : 0
          });
        }

        if (comp.subComponents && !comp.overridesSubComponents) {
          analyzeComponents(comp.subComponents);
        }
      });
    };

    stages.forEach(stage => analyzeComponents([stage]));
    componentMasses.sort((a, b) => b.totalMass - a.totalMass);
    componentMasses.forEach(cm => {
      const massG = (cm.totalMass * 1000).toFixed(1);
      const count = cm.count > 1 ? ` (×${cm.count})` : '';
      const zeroWarning = cm.zeroMassCount > 0 ? ` ⚠️ ${cm.zeroMassCount} with mass 0` : '';
      console.log(`  ${cm.type.padEnd(20)} ${massG.padStart(6)}g${count}${zeroWarning}`);
    });
    console.log(`  ${'─'.repeat(30)}`);
    console.log(`  ${'Total'.padEnd(20)} ${(totalMass * 1000).toFixed(1).padStart(6)}g`);
    console.log(`\n✅ Rocket dry mass parsing complete: ${(totalMass * 1000).toFixed(1)}g`);
    console.log(`⚠️ If mass does not match OpenRocket display, check component tree above`);

    console.log('\nMotor:', motorConfig.motor.name);
    console.log('Cd:', motorConfig.cd);

    // ============= Data validation and consistency check =============
    console.log('\n======= Data Validation =======');
    const validationResults = validateRocketData(rocketConfig, stages, motorConfig);

    if (validationResults.errors.length > 0) {
      console.warn('⚠️ Data issues found:');
      validationResults.errors.forEach(err => {
        console.warn(`  - ${err}`);
        warnings.push(err);
      });
    }

    if (validationResults.warnings.length > 0) {
      console.warn('⚠️ Data warnings:');
      validationResults.warnings.forEach(warn => {
        console.warn(`  - ${warn}`);
        warnings.push(warn);
      });
    }

    if (validationResults.errors.length === 0 && validationResults.warnings.length === 0) {
      console.log('✅ Data validation passed');
    }

    // Check if parachute exists
    const hasParachute = stages.some(s =>
      findComponentRecursive(s, 'PARACHUTE')
    );

    // Calculate parse statistics
    const parseStats = {
      totalComponents: countComponents(stages),
      totalStages: stages.length,
      hasMotor: !!motorConfig.motor,
      hasParachute: hasParachute,
      hasCG: foundCG > 0,
      hasCP: foundCP > 0,
      hasReferenceLength: referenceLength > 0,
      validationErrors: validationResults.errors.length,
      validationWarnings: validationResults.warnings.length
    };

    console.log('\n======= Parse Statistics =======');
    console.log(`Total components: ${parseStats.totalComponents}`);
    console.log(`Stage count: ${parseStats.totalStages}`);
    console.log(`Has Motor: ${parseStats.hasMotor ? '✅' : '❌'}`);
    console.log(`Has parachute: ${parseStats.hasParachute ? '✅' : '❌'}`);
    console.log(`Has CG value: ${parseStats.hasCG ? '✅' : '❌'}`);
    console.log(`Has CP value: ${parseStats.hasCP ? '✅' : '❌'}`);
    console.log(`Has ReferenceLength: ${parseStats.hasReferenceLength ? '✅' : '❌'}`);
    console.log('======= Parsing Complete =======');

    return {
      success: true,
      rocket: rocketConfig,
      warnings: warnings.length > 0 ? warnings : undefined,
      parseStats: parseStats
    };

  } catch (error) {
    console.error('Error parsing .ork file:', error);

    // Enhanced error reporting
    let errorMessage = 'Parse failed';
    let suggestions: string[] = [];

    if (error instanceof Error) {
      errorMessage = error.message;

      // Provide specific suggestions based on error type
      if (errorMessage.includes('ZIP') || errorMessage.includes('unzip')) {
        suggestions.push('File may not be valid ZIP format');
        suggestions.push('Try re-saving the file in OpenRocket');
      } else if (errorMessage.includes('XML') || errorMessage.includes('parse')) {
        suggestions.push('XML format may be invalid');
        suggestions.push('Check if file is corrupted');
        suggestions.push('Try opening and re-saving in OpenRocket');
      } else if (errorMessage.includes('not found')) {
        suggestions.push('File may be missing required structure');
        suggestions.push('Ensure file is a complete OpenRocket design file');
      }
    }

    // General suggestions
    if (suggestions.length === 0) {
      suggestions.push('Check if file is .ork format saved by OpenRocket');
      suggestions.push('Ensure file is not corrupted');
      suggestions.push('Use OpenRocket 1.0 or higher to save');
      suggestions.push('Try opening file in OpenRocket to verify integrity');
    }

    return {
      success: false,
      error: `${errorMessage}\n\nSuggestions:\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nIf problem persists, check browser console for detailed error info.`
    };
  }
};

export const parseORKFile = async (file: File): Promise<ORKParseResult> => {
  const { parseORKFile: parseModularORKFile } = await import('./ork/OrkParser');
  return parseModularORKFile(file);
};

// ============= Helper: Find motor center position from XML =============
// Walks the component tree in the XML to find the motor mount inner tube
// and compute the motor's center-of-mass position from the nose tip.
// This is needed to adjust the structural CG override to include motor mass.

// Helper: find a direct child element by tag name (avoids :scope which fails in XML DOMParser)
const findDirectChildByTag = (parent: Element, tagName: string): Element | null => {
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === tagName.toLowerCase()) return child;
  }
  return null;
};

const findMotorCenterFromXML = (rocketEl: Element): number => {
  // Find the REAL stage element (the one with <subcomponents>, not the empty one in <motorconfiguration>)
  const allStages = rocketEl.querySelectorAll("stage");
  let stageEl: Element | null = null;
  for (const s of Array.from(allStages)) {
    // Real stage has child elements (name, subcomponents, etc.)
    if (s.children.length > 0 && s.querySelector("subcomponents")) {
      stageEl = s;
      break;
    }
  }
  if (!stageEl) {
    // Fallback: try top-level subcomponents directly
    const subEl = findDirectChildByTag(rocketEl, "subcomponents");
    if (!subEl) { console.warn('[Motor Position] No stage element found'); return 0; }
    return findMotorCenterInStage(subEl);
  }
  return findMotorCenterInStage(stageEl);
};

const findMotorCenterInStage = (stageEl: Element): number => {
  const stageSubcomponents = findDirectChildByTag(stageEl, "subcomponents");
  if (!stageSubcomponents) {
    console.warn('[Motor Position] No subcomponents in stage');
    return 0;
  }

  // Walk top-level axial components (nose cone, body tubes, transitions)
  // tracking cumulative position from nose tip
  let currentPosition = 0;

  for (const child of Array.from(stageSubcomponents.children)) {
    const tagName = child.tagName.toLowerCase();
    if (!['nosecone', 'bodytube', 'transition'].includes(tagName)) continue;

    const lengthEl = findDirectChildByTag(child, "length");
    const length = lengthEl ? parseFloat(lengthEl.textContent || "0") : 0;
    if (isNaN(length) || length <= 0) continue;

    // Check if this component contains a motor mount inner tube
    const innerTubes = child.querySelectorAll("innertube");
    for (const innerTube of Array.from(innerTubes)) {
      if (!innerTube.querySelector("motormount")) continue;

      // Found motor mount!
      const innerLengthEl = findDirectChildByTag(innerTube, "length");
      const innerLength = parseFloat(innerLengthEl?.textContent || "0");
      const axialOffsetEl = findDirectChildByTag(innerTube, "axialoffset");
      const axialOffset = parseFloat(axialOffsetEl?.textContent || "0");
      const method = axialOffsetEl?.getAttribute("method") || "top";

      // Get motor specs from the motormount element
      const motorEl = innerTube.querySelector("motormount > motor");
      const motorLengthEl = motorEl ? findDirectChildByTag(motorEl, "length") : null;
      const motorLength = parseFloat(motorLengthEl?.textContent || String(innerLength));
      const overhangEl = innerTube.querySelector("motormount > overhang");
      const overhang = parseFloat(overhangEl?.textContent || "0");

      // Compute inner tube bottom position based on offset method
      let innerTubeBottom: number;
      if (method === 'bottom') {
        // "bottom" offset: inner tube bottom = parent bottom + offset
        innerTubeBottom = currentPosition + length + axialOffset;
      } else if (method === 'middle') {
        const midpoint = currentPosition + length / 2 + axialOffset;
        innerTubeBottom = midpoint + innerLength / 2;
      } else {
        // "top" offset (default): inner tube top = parent top + offset
        innerTubeBottom = currentPosition + axialOffset + innerLength;
      }

      // Motor bottom = inner tube bottom + overhang (positive overhang = motor sticks out)
      const motorBottom = innerTubeBottom + overhang;
      const motorTop = motorBottom - motorLength;
      const motorCenter = (motorTop + motorBottom) / 2;

      console.log(`[Motor Position] Parent body tube: pos=${currentPosition.toFixed(4)}m, len=${length.toFixed(4)}m`);
      console.log(`[Motor Position] Inner tube: method=${method}, offset=${axialOffset}, length=${innerLength}m`);
      console.log(`[Motor Position] Motor: length=${motorLength}m, overhang=${overhang}m`);
      console.log(`[Motor Position] Motor center from nose: ${motorCenter.toFixed(4)}m (${(motorCenter * 39.3701).toFixed(2)}in)`);

      return motorCenter;
    }

    currentPosition += length;
  }

  console.warn('[Motor Position] Motor mount not found in component tree');
  return 0;
};

// ============= Helper: Compute absolute positions for all components =============
// Based on Python compute_absolute_positions method
const computeAbsolutePositions = (components: RocketComponent[], parentPos: number = 0): void => {
  const sequentialTypes = new Set(['NOSECONE', 'BODYTUBE', 'TRANSITION']);
  let sequentialPos = parentPos;

  components.forEach(comp => {
    const axialOffset = (comp as any).axialOffset || 0;
    const isSequential = sequentialTypes.has(comp.type);
    const hasExplicitOffset = axialOffset !== 0;

    const absolutePos = (isSequential && !hasExplicitOffset)
      ? sequentialPos
      : parentPos + axialOffset;

    comp.position = absolutePos;
    (comp as any).absolutePosition = absolutePos;

    if (isSequential && !hasExplicitOffset) {
      sequentialPos += (comp as any).length || 0;
    }

    if (comp.subComponents && comp.subComponents.length > 0) {
      computeAbsolutePositions(comp.subComponents, absolutePos);
    }
  });
};

// ============= Helper: Flatten component tree =============
// Based on Python flatten method
const flattenComponents = (components: RocketComponent[]): RocketComponent[] => {
  const result: RocketComponent[] = [];
  components.forEach(comp => {
    result.push(comp);
    if (comp.subComponents && comp.subComponents.length > 0) {
      result.push(...flattenComponents(comp.subComponents));
    }
  });
  return result;
};

// ============= Parse Stage components =============
const parseStages = (rocket: Element, warnings: string[], rocketConfig: { cd?: number; overrideMass?: number; overrideCG?: number }): RocketComponent[] => {
  const stages: RocketComponent[] = [];

  // OpenRocket uses <stage> or <subcomponents> structure
  const stageElements = rocket.querySelectorAll("stage");

  if (stageElements.length === 0) {
    // If no explicit stage tag, find top-level subcomponents
    const subcomponents = rocket.querySelector("subcomponents");
    if (subcomponents) {
      const stage = parseStageElement(subcomponents, 0, warnings, rocketConfig);
      if (stage) stages.push(stage);
    }
  } else {
    stageElements.forEach((stageEl, idx) => {
      const stage = parseStageElement(stageEl, idx, warnings, rocketConfig);
      // Only add non-empty stages
      if (stage && stage.subComponents && stage.subComponents.length > 0) {
        stages.push(stage);
      }
    });
  }

  if (stages.length === 0) {
    warnings.push("No stages with components found in rocket, creating default stage");
    stages.push({
      id: 'stage-1',
      type: 'STAGE',
      name: 'Stage 1',
      mass: 0,
      color: '#ffffff',
      position: 0,
      subComponents: []
    });
  }

  // ============= Improvement: After parsing, compute absolute positions for all components =============
  stages.forEach(stage => {
    if (stage.subComponents && stage.subComponents.length > 0) {
      computeAbsolutePositions(stage.subComponents, 0);
    }
  });

  return stages;
};

const parseStageElement = (stageEl: Element, index: number, warnings: string[], rocketConfig: { cd?: number; overrideMass?: number; overrideCG?: number }): RocketComponent | null => {
  // ============= Improvement: Pass initial position 0 to subcomponents =============
  const subcomponents = parseComponents(stageEl, warnings, 0);

  // Helper: find direct child element before <subcomponents> tag
  const findDirectChild = (parent: Element, tagName: string): Element | null => {
    for (const child of Array.from(parent.children)) {
      if (child.tagName.toLowerCase() === 'subcomponents') break;
      if (child.tagName.toLowerCase() === tagName.toLowerCase()) return child;
    }
    return null;
  };

  // Extract stage overridecd
  const overrideCdElement = findDirectChild(stageEl, "overridecd");
  if (overrideCdElement && overrideCdElement.textContent) {
    const cd = parseFloat(overrideCdElement.textContent);
    if (!isNaN(cd) && cd > 0) {
      rocketConfig.cd = cd;
      console.log(`[Stage] Extracted Cd override: ${cd}`);
    }
  }

  // Extract stage overridemass — when present, this is the measured total mass of the stage
  let stageMass = 0;
  let overridesSubComponents = false;

  const overrideSubEl = findDirectChild(stageEl, "overridesubcomponentsmass");
  if (overrideSubEl && overrideSubEl.textContent === 'true') {
    overridesSubComponents = true;
  }

  const overrideMassEl = findDirectChild(stageEl, "overridemass");
  if (overrideMassEl && overrideMassEl.textContent) {
    const parsedMass = parseFloat(overrideMassEl.textContent);
    if (!isNaN(parsedMass) && parsedMass > 0 && parsedMass < 100) {
      stageMass = parsedMass;
      rocketConfig.overrideMass = parsedMass;
      console.log(`[Stage] ✅ Override mass: ${(parsedMass * 1000).toFixed(1)}g (overridesSubComponents=${overridesSubComponents})`);
    }
  }

  // Extract stage overridecg — measured CG position from nose tip
  const overrideCGEl = findDirectChild(stageEl, "overridecg");
  if (overrideCGEl && overrideCGEl.textContent) {
    const parsedCG = parseFloat(overrideCGEl.textContent);
    if (!isNaN(parsedCG) && parsedCG > 0) {
      rocketConfig.overrideCG = parsedCG;
      console.log(`[Stage] ✅ Override CG: ${parsedCG.toFixed(4)}m (${(parsedCG * 39.3701).toFixed(2)}in)`);
    }
  }

  return {
    id: `stage-${index + 1}`,
    type: 'STAGE',
    name: stageEl.querySelector("name")?.textContent || `Stage ${index + 1}`,
    mass: stageMass,
    overridesSubComponents,
    color: '#ffffff',
    position: 0,
    subComponents: subcomponents
  };
};

// Extended material density database (kg/m^3 or kg/m^2 or kg/m)
// Supports more OpenRocket common materials
const MATERIAL_DENSITIES: Record<string, number> = {
  // 3D printing materials (kg/m^3)
  'PLA - 100% infill': 1250,
  'PLA': 1250,
  'PLA+': 1250,
  'PETG': 1270,
  'ABS': 1050,
  'ABS+': 1050,
  'TPU': 1200,
  'Nylon': 1150,
  'Polycarbonate': 1200,
  'ASA': 1050,

  // Traditional materials (kg/m^3)
  'Polystyrene': 1050,
  'Cardboard': 680,
  'Paper': 800,
  'Balsa': 150,
  'Basswood': 420,
  'Plywood': 600,
  'Birch Plywood': 650,
  'Pine': 500,
  'Oak': 750,
  'Fiberglass': 1800,
  'Carbon fiber': 1600,
  'Kevlar': 1440,
  'Aluminum': 2700,
  'Steel': 7850,
  'Brass': 8500,
  'Copper': 8960,
  'Titanium': 4500,
  'PVC': 1380,
  'Acrylic': 1180,
  'Polycarbonate Sheet': 1200,

  // Composite materials (kg/m^3)
  'G10 Fiberglass': 1800,
  'Carbon Fiber Tube': 1600,
  'Fiberglass Tube': 1800,

  // Parachute materials (kg/m^2)
  'Ripstop Nylon': 0.067, // ~1.9 oz/yd^2
  'Silk': 0.045,
  'Plastic': 0.030,
  'Polyester': 0.055,
  'Tyvek': 0.040,

  // Shock cord materials (kg/m)
  'Elastic cord': 0.008, // ~8g/m
  'Elastic': 0.008,
  'Rubber': 0.010,
  'Kevlar Cord': 0.003,
  'Nylon cord': 0.005,
  'Nylon Rope': 0.005,
  'Tubular nylon': 0.012,
  'Shock Cord': 0.008,
  'Elastic Shock Cord': 0.008,

  // Other common materials
  'Foam': 30,
  'Styrofoam': 30,
  'EPS Foam': 30,
  'XPS Foam': 35,
  'EVA Foam': 95,
  'Cork': 240,
  'Rubber Sheet': 1200,

  // OpenRocket default materials (if name doesn't match exactly, try partial match)
  'Custom': 1000, // Default density
};

// ============= Parse components (improved: tree structure method) =============
// Improvement: Use tree structure method, correctly compute absolute position (axial_offset accumulation)
const parseComponents = (parent: Element, warnings: string[], parentPosition: number = 0): RocketComponent[] => {
  const components: RocketComponent[] = [];

  // Find all subcomponents
  const subcomponentsEl = parent.querySelector("subcomponents");
  if (!subcomponentsEl) return components;

  // Iterate over all component types (extended support for more OpenRocket components)
  const componentTypes = [
    'nosecone', 'bodytube', 'transition', 'trapezoidfinset',
    'innertube', 'centeringring', 'parachute', 'shockcord',
    'engineblock', 'launchlug', 'masscomponent',
    'railbutton', 'tubecoupler',
    // Extended component types
    'freeformfinset', 'ellipticalfinset', 'tubefinset',  // More fin types
    'podset', 'ringcomponent', 'tubeset',  // Other components
    'streamer', 'altimeter', 'battery'  // Functional components
  ];

  // Structural components (nosecone, bodytube, transition) are stacked end-to-end in OpenRocket
  // when they have no explicit axialoffset. Track cumulative position for sequential stacking.
  const sequentialTypes = new Set(['nosecone', 'bodytube', 'transition']);
  let sequentialPos = parentPosition;

  // Get parent length for bottom/middle offset calculations
  const parentLength = parseFloat(findDirectChildByTag(parent, "length")?.textContent || "0") || 0;

  const children = Array.from(subcomponentsEl.children);
  children.forEach((el, idx) => {
    const tagName = el.tagName.toLowerCase();
    if (!componentTypes.includes(tagName)) return;

    const isSequential = sequentialTypes.has(tagName);
    const offsetEl = findDirectChildByTag(el, "axialoffset") || findDirectChildByTag(el, "position");
    const hasExplicitOffset = !!offsetEl;
    const method = offsetEl?.getAttribute("method") || offsetEl?.getAttribute("type") || "top";
    const axialOffset = parseFloat(offsetEl?.textContent || "0") || 0;

    let forePos: number;
    if (isSequential && !hasExplicitOffset) {
      // Sequential structural components stacked end-to-end
      forePos = sequentialPos;
    } else if (method === "bottom") {
      // Fore of component = parent_aft + axialOffset - compLength
      const compLen = parseFloat(
        findDirectChildByTag(el, "length")?.textContent ||
        findDirectChildByTag(el, "rootchord")?.textContent || "0"
      ) || 0;
      forePos = parentPosition + parentLength + axialOffset - compLen;
    } else if (method === "middle") {
      // Center of component = parent_fore + axialOffset → fore = center - compLength/2
      const compLen = parseFloat(
        findDirectChildByTag(el, "length")?.textContent ||
        findDirectChildByTag(el, "rootchord")?.textContent || "0"
      ) || 0;
      forePos = parentPosition + axialOffset - compLen / 2;
    } else {
      // method="top" or absolute: fore of component = parent_fore + axialOffset
      forePos = parentPosition + axialOffset;
    }

    const component = parseComponent(el, tagName, idx, warnings, forePos, true);
    if (component) {
      components.push(component);
      if (isSequential && !hasExplicitOffset) {
        sequentialPos += (component as any).length || 0;
      }
    }
  });

  return components;
};

const parseComponent = (element: Element, typeName: string, index: number, warnings: string[], parentPosition: number = 0, positionPrecomputed: boolean = false): RocketComponent | null => {
  const name = element.querySelector("name")?.textContent || `${typeName} ${index + 1}`;
  const id = `${typeName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Type mapping (extended support for more component types)
  const typeMap: Record<string, ComponentType> = {
    'nosecone': 'NOSECONE',
    'bodytube': 'BODYTUBE',
    'transition': 'TRANSITION',
    'trapezoidfinset': 'FINS',
    'freeformfinset': 'FINS',  // Freeform fins map to FINS
    'ellipticalfinset': 'FINS',  // Elliptical fins map to FINS
    'tubefinset': 'FINS',        // Tube fins map to FINS
    'innertube': 'INNER_TUBE',
    'centeringring': 'CENTERING_RING',
    'parachute': 'PARACHUTE',
    'streamer': 'PARACHUTE',     // Streamer maps to PARACHUTE (simplified)
    'shockcord': 'SHOCK_CORD',
    'engineblock': 'ENGINE_BLOCK',
    'launchlug': 'LAUNCH_LUG',
    'railbutton': 'MASS_COMPONENT',
    'tubecoupler': 'INNER_TUBE',
    'masscomponent': 'MASS_COMPONENT',
    'podset': 'MASS_COMPONENT',  // Pod maps to mass component (simplified)
    'ringcomponent': 'CENTERING_RING',  // Ring component maps to centering ring
    'tubeset': 'INNER_TUBE',     // Tube set maps to inner tube
    'altimeter': 'MASS_COMPONENT',  // Altimeter maps to mass component
    'battery': 'MASS_COMPONENT'   // Battery maps to mass component
  };

  const type = typeMap[typeName];
  if (!type) {
    warnings.push(`Unknown component type: ${typeName}`);
    return null;
  }

  const findDirectChild = (parent: Element, tagName: string): Element | null => {
    for (const child of Array.from(parent.children)) {
      if (child.tagName.toLowerCase() === tagName.toLowerCase()) {
        return child;
      }
      if (child.tagName.toLowerCase() === 'subcomponents') {
        break;
      }
    }
    return null;
  };

  // ============= Improvement: Correctly extract axial_offset and compute absolute position =============
  // If positionPrecomputed=true, parseComponents already resolved the fore position correctly
  // (handling method=top/bottom/middle). Use it directly.
  const axialOffsetText = findDirectChild(element, "axialoffset")?.textContent || "0";
  const axialOffset = parseFloat(axialOffsetText) || 0;
  const absolutePosition = positionPrecomputed ? parentPosition : parentPosition + axialOffset;

  // Extract length for subsequent position calculation
  const lengthText = findDirectChild(element, "length")?.textContent || "0";
  const length = parseFloat(lengthText) || 0;

  // Extract overridesubcomponentsmass
  const overrideSubEl = element.querySelector("overridesubcomponentsmass");
  const overridesSubComponents = overrideSubEl ? overrideSubEl.textContent === 'true' : false;

  // Common attributes - OpenRocket Mass extraction
  // ⚠️ Key: Only search direct children of current element, exclude nested content in subcomponents
  let mass = 0;
  let massSource = '';

  // Improved element lookup: only search before subcomponents tag
  const findChildBeforeSubcomponents = (parent: Element, tagName: string): Element | null => {
    for (const child of Array.from(parent.children)) {
      // If subcomponents encountered, stop search
      if (child.tagName.toLowerCase() === 'subcomponents') {
        break;
      }
      // Found target tag
      if (child.tagName.toLowerCase() === tagName.toLowerCase()) {
        return child;
      }
    }
    return null;
  };

  // Priority 1: overridemass (user manually overridden Mass) - most accurate!
  const overrideMassElement = findChildBeforeSubcomponents(element, "overridemass");
  if (overrideMassElement && overrideMassElement.textContent) {
    const parsedMass = parseFloat(overrideMassElement.textContent);
    // Validate mass is reasonable (OpenRocket may use negative for "unset")
    if (!isNaN(parsedMass) && parsedMass > 0 && parsedMass < 100) { // Reasonable range: 0-100kg
      mass = parsedMass;
      massSource = 'overridemass';
      console.log(`  [${name}] ✅ Using overridemass: ${(mass * 1000).toFixed(1)}g`);
    } else if (!isNaN(parsedMass) && parsedMass < 0) {
      console.log(`  [${name}] ⚠️ overridemass is negative (${(parsedMass * 1000).toFixed(1)}g), ignoring and attempting estimate`);
      mass = -1; // Mark for estimation
    }
  }

  // Priority 2: direct mass tag
  if (mass === 0 && massSource === '') {
    const massElement = findChildBeforeSubcomponents(element, "mass");
    if (massElement && massElement.textContent) {
      const parsedMass = parseFloat(massElement.textContent);
      if (!isNaN(parsedMass) && parsedMass > 0 && parsedMass < 100) {
        mass = parsedMass;
        massSource = 'mass';
        console.log(`  [${name}] ✅ Using mass tag: ${(mass * 1000).toFixed(1)}g`);
      } else if (!isNaN(parsedMass) && parsedMass < 0) {
        console.log(`  [${name}] ⚠️ mass tag is negative (${(parsedMass * 1000).toFixed(1)}g), ignoring and attempting estimate`);
        mass = -1;
      }
    }
  }

  // Priority 3: componentmass tag
  if (mass === 0 && massSource === '') {
    const compMassElement = findChildBeforeSubcomponents(element, "componentmass");
    if (compMassElement && compMassElement.textContent) {
      const parsedMass = parseFloat(compMassElement.textContent);
      if (!isNaN(parsedMass) && parsedMass > 0 && parsedMass < 100) {
        mass = parsedMass;
        massSource = 'componentmass';
        console.log(`  [${name}] ✅ Using componentmass: ${(mass * 1000).toFixed(1)}g`);
      } else if (!isNaN(parsedMass) && parsedMass < 0) {
        console.log(`  [${name}] ⚠️ componentmass is negative (${(parsedMass * 1000).toFixed(1)}g), ignoring and attempting estimate`);
        mass = -1;
      }
    }
  }

  // If still 0, try estimation from geometry and material density
  if (mass === 0) {
    const materialEl = element.querySelector("material");
    const material = materialEl?.textContent || "";
    const materialType = materialEl?.getAttribute("type") || "bulk";

    // Smart material matching (supports partial match and variants)
    const findMaterialDensity = (matName: string, defaultDensity: number): number => {
      if (!matName) return defaultDensity;

      // Exact match
      if (MATERIAL_DENSITIES[matName]) {
        return MATERIAL_DENSITIES[matName];
      }

      // Case-insensitive match
      const lowerMat = matName.toLowerCase();
      for (const [key, value] of Object.entries(MATERIAL_DENSITIES)) {
        if (key.toLowerCase() === lowerMat) {
          return value;
        }
      }

      // Partial match (contains keyword)
      const keywords = ['nylon', 'elastic', 'fiberglass', 'carbon', 'aluminum', 'steel', 'balsa', 'plywood'];
      for (const keyword of keywords) {
        if (lowerMat.includes(keyword)) {
          for (const [key, value] of Object.entries(MATERIAL_DENSITIES)) {
            if (key.toLowerCase().includes(keyword)) {
              console.log(`  [${name}] Material partial match: "${matName}" → "${key}"`);
              return value;
            }
          }
        }
      }

      return defaultDensity;
    };

    if (type === 'PARACHUTE') {
      const diameter = parseFloat(element.querySelector("diameter")?.textContent || "0");
      if (diameter > 0) {
        // Area * density * 1.5 (factor: includes cords etc.)
        const area = Math.PI * Math.pow(diameter / 2, 2);
        const density = findMaterialDensity(material, MATERIAL_DENSITIES['Ripstop Nylon']);
        mass = area * density * 1.5;
        console.log(`  [${name}] Estimated parachute Mass: ${mass.toFixed(4)}kg (D=${diameter}, Mat=${material}, ρ=${density})`);
      }
    } else if (type === 'SHOCK_CORD') {
      const cordLength = parseFloat(element.querySelector("cordlength")?.textContent || "0");
      if (cordLength > 0) {
        // Length * linear density
        const linearDensity = findMaterialDensity(material, MATERIAL_DENSITIES['Elastic cord']);
        mass = cordLength * linearDensity;
        console.log(`  [${name}] Estimated shock cord Mass: ${mass.toFixed(4)}kg (L=${cordLength}, Mat=${material}, ρ=${linearDensity})`);
      }
    } else if (materialType === 'bulk' && material) {
      // For structural components (Nose Cone, Body Tube, Transition, etc.), estimate from geometry and material density
      const density = findMaterialDensity(material, 1000); // Default 1000 kg/m³
      if (density && density > 0) {
        // Volume will be computed in switch by type
        // Mark for estimation here
        mass = -1; // Mark for estimation
      }
    }
  }

  // ============= Improvement: Use absolutePosition as primary position info =============
  // Keep original position system for compatibility, but prefer absolutePosition
  const posElement = findDirectChild(element, "position");
  const axialOffsetEl = findDirectChild(element, "axialoffset");
  let position = axialOffset; // Preserve the original local offset from the ORK file.
  let relativeTo: 'top' | 'bottom' | 'middle' | 'absolute' = 'top';

  if (posElement) {
    // Position value
    const posText = posElement.textContent || "0";
    const relativePosition = parseFloat(posText);

    // Reference point type (OpenRocket: top, bottom, middle, after)
    // after means after parent component, we map to absolute)
    const posType = posElement.getAttribute("type") || posElement.getAttribute("relativeto") || "top";
    relativeTo = (posType === 'after' ? 'absolute' : posType) as 'top' | 'bottom' | 'middle' | 'absolute';

    // OpenRocket also supports "auto" position (auto-calculated), fall back to axial offset semantics.
    if (posText.toLowerCase() === 'auto' || isNaN(relativePosition)) {
      position = axialOffset;
    } else {
      position = relativePosition;
    }
  } else if (axialOffsetEl) {
    const method = axialOffsetEl.getAttribute("method") || 'top';
    relativeTo = (method === 'after' ? 'absolute' : method) as 'top' | 'bottom' | 'middle' | 'absolute';
  }

  // Debug info
  console.log(`  [${name}] Absolute position: ${absolutePosition.toFixed(4)}m, axial_offset: ${axialOffset.toFixed(4)}m, length: ${length.toFixed(4)}m`);

  // Extract color (OpenRocket format may be RGB or hex)
  const colorElement = element.querySelector("color");
  let color = "#cccccc";
  if (colorElement) {
    color = colorElement.textContent || "#cccccc";
  }

  // Component-specific attributes
  let specificProps: any = {};

  switch (type) {
    case 'NOSECONE': {
      // OpenRocket uses aftradius for nose cone base radius
      const aftRadiusElement = element.querySelector("aftradius");
      let baseDiameter = 0.05; // Default
      if (aftRadiusElement && aftRadiusElement.textContent) {
        const radiusText = aftRadiusElement.textContent;
        // Handle "auto 0.028" format
        const radiusMatch = radiusText.match(/(\d+\.?\d*)/);
        if (radiusMatch) {
          baseDiameter = parseFloat(radiusMatch[1]) * 2; // radius → diameter
        }
      }

      const noseLengthElement = element.querySelector("length");
      const noseLength = noseLengthElement && noseLengthElement.textContent ? parseFloat(noseLengthElement.textContent) : 0.1;

      const thicknessElement = element.querySelector("thickness");
      const thickness = thicknessElement && thicknessElement.textContent ? parseFloat(thicknessElement.textContent) : 0.002;

      const shapeElement = element.querySelector("shape");
      const shape = shapeElement && shapeElement.textContent ? shapeElement.textContent : "OGIVE";

      // If mass needs estimation, compute from geometry and material density
      if (mass === -1 || mass === 0) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 1050; // Default plastic density

        // Estimate volume: simplified cone (for ogive shape, slightly smaller volume, approximate)
        // V ≈ (1/3) * π * (D/2)² * L
        const volume = (1 / 3) * Math.PI * Math.pow(baseDiameter / 2, 2) * noseLength;
        // Account for wall thickness: actual volume = outer - inner
        const innerDiameter = Math.max(0, baseDiameter - 2 * thickness);
        const innerVolume = (1 / 3) * Math.PI * Math.pow(innerDiameter / 2, 2) * noseLength;
        const wallVolume = volume - innerVolume;
        mass = wallVolume * density;
        console.log(`  [${name}] Estimated Nose Cone Mass: ${(mass * 1000).toFixed(1)}g (L=${noseLength}, D=${baseDiameter}, t=${thickness}, Mat=${material}, ρ=${density})`);
      }

      specificProps = {
        length: noseLength,
        baseDiameter,
        shape,
        wallThickness: thickness
      };
      break;
    }

    case 'BODYTUBE': {
      // OpenRocket stores radius, we need diameter
      const radiusElement = element.querySelector("radius");
      let diameter = 0.025; // Default
      if (radiusElement && radiusElement.textContent) {
        const radiusText = radiusElement.textContent;
        // Handle "auto 0.025" format
        const radiusMatch = radiusText.match(/(\d+\.?\d*)/);
        if (radiusMatch) {
          diameter = parseFloat(radiusMatch[1]) * 2; // radius → diameter
        }
      }

      const lengthElement = element.querySelector("length");
      const length = lengthElement && lengthElement.textContent ? parseFloat(lengthElement.textContent) : 0.3;

      const thicknessElement = element.querySelector("thickness");
      const thickness = thicknessElement && thicknessElement.textContent ? parseFloat(thicknessElement.textContent) : 0.001;

      // If mass needs estimation, compute from geometry and material density
      if (mass === -1 || mass === 0) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 680; // Default cardboard density

        // Cylinder volume: V = π * L * (R_outer² - R_inner²)
        const rOuter = diameter / 2;
        const rInner = Math.max(0, rOuter - thickness);
        const volume = Math.PI * length * (rOuter * rOuter - rInner * rInner);
        mass = volume * density;
        console.log(`  [${name}] Estimated Body Tube Mass: ${(mass * 1000).toFixed(1)}g (L=${length}, D=${diameter}, t=${thickness}, Mat=${material}, ρ=${density})`);
      }

      specificProps = {
        length,
        diameter,
        thickness
      };
      break;
    }

    case 'TRANSITION': {
      const length = parseFloat(element.querySelector("length")?.textContent || "0.1");

      // Handle "auto X.XXX" format
      const foreRadiusText = element.querySelector("foreradius")?.textContent || "0.02";
      const foreRadiusMatch = foreRadiusText.match(/(\d+\.?\d*)/);
      const foreRadius = foreRadiusMatch ? parseFloat(foreRadiusMatch[1]) : 0.02;

      const aftRadiusText = element.querySelector("aftradius")?.textContent || "0.025";
      const aftRadiusMatch = aftRadiusText.match(/(\d+\.?\d*)/);
      const aftRadius = aftRadiusMatch ? parseFloat(aftRadiusMatch[1]) : 0.025;

      const foreDiameter = foreRadius * 2;
      const aftDiameter = aftRadius * 2;

      // If mass needs estimation, compute from geometry and material density
      if (mass === -1 || mass === 0) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 680; // Default cardboard density
        const thicknessEl = element.querySelector("thickness");
        const thickness = parseFloat(thicknessEl?.textContent || "0.002") || 0.002;

        // Frustum SHELL volume: lateral surface area × wall thickness
        // Slant height: sqrt(L² + (R2 - R1)²)
        const r1 = foreRadius;
        const r2 = aftRadius;
        const slantHeight = Math.sqrt(length * length + (r2 - r1) * (r2 - r1));
        const lateralArea = Math.PI * (r1 + r2) * slantHeight;
        const volume = lateralArea * thickness;
        mass = volume * density;
        console.log(`  [${name}] Estimated Transition Mass: ${(mass * 1000).toFixed(1)}g (L=${length}, D1=${foreDiameter}, D2=${aftDiameter}, t=${thickness}, Mat=${material}, ρ=${density})`);
      }

      specificProps = {
        length,
        foreDiameter,
        aftDiameter
      };
      break;
    }

    case 'FINS': {
      // ============= Improvement: More complete fin data extraction (based on Python) =============
      // OpenRocket fins may use finpoints to define shape
      // Supports multiple fin types: trapezoidfinset, freeformfinset, ellipticalfinset, tubefinset
      const finCount = parseInt(element.querySelector("fincount")?.textContent || "3");
      let rootChord = parseFloat(element.querySelector("rootchord")?.textContent || "0.1");
      let tipChord = parseFloat(element.querySelector("tipchord")?.textContent || "0.05");
      let height = parseFloat(element.querySelector("height")?.textContent || "0.08");
      let sweep = parseFloat(element.querySelector("sweeplength")?.textContent || "0.03");
      const finThickness = parseFloat(element.querySelector("thickness")?.textContent || "0.003");

      // Improvement: Extract complete fin data (similar to Python fin_data)
      const finData: any = {
        count: finCount,
        root: rootChord,
        tip: tipChord,
        span: height,
        sweep: sweep,
        thickness: finThickness
      };

      // For Freeform/Elliptical/Tube Fins, extract accurate Barrowman parameters from finpoints
      if (typeName === 'freeformfinset' || typeName === 'ellipticalfinset' || typeName === 'tubefinset') {
        const finpoints = element.querySelector("finpoints");
        if (finpoints) {
          const pointEls = finpoints.querySelectorAll("point");
          if (pointEls.length >= 3) {
            // Parse all fin vertices
            const pts: Array<{x: number, y: number}> = [];
            pointEls.forEach(point => {
              const x = parseFloat(point.getAttribute("x") || point.querySelector("x")?.textContent || "0");
              const y = parseFloat(point.getAttribute("y") || point.querySelector("y")?.textContent || "0");
              pts.push({x, y});
            });

            // --- Extract Barrowman trapezoidal parameters from freeform geometry ---
            // 1) Root chord: distance between points at y ≈ 0 (body surface)
            const rootPts = pts.filter(p => Math.abs(p.y) < 0.001);
            if (rootPts.length >= 2) {
              const xMin = Math.min(...rootPts.map(p => p.x));
              const xMax = Math.max(...rootPts.map(p => p.x));
              rootChord = xMax - xMin;
            } else {
              rootChord = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
            }

            // 2) Span (height): max y value
            height = Math.max(...pts.map(p => p.y));
            const yMax = height;

            // 3) Compute planform area using Shoelace formula
            let planformArea = 0;
            for (let i = 0; i < pts.length; i++) {
              const j = (i + 1) % pts.length;
              planformArea += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
            }
            planformArea = Math.abs(planformArea) / 2;

            // 4) Tip chord: use area-equivalent trapezoidal tip chord for Barrowman
            // Freeform fins often have pointed or irregular tips. The area-equivalent
            // tip chord gives the best trapezoidal approximation for Barrowman:
            //   Area = (Cr + Ct) * s / 2  →  Ct = 2*Area/s - Cr
            if (planformArea > 0 && height > 0 && rootChord > 0) {
              tipChord = Math.max(0, (2 * planformArea / height) - rootChord);
              console.log(`  [Freeform Fin] Area-equivalent tipChord: ${(tipChord * 1000).toFixed(1)}mm (planform area=${(planformArea*10000).toFixed(2)}cm²)`);
            } else {
              tipChord = 0;
            }

            // 5) Sweep: interpolate leading edge x at 2/3 span
            // For Barrowman with freeform shapes, sweep at 2/3 span gives the best
            // CP approximation (matches OpenRocket's integrated Barrowman closely).
            const rootLeadingX = rootPts.length > 0 ? Math.min(...rootPts.map(p => p.x)) : 0;

            // Build leading edge path by walking the fin boundary (left side at each y)
            // The fin points define a closed polygon; the leading edge is the leftmost x at each y
            const sweepRefY = yMax * (2.0 / 3.0); // 2/3 span

            // Interpolate leading edge x at sweepRefY by walking consecutive point pairs
            let sweepLeadingX = rootLeadingX;
            let foundSweepRef = false;
            for (let i = 0; i < pts.length; i++) {
              const j = (i + 1) % pts.length;
              const p0 = pts[i];
              const p1 = pts[j];
              // Check if this edge crosses sweepRefY
              const yLo = Math.min(p0.y, p1.y);
              const yHi = Math.max(p0.y, p1.y);
              if (yLo <= sweepRefY && yHi > sweepRefY) {
                const t = (sweepRefY - p0.y) / (p1.y - p0.y);
                const interpX = p0.x + t * (p1.x - p0.x);
                if (!foundSweepRef || interpX < sweepLeadingX) {
                  sweepLeadingX = interpX;
                  foundSweepRef = true;
                }
              }
            }
            sweep = sweepLeadingX - rootLeadingX;
            // Ensure sweep is non-negative
            if (sweep < 0) sweep = 0;

            console.log(`  [Freeform Fin] Points: ${pts.length}, rootChord=${(rootChord*1000).toFixed(1)}mm, tipChord=${(tipChord*1000).toFixed(1)}mm, span=${(height*1000).toFixed(1)}mm, sweep=${(sweep*1000).toFixed(1)}mm, area=${(planformArea*10000).toFixed(2)}cm²`);

            // Update finData to match the computed freeform values (fixes stale default bug)
            finData.root = rootChord;
            finData.tip = tipChord;
            finData.span = height;
            finData.sweep = sweep;
          }
        }

        // If still no valid value, try other possible tags
        if (rootChord <= 0) {
          const chordEl = element.querySelector("chord") || element.querySelector("rootchord");
          if (chordEl) rootChord = parseFloat(chordEl.textContent || "0.1");
        }
        if (height <= 0) {
          const spanEl = element.querySelector("span") || element.querySelector("height");
          if (spanEl) height = parseFloat(spanEl.textContent || "0.08");
        }
      }

      // If no mass or marked for estimation, estimate from geometry and material density
      if (mass === 0 || mass === -1) {
        const needsEstimation = mass === -1;
        console.log(`  [${name}] ⚠️ Fins mass ${needsEstimation ? 'needs estimation' : 'is 0'}, attempting estimate...`);
        console.log(`    Initial params: rootChord=${rootChord}, height=${height}, tipChord=${tipChord}, finCount=${finCount}`);

        // If rootChord or height is 0, try getting from other tags
        if (rootChord <= 0) {
          const chordEl = element.querySelector("chord") || element.querySelector("rootchord");
          if (chordEl) {
            rootChord = parseFloat(chordEl.textContent || "0");
            console.log(`    Got rootChord from chord tag: ${rootChord}`);
          }
        }
        if (height <= 0) {
          const spanEl = element.querySelector("span") || element.querySelector("height");
          if (spanEl) {
            height = parseFloat(spanEl.textContent || "0");
            console.log(`    Got height from span tag: ${height}`);
          }
        }

        // If still no valid value, use defaults for estimation
        if (rootChord <= 0) {
          rootChord = 0.1; // Default 10cm
          console.log(`    Using default rootChord: ${rootChord}`);
        }
        if (height <= 0) {
          height = 0.08; // Default 8cm
          console.log(`    Using default height: ${height}`);
        }
        if (tipChord <= 0) {
          tipChord = rootChord * 0.5; // Default is half of rootChord
          console.log(`    Using default tipChord: ${tipChord}`);
        }

        // Simplified estimate: area * thickness * density * fin count
        const area = 0.5 * (rootChord + tipChord) * height;
        const volume = area * finThickness * finCount;

        // Try to get density from material
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        let density = 700; // kg/m³ (plywood typical default)

        // Smart material matching
        if (material) {
          const lowerMat = material.toLowerCase();
          if (lowerMat.includes('plywood') || lowerMat.includes('birch')) {
            density = 650; // Birch plywood
          } else if (lowerMat.includes('balsa')) {
            density = 150;
          } else if (lowerMat.includes('basswood')) {
            density = 420;
          } else if (lowerMat.includes('fiberglass') || lowerMat.includes('carbon')) {
            density = 1600;
          } else if (MATERIAL_DENSITIES[material]) {
            density = MATERIAL_DENSITIES[material];
          }
        }

        mass = volume * density;
        console.log(`  [${name}] ✅ Estimated fin Mass: ${(mass * 1000).toFixed(1)}g`);
        console.log(`    Params: type=${typeName}, rootChord=${rootChord.toFixed(3)}m, height=${height.toFixed(3)}m, tipChord=${tipChord.toFixed(3)}m`);
        console.log(`    Calc: area=${(area * 10000).toFixed(1)}cm², volume=${(volume * 1000000).toFixed(1)}cm³, material=${material || 'default'}, ρ=${density}kg/m³`);
      } else if (mass > 0) {
        console.log(`  [${name}] ✅ Fins mass extracted from file: ${(mass * 1000).toFixed(1)}g`);
      }

      specificProps = {
        finCount,
        rootChord,
        tipChord,
        height,
        sweep,
        thickness: finThickness,
        finData // Store complete fin data
      };
      break;
    }

    case 'INNER_TUBE': {
      const length = parseFloat(element.querySelector("length")?.textContent || "0.15");
      const radiusText =
        element.querySelector("outerradius")?.textContent ||
        element.querySelector("radius")?.textContent ||
        "0.012";
      const radiusMatch = radiusText.match(/(\d+\.?\d*(?:E[+-]?\d+)?)/i);
      const radius = radiusMatch ? parseFloat(radiusMatch[1]) : 0.012;
      const diameter = radius * 2;
      const thickness = parseFloat(element.querySelector("thickness")?.textContent || "0.001");

      // If mass needs estimation, compute from geometry and material density
      if (mass === -1 || mass === 0) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 680; // Default cardboard density

        // Cylinder volume: V = π * L * (R_outer² - R_inner²)
        // For inner tube, wall usually thin, simplify: V ≈ π * L * D * t
        const rOuter = radius;
        const rInner = Math.max(0, rOuter - thickness);
        const volume = Math.PI * length * (rOuter * rOuter - rInner * rInner);
        mass = volume * density;
        console.log(`  [${name}] Estimated Inner Tube Mass: ${(mass * 1000).toFixed(1)}g (L=${length}, D=${diameter}, t=${thickness}, Mat=${material}, ρ=${density})`);
      }

      const isMotorMount = !!element.querySelector("motormount");

      specificProps = {
        length,
        diameter,
        thickness,
        isMotorMount
      };
      break;
    }

    case 'CENTERING_RING': {
      const ringThickness = parseFloat(element.querySelector("length")?.textContent || "0.003");

      // Try multiple possible tag names (OpenRocket may use different naming)
      let outerRadius = parseFloat(element.querySelector("outerradius")?.textContent || "0");
      let innerRadius = parseFloat(element.querySelector("innerradius")?.textContent || "0");

      // If not found, try other possible tags
      if (isNaN(outerRadius) || outerRadius === 0) {
        const outerRadEl = element.querySelector("outerRadius") || element.querySelector("outer_radius");
        if (outerRadEl?.textContent) outerRadius = parseFloat(outerRadEl.textContent);
      }

      if (isNaN(innerRadius) || innerRadius === 0) {
        const innerRadEl = element.querySelector("innerRadius") || element.querySelector("inner_radius");
        if (innerRadEl?.textContent) innerRadius = parseFloat(innerRadEl.textContent);
      }

      // If still cannot parse, infer from radius tag (assume outer diameter)
      if (isNaN(outerRadius) || outerRadius === 0) {
        const radiusEl = element.querySelector("radius");
        if (radiusEl?.textContent) {
          outerRadius = parseFloat(radiusEl.textContent);
          // Assume inner radius is 50% of outer (typical)
          if (isNaN(innerRadius) || innerRadius === 0) {
            innerRadius = outerRadius * 0.5;
          }
        }
      }

      // Final check: ensure both values valid
      if (isNaN(outerRadius) || outerRadius === 0) {
        outerRadius = 0.025; // Default outer radius 5cm
        console.warn(`  [${name}] Cannot parse outerRadius, using default: ${outerRadius * 2}m`);
      }
      if (isNaN(innerRadius) || innerRadius === 0) {
        innerRadius = 0.012; // Default inner radius 2.4cm (fits 24mm motor)
        console.warn(`  [${name}] Cannot parse innerRadius, using default: ${innerRadius * 2}m`);
      }

      // If mass needs estimation, compute from geometry and material density
      if (mass === -1 || mass === 0) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 600; // Default plywood density

        // Ring volume: V = π * t * (R_outer² - R_inner²)
        const volume = Math.PI * ringThickness * (outerRadius * outerRadius - innerRadius * innerRadius);
        mass = volume * density;

        // Validate mass is valid
        if (isNaN(mass) || mass < 0) {
          console.warn(`  [${name}] Estimated mass invalid (NaN or negative), set to 0`);
          mass = 0;
        } else {
          console.log(`  [${name}] Estimated Centering Ring Mass: ${(mass * 1000).toFixed(1)}g (t=${ringThickness}, D_outer=${outerRadius * 2}, D_inner=${innerRadius * 2}, Mat=${material}, ρ=${density})`);
        }
      }

      specificProps = {
        outerDiameter: outerRadius * 2,
        innerDiameter: innerRadius * 2,
        thickness: ringThickness
      };
      break;
    }

    case 'PARACHUTE': {
      const packedLength = parseFloat(element.querySelector("packedlength")?.textContent || "0.1");
      const packedDiameter = parseFloat(element.querySelector("packeddiameter")?.textContent || "0.05");
      const lineLength = parseFloat(element.querySelector("linelength")?.textContent || "0.5");
      specificProps = {
        diameter: parseFloat(element.querySelector("diameter")?.textContent || "0.5"),
        cd: parseFloat(element.querySelector("cd")?.textContent || "1.5"),
        deployAltitude: parseFloat(element.querySelector("deployaltitude")?.textContent || "0"),
        packedLength,
        packedDiameter,
        lineLength
      };
      break;
    }

    case 'SHOCK_CORD': {
      specificProps = {
        length: parseFloat(element.querySelector("cordlength")?.textContent || "1.0")
      };
      break;
    }

    case 'MASS_COMPONENT': {
      if (typeName === 'railbutton') {
        const outerDiameter = parseFloat(element.querySelector("outerdiameter")?.textContent || "0.0097");
        const innerDiameter = parseFloat(element.querySelector("innerdiameter")?.textContent || "0.008");
        const height = parseFloat(element.querySelector("height")?.textContent || "0.0097");
        const baseHeight = parseFloat(element.querySelector("baseheight")?.textContent || "0.002");
        const flangeHeight = parseFloat(element.querySelector("flangeheight")?.textContent || "0.002");
        const instanceCount = parseInt(element.querySelector("instancecount")?.textContent || "1");
        const effectiveHeight = Math.max(height + baseHeight + flangeHeight, 0.004);

        if (mass === -1 || mass === 0) {
          const materialEl = element.querySelector("material");
          const density =
            parseFloat(materialEl?.getAttribute("density") || "") ||
            MATERIAL_DENSITIES[materialEl?.textContent || "Delrin"] ||
            1420;
          const outerRadius = outerDiameter / 2;
          const innerRadius = innerDiameter / 2;
          const singleVolume = Math.PI * effectiveHeight * Math.max(0, outerRadius * outerRadius - innerRadius * innerRadius * 0.35);
          mass = singleVolume * density * Math.max(instanceCount, 1);
          console.log(`  [${name}] Estimated Rail Button Mass: ${(mass * 1000).toFixed(1)}g (count=${instanceCount}, OD=${outerDiameter}, ID=${innerDiameter}, h=${effectiveHeight})`);
        }

        specificProps = {
          componentMass: mass,
          length: effectiveHeight,
          diameter: outerDiameter
        };
      } else {
        specificProps = {
          componentMass: mass
        };
      }
      break;
    }

    case 'ENGINE_BLOCK': {
      // Engine Block is typically small wood or plastic block to secure motor
      const length = parseFloat(element.querySelector("length")?.textContent || "0.01");
      const radius = parseFloat(element.querySelector("radius")?.textContent || "0.012");

      // If mass needs estimation (mass === 0 or mass === -1)
      if (mass === 0 || mass === -1) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 600; // Default plywood density

        // Cylinder volume: V = π * r² * L
        const volume = Math.PI * radius * radius * length;
        mass = volume * density;
        console.log(`  [${name}] Estimated Engine Block Mass: ${(mass * 1000).toFixed(1)}g (L=${length}, R=${radius}, Mat=${material || 'default'})`);
      }

      specificProps = {
        length,
        diameter: radius * 2
      };
      break;
    }

    case 'LAUNCH_LUG': {
      // Launch Lug is typically small cylinder to guide rocket on launch rod
      const length = parseFloat(element.querySelector("length")?.textContent || "0.02");
      const radius = parseFloat(element.querySelector("radius")?.textContent || "0.003");

      // If mass needs estimation (mass === 0 or mass === -1)
      if (mass === 0 || mass === -1) {
        const materialEl = element.querySelector("material");
        const material = materialEl?.textContent || "";
        const density = MATERIAL_DENSITIES[material] || 1050; // Default plastic density

        // Cylinder volume: V = π * L * (R_outer² - R_inner²)
        // For Launch Lug, wall usually thin, simplify: V ≈ π * L * D * t
        const thickness = parseFloat(element.querySelector("thickness")?.textContent || "0.001");
        const rOuter = radius;
        const rInner = Math.max(0, rOuter - thickness);
        const volume = Math.PI * length * (rOuter * rOuter - rInner * rInner);
        mass = volume * density;
        console.log(`  [${name}] Estimated Launch Lug Mass: ${(mass * 1000).toFixed(1)}g (L=${length}, R=${radius}, t=${thickness}, Mat=${material || 'default'})`);
      }

      specificProps = {
        length,
        diameter: radius * 2
      };
      break;
    }

    // Extended component type support
  }

  // If mass still -1 (marked for estimation but not handled), set to 0 (these small components usually have tiny mass)
  if (mass === -1) {
    console.log(`  [${name}] Warning: Mass estimation not implemented for ${type}, setting to 0`);
    mass = 0;
  }

  // Ensure mass is not negative
  if (mass < 0) {
    console.warn(`  [${name}] Warning: Negative mass (${mass}kg) detected, setting to 0`);
    mass = 0;
  }

  // ============= Improvement: Recursively parse subcomponents, pass absolute position =============
  // Subcomponent parent position = current component absolute position
  const subComponents = parseComponents(element, warnings, absolutePosition);

  // Compute component absolute position (based on OpenRocket position system)
  // This value used in subsequent CG/CP calculation
  const component: RocketComponent = {
    id,
    type,
    name,
    mass,
    position,
    color,
    subComponents,
    overridesSubComponents,
    relativeTo,
    ...specificProps
  };

  // Store extra position info for debugging
  (component as any).axialOffset = axialOffset;
  (component as any).absolutePosition = absolutePosition;

  // Validate component data
  if (mass < 0) {
    console.warn(`  [${name}] Warning: Negative mass (${mass}kg), setting to 0`);
    component.mass = 0;
  }

  // Validate geometry params
  if (type === 'BODYTUBE' && (component as any).diameter <= 0) {
    warnings.push(`${name}: BodyTube diameter is invalid (${(component as any).diameter})`);
  }
  if (type === 'NOSECONE' && (component as any).baseDiameter <= 0) {
    warnings.push(`${name}: NoseCone baseDiameter is invalid (${(component as any).baseDiameter})`);
  }
  if (type === 'FINS' && (component as any).finCount <= 0) {
    warnings.push(`${name}: FinSet finCount is invalid (${(component as any).finCount})`);
  }

  return component;
};

// ============= Parse simulation config =============
const parseSimulationConfig = (root: Element): { launchRodLength?: number, windSpeed?: number, timeStep?: number, cg?: number, cp?: number, referenceLength?: number, referenceType?: string } => {
  const config: { launchRodLength?: number, windSpeed?: number, timeStep?: number, cg?: number, cp?: number, referenceLength?: number, referenceType?: string } = {};

  // 1. Try extracting from simulationconfiguration
  const simConfig = root.querySelector("simulationconfiguration");
  if (simConfig) {
    const rodLenEl = simConfig.querySelector("launchrodlength");
    if (rodLenEl && rodLenEl.textContent) config.launchRodLength = parseFloat(rodLenEl.textContent);

    const timeStepEl = simConfig.querySelector("timestep");
    if (timeStepEl && timeStepEl.textContent) config.timeStep = parseFloat(timeStepEl.textContent);

    const windSpeedEl = simConfig.querySelector("windspeed") || simConfig.querySelector("windSpeedaverage");
    if (windSpeedEl && windSpeedEl.textContent) config.windSpeed = parseFloat(windSpeedEl.textContent);
  }

  // 2. Try extracting CG/CP from simulations results (if any)
  // OpenRocket sometimes stores in <simulations> -> <simulation> -> <flightdata>, but too complex.
  // We focus on <rocket> or <stage> override values.

  // 3. Search globally for possible CG/CP definitions
  // Sometimes stage has <cg> or <cp> tag as override
  const rocket = root.querySelector("rocket");
  if (rocket) {
    // Check for directly defined cg/cp (usually overrides)
    const cgEl = rocket.querySelector("cg");
    if (cgEl && cgEl.textContent) config.cg = parseFloat(cgEl.textContent);

    const cpEl = rocket.querySelector("cp");
    if (cpEl && cpEl.textContent) config.cp = parseFloat(cpEl.textContent);

    // Extract referenceLength and referenceType (for stability calculation)
    const refLenEl = rocket.querySelector("referencelength");
    if (refLenEl && refLenEl.textContent) {
      config.referenceLength = parseFloat(refLenEl.textContent);
    }

    const refTypeEl = rocket.querySelector("referencetype");
    if (refTypeEl && refTypeEl.textContent) {
      config.referenceType = refTypeEl.textContent.toLowerCase();
    }
  }

  console.log("Parsed config (incl. CG/CP/referenceLength):", config);
  return config;
};

// ============= Parse Motor config =============
const parseMotorConfiguration = (rocket: Element, warnings: string[], configData: { cd?: number } = {}) => {
  // Find the default motor configuration first; fall back to the first config if needed.
  const motorConfigs = Array.from(rocket.querySelectorAll("motorconfiguration"));
  const defaultMotorConfig = motorConfigs.find(mc => mc.getAttribute("default") === "true") || motorConfigs[0] || null;
  const defaultConfigId = defaultMotorConfig?.getAttribute("configid") || null;

  const allMotors = Array.from(rocket.querySelectorAll("motor"));
  const motor = defaultConfigId
    ? allMotors.find(m => m.getAttribute("configid") === defaultConfigId) || allMotors[0] || null
    : allMotors[0] || null;

  if (defaultConfigId) {
    console.log(`Using default motor configuration: ${defaultConfigId}`);
  }

  // Calculate totalImpulse for default motor
  const defaultThrustCurve = [
    { time: 0, thrust: 0 },
    { time: 0.05, thrust: 60 },
    { time: 0.2, thrust: 35 },
    { time: 1.4, thrust: 28 },
    { time: 1.6, thrust: 0 }
  ];
  let defaultTotalImpulse = 0;
  for (let i = 1; i < defaultThrustCurve.length; i++) {
    const dt = defaultThrustCurve[i].time - defaultThrustCurve[i - 1].time;
    const avgThrust = (defaultThrustCurve[i].thrust + defaultThrustCurve[i - 1].thrust) / 2;
    defaultTotalImpulse += avgThrust * dt;
  }

  let motorData = {
    motor: {
      name: "Default F-class",
      manufacturer: "",
      diameter: 0.029,
      length: 0.114,
      totalMass: 0.104,
      propellantMass: 0.0623,
      burnTime: 1.6,
      totalImpulse: defaultTotalImpulse,
      averageThrust: 30,
      maxThrust: 60,
      thrustCurve: defaultThrustCurve
    } as MotorData,
    cd: 0.5
  };

  if (motor) {
    const designation = motor.querySelector("designation")?.textContent || "Unknown";
    const manufacturer = motor.querySelector("manufacturer")?.textContent || "";
    const diameter = parseFloat(motor.querySelector("diameter")?.textContent || "0.024");
    const length = parseFloat(motor.querySelector("length")?.textContent || "0.07");
    const totalMass = parseFloat(motor.querySelector("mass")?.textContent || "0.021");
    const propellantMass = parseFloat(motor.querySelector("propellantmass")?.textContent || "0.0089");
    const burnTime = parseFloat(motor.querySelector("burntime")?.textContent || "1.0");
    const delayTime = parseFloat(motor.querySelector("delay")?.textContent || motor.querySelector("delaytime")?.textContent || "0");

    // Enhanced thrust curve parsing
    const thrustCurve: Array<{ time: number, thrust: number }> = [];

    // Try multiple possible thrust curve tag names (OpenRocket versions may differ)
    const possibleThrustCurveTags = [
      'datapoint',      // Standard format
      'thrustpoint',    // Variant 1
      'point',          // Variant 2
      'data',           // Variant 3
      'thrustcurve',    // Container tag
    ];

    let dataPoints: NodeListOf<Element> | null = null;
    for (const tagName of possibleThrustCurveTags) {
      const points = motor.querySelectorAll(tagName);
      if (points.length > 0) {
        dataPoints = points;
        console.log(`Found thrust curve data points (${tagName}): ${points.length} points`);
        break;
      }
    }

    if (dataPoints && dataPoints.length > 0) {
      // Parse data points (supports multiple formats)
      dataPoints.forEach((point, idx) => {
        // Try multiple possible attribute names
        let time = 0;
        let thrust = 0;

        // Method 1: child element tags
        const timeEl = point.querySelector("time") || point.querySelector("t");
        const thrustEl = point.querySelector("thrust") || point.querySelector("f") || point.querySelector("force");

        if (timeEl) time = parseFloat(timeEl.textContent || "0");
        if (thrustEl) thrust = parseFloat(thrustEl.textContent || "0");

        // Method 2: attributes
        if (time === 0) time = parseFloat(point.getAttribute("time") || point.getAttribute("t") || "0");
        if (thrust === 0) thrust = parseFloat(point.getAttribute("thrust") || point.getAttribute("f") || "0");

        // Method 3: text content (may be space or comma separated)
        if (time === 0 || thrust === 0) {
          const text = point.textContent?.trim() || "";
          const parts = text.split(/[\s,;]+/).filter(p => p);
          if (parts.length >= 2) {
            time = parseFloat(parts[0]) || time;
            thrust = parseFloat(parts[1]) || thrust;
          }
        }

        if (time >= 0 && thrust >= 0) {
          thrustCurve.push({ time, thrust });
        } else {
          console.warn(`Thrust curve point ${idx} parse failed: time=${time}, thrust=${thrust}`);
        }
      });

      // Sort (by time)
      thrustCurve.sort((a, b) => a.time - b.time);

      // Validate and clean
      if (thrustCurve.length > 0) {
        // Ensure first point at t=0
        if (thrustCurve[0].time > 0.01) {
          thrustCurve.unshift({ time: 0, thrust: 0 });
        }
        // Ensure last point at burnTime
        const lastPoint = thrustCurve[thrustCurve.length - 1];
        if (lastPoint.time < burnTime * 0.95) {
          thrustCurve.push({ time: burnTime, thrust: 0 });
        }

        console.log(`✅ Thrust curve parse success: ${thrustCurve.length} points`);
        console.log(`   Time range: ${thrustCurve[0].time}s - ${thrustCurve[thrustCurve.length - 1].time}s`);
        console.log(`   Thrust range: ${Math.min(...thrustCurve.map(p => p.thrust))}N - ${Math.max(...thrustCurve.map(p => p.thrust))}N`);
      }
    }

    // If no detailed curve, use average thrust to create simplified curve
    if (thrustCurve.length === 0) {
      const designationThrustMatch = designation.match(/^[A-Z](\d{1,3})/i);
      const inferredAvgThrust = designationThrustMatch ? parseFloat(designationThrustMatch[1]) : 10;
      const avgThrust = parseFloat(
        motor.querySelector("averagethrust")?.textContent ||
        motor.querySelector("avgthrust")?.textContent ||
        motor.querySelector("commonaverage")?.textContent ||
        `${inferredAvgThrust}`
      );
      const maxThrustText = motor.querySelector("maxthrust")?.textContent;
      const maxThrust = maxThrustText ? parseFloat(maxThrustText) : avgThrust * 1.5;

      console.warn(`⚠️ No thrust curve data points found, using average thrust to create simplified curve`);
      console.warn(`   Average thrust: ${avgThrust}N, max thrust: ${maxThrust}N`);

      // Create more realistic simplified curve (account for startup peak)
      thrustCurve.push(
        { time: 0, thrust: 0 },
        { time: 0.05, thrust: maxThrust },  // Startup peak
        { time: 0.1, thrust: avgThrust * 1.2 },
        { time: burnTime * 0.5, thrust: avgThrust },
        { time: burnTime * 0.9, thrust: avgThrust * 0.8 },
        { time: burnTime, thrust: 0 }
      );
    }

    // Calculate totalImpulse from thrust curve (area under curve)
    let totalImpulse = 0;
    if (thrustCurve.length > 1) {
      for (let i = 1; i < thrustCurve.length; i++) {
        const dt = thrustCurve[i].time - thrustCurve[i - 1].time;
        const avgThrust = (thrustCurve[i].thrust + thrustCurve[i - 1].thrust) / 2;
        totalImpulse += avgThrust * dt;
      }
    } else {
      // Fallback: estimate from average thrust and burn time
      const avgThrust = parseFloat(motor.querySelector("averagethrust")?.textContent || "10");
      totalImpulse = avgThrust * burnTime;
    }

    const displayDesignation =
      delayTime > 0 && !designation.includes('-')
        ? `${designation}-${Math.round(delayTime)}`
        : designation;

    motorData.motor = {
      name: displayDesignation,
      manufacturer,
      diameter,
      length,
      totalMass,
      propellantMass,
      burnTime,
      delayTime,
      totalImpulse,
      averageThrust: parseFloat(
        motor.querySelector("averagethrust")?.textContent ||
        motor.querySelector("avgthrust")?.textContent ||
        motor.querySelector("commonaverage")?.textContent ||
        (designation.match(/^[A-Z](\d{1,3})/i)?.[1] || "10")
      ),
      maxThrust: parseFloat(motor.querySelector("maxthrust")?.textContent || "15"),
      thrustCurve
    } as MotorData;

    console.log(`✅ Motor parse success: ${designation}`);
    console.log(`   Average thrust: ${motorData.motor.averageThrust}N, burn time: ${burnTime}s`);
    console.log(`   Thrust curve data points: ${thrustCurve.length}`);
    if (thrustCurve.length > 0) {
      console.log(`   Thrust range: ${Math.min(...thrustCurve.map(p => p.thrust))}N - ${Math.max(...thrustCurve.map(p => p.thrust))}N`);
    }

    // ⚠️ CRITICAL FIX: Improved Database Fallback Logic
    // Problem: .ork files often lack <averagethrust> tag, causing default 10N to be used.
    // Solution: Always try database match for known motors, especially F-class and above.

    const isLowQualityData =
      thrustCurve.length < 3 ||
      motorData.motor.averageThrust < 5 ||
      (motorData.motor.averageThrust === 10 && designation.match(/^[F-M]/i)); // Default 10N is suspicious for F+ motors

    const shouldTryDatabase =
      isLowQualityData ||
      designation.match(/^[F-M]/i); // Always check database for F-class and above

    if (shouldTryDatabase) {
      console.warn(`⚠️ Attempting to match Motor '${designation}' from database...`);
      let dbMotor = findMotorByDesignation(designation);

      /**
       * Enhanced motor matching logic
       * Handles various naming formats:
       * - "F42-8T", "F42T-8", "F42T" → matches "AeroTech F42T"
       * - "F32-6", "F32T-6" → matches "AeroTech F32T"
       * - "AeroTech F42T-8" → matches "AeroTech F42T"
       */

      // Normalize the designation: extract core motor code
      // Remove manufacturer name, delays, and normalize separators
      const normalizeMotorName = (name: string): string => {
        let normalized = name
          .toUpperCase()
          .replace(/AEROTECH|ESTES|CESARONI|APOGEE|QUEST/gi, '') // Remove manufacturer
          .replace(/\s+/g, '') // Remove spaces (e.g., "F42 8T" → "F428T")
          .replace(/[-_]/g, '') // Remove separators
          .trim();

        // Handle special cases where delay is embedded after motor code
        // "F428T" → "F42T" (remove middle digit that's the delay)
        // "F3210T" → "F32T"
        normalized = normalized
          .replace(/([A-Z])(\d{2,3})(\d)([A-Z])$/, '$1$2$4') // F428T → F42T, F3210T → F32T
          .replace(/([A-Z])(\d{1,2})T(\d+)$/, '$1$2T'); // F42T8 → F42T

        return normalized;
      };

      const normalizedDesignation = normalizeMotorName(designation);
      console.log(`   Normalized name: ${designation} → ${normalizedDesignation}`);

      // Try exact match first
      if (!dbMotor) {
        dbMotor = MOTOR_DATABASE.find(m => {
          const normalizedDbName = normalizeMotorName(m.name);
          return normalizedDbName === normalizedDesignation;
        });
      }

      // Try fuzzy match (allow for slight variations)
      if (!dbMotor) {
        // Extract just the class and thrust code (e.g., "F42T")
        const corePattern = normalizedDesignation.match(/([A-M]\d{1,3}[A-Z]?)/i);
        if (corePattern) {
          const core = corePattern[1];
          console.log(`   Trying core match: ${core}`);
          dbMotor = MOTOR_DATABASE.find(m => {
            const normalizedDbName = normalizeMotorName(m.name);
            return normalizedDbName.includes(core) || core.includes(normalizedDbName);
          });
        }
      }

      // Last resort: try original partial match
      if (!dbMotor) {
        const motorCore = designation.split('-')[0].toUpperCase();
        console.log(`   Trying partial match: ${motorCore}`);
        dbMotor = MOTOR_DATABASE.find(m => {
          const dbCore = m.name.toUpperCase().split(/[-\s]/)[m.name.includes(' ') ? 1 : 0];
          return dbCore.includes(motorCore) || motorCore.includes(dbCore);
        });
      }

      if (dbMotor) {
        console.log(`✅ Database match successful: '${designation}' → ${dbMotor.name}`);
        console.log(`   Manufacturer: ${dbMotor.manufacturer || 'N/A'}, average thrust: ${dbMotor.averageThrust}N, burn time: ${dbMotor.burnTime}s`);
        console.log(`   DB propellant Mass: ${(dbMotor.propellantMass * 1000).toFixed(1)}g, Motor total Mass: ${(dbMotor.totalMass * 1000).toFixed(1)}g`);
        console.log(`   .ork file propellant Mass: ${(motorData.motor.propellantMass * 1000).toFixed(1)}g, Motor total Mass: ${(motorData.motor.totalMass * 1000).toFixed(1)}g`);

        // ⚠️ CRITICAL FIX: When using database thrust data, also use database mass data
        // The .ork file often has incomplete or incorrect motor mass data.
        // Only use parsed mass if it's significantly MORE than database (user might have modified it).
        const shouldUseDbPropMass =
          motorData.motor.propellantMass < dbMotor.propellantMass * 0.8 || // .ork mass is suspiciously low
          motorData.motor.propellantMass < 0.015; // Less than 15g is almost certainly wrong for F-class

        const shouldUseDbTotalMass =
          motorData.motor.totalMass < dbMotor.totalMass * 0.8 ||
          motorData.motor.totalMass < 0.03; // Less than 30g is suspicious for F-class

        const finalPropMass = shouldUseDbPropMass ? dbMotor.propellantMass : motorData.motor.propellantMass;
        const finalTotalMass = shouldUseDbTotalMass ? dbMotor.totalMass : motorData.motor.totalMass;

        if (shouldUseDbPropMass) {
          console.warn(`   ⚠️ .ork propellant Mass too low, using DB value: ${(dbMotor.propellantMass * 1000).toFixed(1)}g`);
        }
        if (shouldUseDbTotalMass) {
          console.warn(`   ⚠️ .ork Motor total Mass too low, using DB value: ${(dbMotor.totalMass * 1000).toFixed(1)}g`);
        }

        motorData.motor = {
          ...dbMotor,
          totalMass: finalTotalMass,
          propellantMass: finalPropMass
        } as MotorData;

        console.log(`   ✅ Final values: Propellant ${(finalPropMass * 1000).toFixed(1)}g, total Mass ${(finalTotalMass * 1000).toFixed(1)}g`);
      } else {
        console.warn(`❌ Not found in database '${designation}'`);
        if (isLowQualityData) {
          console.warn(`   Data Mass low, simulation results may be inaccurate!`);
        }
      }
    }

  } else {
    warnings.push("No motor found in .ork file, using default motor");
  }

  // Enhanced Cd extraction (from multiple locations, by priority)
  let cd = 0.5; // Default
  let cdSource = 'default';
  const cdCandidates: Array<{ value: number, source: string }> = [];

  // Priority 1: stage overridecd (most accurate, user manual)
  if (configData.cd && configData.cd > 0) {
    cdCandidates.push({ value: configData.cd, source: 'stage/overridecd' });
  }

  // Priority 2: rocket overridecd
  const rocketOverrideCd = rocket.querySelector("overridecd");
  if (rocketOverrideCd && rocketOverrideCd.textContent) {
    const val = parseFloat(rocketOverrideCd.textContent);
    if (!isNaN(val) && val > 0) {
      cdCandidates.push({ value: val, source: 'rocket/overridecd' });
    }
  }

  // Priority 3: rocket direct cd tag
  const rocketCd = rocket.querySelector("cd");
  if (rocketCd && rocketCd.textContent) {
    const val = parseFloat(rocketCd.textContent);
    if (!isNaN(val) && val > 0) {
      cdCandidates.push({ value: val, source: 'rocket/cd' });
    }
  }

  // Priority 4: cd in flightconfiguration
  const flightConfig = rocket.querySelector("flightconfiguration");
  if (flightConfig) {
    const flightCd = flightConfig.querySelector("cd") || flightConfig.querySelector("overridecd");
    if (flightCd && flightCd.textContent) {
      const val = parseFloat(flightCd.textContent);
      if (!isNaN(val) && val > 0) {
        cdCandidates.push({ value: val, source: 'flightconfiguration/cd' });
      }
    }
  }

  // Priority 5: cd in simulation results (usually latest computed)
  const simulations = rocket.ownerDocument?.querySelectorAll("simulation");
  if (simulations) {
    for (let i = simulations.length - 1; i >= 0; i--) {
      const sim = simulations[i];
      const flightData = sim.querySelector("flightdata");
      if (flightData) {
        const simCd = flightData.querySelector("cd");
        if (simCd && simCd.textContent) {
          const val = parseFloat(simCd.textContent);
          if (!isNaN(val) && val > 0) {
            cdCandidates.push({ value: val, source: `simulation[${i}]/flightdata/cd` });
            break; // Take only last (newest)
          }
        }
      }
    }
  }

  // Select best Cd value (prefer overridecd, then simulation result)
  if (cdCandidates.length > 0) {
    // Prefer overridecd
    const overrideCd = cdCandidates.find(c => c.source.includes('overridecd'));
    if (overrideCd) {
      cd = overrideCd.value;
      cdSource = overrideCd.source;
    } else {
      // Else use simulation result
      const simCd = cdCandidates.find(c => c.source.includes('simulation'));
      if (simCd) {
        cd = simCd.value;
        cdSource = simCd.source;
      } else {
        // Finally use first found
        cd = cdCandidates[0].value;
        cdSource = cdCandidates[0].source;
      }
    }

    console.log(`✅ Cd extraction success: ${cd.toFixed(3)} (source: ${cdSource})`);
    if (cdCandidates.length > 1) {
      console.log(`   Other candidates: ${cdCandidates.map(c => `${c.value.toFixed(3)} (${c.source})`).join(', ')}`);
    }
  } else {
    console.warn(`⚠️ Cd value not found, using default 0.5`);
  }

  motorData.cd = cd;

  return motorData;
};

// ============= Export to .ork file (reverse operation) =============
export const exportToORK = (rocket: RocketConfig): string => {
  // Simplified version, basic structure only
  const xml = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.9" creator="AeroSim AI">
  <rocket>
    <name>${rocket.name || 'Exported Rocket'}</name>
    <motorconfiguration configid="default">
      <motor configid="default">
        <designation>${rocket.motor.name}</designation>
        <manufacturer>${rocket.motor.manufacturer || 'Custom'}</manufacturer>
        <burntime>${rocket.motor.burnTime}</burntime>
        <averagethrust>${rocket.motor.averageThrust}</averagethrust>
        <maxthrust>${rocket.motor.maxThrust}</maxthrust>
        <propellantmass>${rocket.motor.propellantMass}</propellantmass>
        <mass>${rocket.motor.totalMass}</mass>
      </motor>
    </motorconfiguration>
    <subcomponents>
      ${rocket.stages.map(stage => generateStageXML(stage)).join('\n')}
    </subcomponents>
  </rocket>
</openrocket>`;

  return xml;
};

const generateStageXML = (stage: RocketComponent): string => {
  return `<stage>
    <name>${stage.name}</name>
    <subcomponents>
      ${stage.subComponents.map(comp => generateComponentXML(comp)).join('\n')}
    </subcomponents>
  </stage>`;
};

// ============= Data validation function =============
interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const validateRocketData = (
  rocket: RocketConfig,
  stages: RocketComponent[],
  motorConfig: { motor: MotorData, cd: number }
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check basic structure
  if (stages.length === 0) {
    errors.push('No stages found');
  }

  // 2. Check Motor config
  if (!motorConfig.motor) {
    errors.push('No Motor config found');
  } else {
    if (motorConfig.motor.burnTime <= 0) {
      errors.push(`Motor burn time invalid: ${motorConfig.motor.burnTime}s`);
    }
    if (motorConfig.motor.totalMass <= 0) {
      errors.push(`Motor total mass invalid: ${motorConfig.motor.totalMass}kg`);
    }
    if (motorConfig.motor.propellantMass <= 0) {
      errors.push(`Propellant mass invalid: ${motorConfig.motor.propellantMass}kg`);
    }
    if (motorConfig.motor.propellantMass >= motorConfig.motor.totalMass) {
      errors.push(`Propellant mass (${motorConfig.motor.propellantMass}kg) >= total mass (${motorConfig.motor.totalMass}kg)`);
    }
    if (motorConfig.motor.thrustCurve.length === 0) {
      warnings.push('Motor thrust curve empty, will use average thrust');
    }
  }

  // 3. Check Cd value
  if (motorConfig.cd <= 0 || motorConfig.cd > 2.0) {
    warnings.push(`Cd value may be abnormal: ${motorConfig.cd} (normal range: 0.3-1.5)`);
  }

  // 4. Check component mass
  const totalMass = calculateTotalMass(stages);
  if (totalMass <= 0) {
    errors.push('Rocket total mass invalid or 0');
  } else if (totalMass < 0.01) {
    warnings.push(`Rocket total mass very small: ${(totalMass * 1000).toFixed(1)}g, may be missing mass data`);
  } else if (totalMass > 10) {
    warnings.push(`Rocket total mass very large: ${(totalMass * 1000).toFixed(1)}g, please verify units`);
  }

  // 5. Check parachute
  const hasParachute = stages.some(s =>
    findComponentRecursive(s, 'PARACHUTE')
  );
  if (!hasParachute) {
    warnings.push('No parachute found, simulation may not land correctly');
  }

  // 6. Check structure integrity
  let hasNoseCone = false;
  let hasBodyTube = false;
  const checkStructure = (comps: RocketComponent[]) => {
    comps.forEach(comp => {
      if (comp.type === 'NOSECONE') hasNoseCone = true;
      if (comp.type === 'BODYTUBE') hasBodyTube = true;
      if (comp.subComponents) checkStructure(comp.subComponents);
    });
  };
  checkStructure(stages);

  if (!hasNoseCone) {
    warnings.push('No nose cone component found');
  }
  if (!hasBodyTube) {
    warnings.push('No body tube component found');
  }

  // 7. Check geometry params
  const checkGeometry = (comps: RocketComponent[]) => {
    comps.forEach(comp => {
      if (comp.type === 'BODYTUBE') {
        const diameter = (comp as any).diameter;
        if (diameter <= 0 || diameter > 1.0) {
          warnings.push(`${comp.name}: BodyTube diameter abnormal (${diameter}m)`);
        }
        const length = (comp as any).length;
        if (length <= 0 || length > 10.0) {
          warnings.push(`${comp.name}: BodyTube length abnormal (${length}m)`);
        }
      }
      if (comp.type === 'NOSECONE') {
        const baseDia = (comp as any).baseDiameter;
        if (baseDia <= 0 || baseDia > 1.0) {
          warnings.push(`${comp.name}: NoseCone base diameter abnormal (${baseDia}m)`);
        }
        const length = (comp as any).length;
        if (length <= 0 || length > 5.0) {
          warnings.push(`${comp.name}: NoseCone length abnormal (${length}m)`);
        }
      }
      if (comp.type === 'FINS') {
        const finCount = (comp as any).finCount;
        if (finCount <= 0 || finCount > 12) {
          warnings.push(`${comp.name}: Fin count abnormal (${finCount})`);
        }
        const rootChord = (comp as any).rootChord;
        if (rootChord <= 0 || rootChord > 1.0) {
          warnings.push(`${comp.name}: Root chord abnormal (${rootChord}m)`);
        }
      }
      if (comp.type === 'TRANSITION') {
        const foreDia = (comp as any).foreDiameter;
        const aftDia = (comp as any).aftDiameter;
        if (foreDia <= 0 || aftDia <= 0 || foreDia > 1.0 || aftDia > 1.0) {
          warnings.push(`${comp.name}: Transition diameter abnormal (fore: ${foreDia}m, aft: ${aftDia}m)`);
        }
      }
      if (comp.subComponents) {
        checkGeometry(comp.subComponents);
      }
    });
  };
  checkGeometry(stages);

  // 8. Check position consistency
  const checkPositions = (comps: RocketComponent[], parentLength: number = 0) => {
    comps.forEach(comp => {
      const compLength = (comp as any).length || 0;
      if (comp.relativeTo === 'bottom' && parentLength > 0) {
        const localTop = parentLength - compLength + comp.position;
        if (localTop < -0.05 || localTop > parentLength + 0.05) {
          warnings.push(`${comp.name}: Bottom-relative position falls outside parent bounds`);
        }
      }
      if (comp.relativeTo === 'top' && parentLength > 0) {
        if (comp.position < -0.05 || comp.position > parentLength + 0.05) {
          warnings.push(`${comp.name}: Top-relative position falls outside parent bounds`);
        }
      }
      if (comp.subComponents) {
        checkPositions(comp.subComponents, compLength);
      }
    });
  };
  checkPositions(stages);

  return { errors, warnings };
};

// Helper: Recursively find component
const findComponentRecursive = (comp: RocketComponent, type: ComponentType): boolean => {
  if (comp.type === type) return true;
  if (comp.subComponents) {
    return comp.subComponents.some(sub => findComponentRecursive(sub, type));
  }
  return false;
};

// Helper: Compute total mass
const calculateTotalMass = (stages: RocketComponent[]): number => {
  const calcMass = (comps: RocketComponent[]): number => {
    return comps.reduce((sum, c) => {
      if (c.overridesSubComponents) {
        return sum + (c.mass || 0);
      }
      const subMass = c.subComponents ? calcMass(c.subComponents) : 0;
      return sum + (c.mass || 0) + subMass;
    }, 0);
  };
  return calcMass(stages);
};

// Helper: Count components
const countComponents = (stages: RocketComponent[]): number => {
  const count = (comps: RocketComponent[]): number => {
    return comps.reduce((sum, c) => {
      return sum + 1 + (c.subComponents ? count(c.subComponents) : 0);
    }, 0);
  };
  return count(stages);
};

const generateComponentXML = (comp: RocketComponent): string => {
  const typeNameMap: Record<ComponentType, string> = {
    'NOSECONE': 'nosecone',
    'BODYTUBE': 'bodytube',
    'TRANSITION': 'transition',
    'FINS': 'trapezoidfinset',
    'INNER_TUBE': 'innertube',
    'CENTERING_RING': 'centeringring',
    'PARACHUTE': 'parachute',
    'SHOCK_CORD': 'shockcord',
    'ENGINE_BLOCK': 'engineblock',
    'LAUNCH_LUG': 'launchlug',
    'MASS_COMPONENT': 'masscomponent',
    'STAGE': 'stage'
  };

  const tagName = typeNameMap[comp.type] || 'component';

  return `<${tagName}>
    <name>${comp.name}</name>
    <mass>${comp.mass}</mass>
    <position>${comp.position}</position>
  </${tagName}>`;
};
