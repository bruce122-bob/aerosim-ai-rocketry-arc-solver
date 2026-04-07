/**
 * XmlParser - Parse XML content with robust error handling
 * 
 * Handles BOM removal, encoding fixes, and multi-MIME-type fallback.
 */

import { ParseError } from './types';

/**
 * Clean XML content before parsing
 * - Remove BOM (Byte Order Mark)
 * - Add XML declaration if missing
 */
function cleanXmlContent(text: string): string {
    let cleaned = text.trim();

    // Remove BOM
    if (cleaned.charCodeAt(0) === 0xFEFF) {
        cleaned = cleaned.slice(1);
    }

    // Add XML declaration if missing
    if (!cleaned.startsWith('<?xml')) {
        console.warn('[XmlParser] XML declaration missing, adding default');
        cleaned = '<?xml version="1.0" encoding="UTF-8"?>\n' + cleaned;
    }

    return cleaned;
}

/**
 * Extract error details from parsererror element
 */
function extractParseError(parserError: Element): ParseError {
    const errorMsg = parserError.textContent || 'XML format error';
    const line = parserError.getAttribute('line') || '';
    const column = parserError.getAttribute('column') || '';

    let details = errorMsg.substring(0, 200);
    if (line) {
        details += ` (line ${line}${column ? `, column ${column}` : ''})`;
    }

    return {
        code: 'XML_PARSE_ERROR',
        message: 'XML parsing failed',
        details,
        suggestions: [
            'Check if the file is corrupted',
            'Try re-saving the file in OpenRocket',
            'Ensure you are using OpenRocket 1.0 or later'
        ]
    };
}

export type XmlParseResult = {
    success: true;
    document: Document;
} | {
    success: false;
    error: ParseError;
};

/**
 * Get DOMParser - supports both browser and Node.js
 */
async function getDOMParser(): Promise<{ new(): DOMParser }> {
    if (typeof DOMParser !== 'undefined') {
        return DOMParser;
    }

    // Node.js: use @xmldom/xmldom
    const xmldom = await import('@xmldom/xmldom');
    return xmldom.DOMParser as any;
}

/**
 * Parse XML string into Document with multi-MIME-type fallback
 */
export async function parseXml(xmlContent: string): Promise<XmlParseResult> {
    const DOMParserClass = await getDOMParser();
    const parser = new DOMParserClass();
    const cleanedContent = cleanXmlContent(xmlContent);

    const mimeTypes: DOMParserSupportedType[] = [
        'application/xml',
        'text/xml',
        'application/xhtml+xml'
    ];

    for (const mimeType of mimeTypes) {
        try {
            const doc = parser.parseFromString(cleanedContent, mimeType);
            // Use getElementsByTagName for xmldom compatibility
            const parserErrors = doc.getElementsByTagName('parsererror');

            if (parserErrors.length === 0) {
                console.log(`[XmlParser] ✅ Parsed successfully with ${mimeType}`);
                return { success: true, document: doc };
            }
        } catch (e) {
            console.warn(`[XmlParser] Failed with ${mimeType}:`, e);
        }
    }

    // All attempts failed - try one more time to get error details
    const doc = parser.parseFromString(cleanedContent, 'application/xml');
    const parserErrors = doc.getElementsByTagName('parsererror');

    return {
        success: false,
        error: parserErrors.length > 0
            ? extractParseError(parserErrors[0] as Element)
            : {
                code: 'XML_PARSE_ERROR',
                message: 'XML parsing failed',
                details: 'Unable to determine the specific error cause',
                suggestions: ['Try re-saving the file in OpenRocket']
            }
    };
}

/**
 * Find the rocket element in the parsed document
 */
export function findRocketElement(doc: Document): Element | null {
    // Use getElementsByTagName for xmldom compatibility
    const rockets = doc.getElementsByTagName('rocket');
    if (rockets.length > 0) {
        return rockets[0] as Element;
    }

    // Try under openrocket tag
    const openrockets = doc.getElementsByTagName('openrocket');
    if (openrockets.length > 0) {
        const rocketChildren = openrockets[0].getElementsByTagName('rocket');
        if (rocketChildren.length > 0) {
            return rocketChildren[0] as Element;
        }
    }

    // Check if root element is rocket
    if (doc.documentElement.tagName.toLowerCase() === 'rocket') {
        return doc.documentElement;
    }

    return null;
}
