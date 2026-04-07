/**
 * ZipExtractor - Extract XML content from OpenRocket .ork files
 * 
 * .ork files are ZIP archives containing XML rocket design files.
 * This module handles ZIP decompression and XML file discovery.
 * 
 * Supports both browser (CDN loading) and Node.js (npm package) environments.
 */

// Import JSZip (bundled by Vite)
import JSZipLib from 'jszip';

/**
 * Known XML file names in OpenRocket archives (ordered by priority)
 */
const KNOWN_XML_FILES = [
    'rocket.ork',
    'document.xml',
    'rocket.xml',
    'openrocket.xml',
    'design.xml',
    'data.xml'
];

/**
 * Check if file content appears to be valid OpenRocket XML
 */
function isValidOpenRocketXml(content: string): boolean {
    return content.includes('<rocket') || content.includes('<openrocket');
}

/**
 * Score a file for likelihood of being the main rocket XML
 */
function scoreFile(fileName: string, content: string): number {
    let score = content.length; // Larger files are more likely to be the main file

    if (fileName.includes('rocket')) score += 1000;
    if (fileName.endsWith('.ork')) score += 500;
    if (isValidOpenRocketXml(content)) score += 2000;

    return score;
}

export interface ZipExtractionResult {
    xml: string;
    sourceFile: string;
    allFiles: string[];
}

/**
 * Extract XML content from a ZIP archive (ArrayBuffer)
 */
export async function extractXmlFromZip(arrayBuffer: ArrayBuffer): Promise<ZipExtractionResult> {

    let zip: any;
    try {
        zip = await JSZipLib.loadAsync(arrayBuffer);
    } catch (zipError) {
        throw new Error(
            `ZIP file is corrupted or has an invalid format: ${zipError instanceof Error ? zipError.message : 'Unknown error'}`
        );
    }

    const fileNames = Object.keys(zip.files);
    console.log(`[ZipExtractor] ZIP contains ${fileNames.length} files:`, fileNames);

    // Track best candidate
    let bestMatch: { fileName: string; content: string; score: number } | null = null;

    // First pass: Check known file names
    for (const fileName of KNOWN_XML_FILES) {
        const file = zip.files[fileName];
        if (file && !file.dir) {
            try {
                const content = await file.async('text');
                if (isValidOpenRocketXml(content)) {
                    const score = scoreFile(fileName, content);
                    if (!bestMatch || score > bestMatch.score) {
                        bestMatch = { fileName, content, score };
                    }
                }
            } catch (readError) {
                console.warn(`[ZipExtractor] Failed to read ${fileName}:`, readError);
            }
        }
    }

    // If found, return immediately
    if (bestMatch) {
        console.log(`[ZipExtractor] ✅ Found best match: ${bestMatch.fileName} (score: ${bestMatch.score})`);
        return {
            xml: bestMatch.content,
            sourceFile: bestMatch.fileName,
            allFiles: fileNames
        };
    }

    // Second pass: Check all XML/ORK files
    const xmlFiles = fileNames.filter(
        name => !zip.files[name].dir && (name.endsWith('.ork') || name.endsWith('.xml'))
    );

    for (const fileName of xmlFiles) {
        try {
            const content = await zip.files[fileName].async('text');
            if (isValidOpenRocketXml(content)) {
                const score = scoreFile(fileName, content);
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { fileName, content, score };
                }
            }
        } catch (readError) {
            console.warn(`[ZipExtractor] Failed to read ${fileName}:`, readError);
        }
    }

    if (bestMatch) {
        console.log(`[ZipExtractor] ✅ Found XML in: ${bestMatch.fileName}`);
        return {
            xml: bestMatch.content,
            sourceFile: bestMatch.fileName,
            allFiles: fileNames
        };
    }

    // Last resort: Check all files for XML content
    for (const fileName in zip.files) {
        const file = zip.files[fileName];
        if (!file.dir && !xmlFiles.includes(fileName)) {
            try {
                const content = await file.async('text');
                if (content.trim().startsWith('<?xml') || isValidOpenRocketXml(content)) {
                    console.log(`[ZipExtractor] ✅ Found XML content in: ${fileName}`);
                    return {
                        xml: content,
                        sourceFile: fileName,
                        allFiles: fileNames
                    };
                }
            } catch {
                // Ignore binary files
            }
        }
    }

    throw new Error(
        `No valid XML content found in ZIP file. File list: ${fileNames.join(', ') || 'no files'}`
    );
}

/**
 * Detect if content is a ZIP file (starts with PK magic bytes)
 */
export function isZipFile(data: Uint8Array): boolean {
    return data[0] === 0x50 && data[1] === 0x4B; // "PK"
}
