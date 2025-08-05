"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCompoundFile = parseCompoundFile;
exports.extractFilesToDisk = extractFilesToDisk;
const node_buffer_1 = require("node:buffer");
const sharp_1 = __importDefault(require("sharp"));
async function parseCompoundFile(content) {
    const files = [];
    // 1. Split on **%%DOCU markers
    const sections = content.split('**%%DOCU');
    for (let i = 1; i < sections.length; i++) { // Skip header section
        const section = sections[i];
        // 2. Extract metadata (everything before _SIG/D.C.)
        const sigIndex = section.indexOf('_SIG/D.C.');
        const metadataBlock = section.substring(0, sigIndex);
        // 3. Parse metadata fields
        const metadata = parseMetadata(metadataBlock);
        // 4. Extract content (everything after _SIG/D.C.)
        const contentStart = sigIndex + '_SIG/D.C.'.length;
        let fileContent = section.substring(contentStart);
        // 5. Remove trailing markers (**%% or **)
        fileContent = fileContent.replace(/\*\*%%.*$/, '').replace(/\*\*$/, '');
        // 6. For images, use Sharp to extract and clean image data
        let processedContent = node_buffer_1.Buffer.from(fileContent, 'binary');
        if (metadata.TYPE?.includes('IMAGE') || metadata.DOCTYPE?.includes('IMAGE')) {
            try {
                // Let Sharp find and extract the valid image data
                const imageInfo = await (0, sharp_1.default)(processedContent).metadata();
                if (imageInfo.format === 'webp') {
                    // Extract clean WEBP data
                    processedContent = await (0, sharp_1.default)(processedContent).webp().toBuffer();
                    // Fix extension for WEBP files
                    if (metadata.FILENAME?.endsWith('.jpg')) {
                        metadata.FILENAME = metadata.FILENAME.replace('.jpg', '.webp');
                    }
                }
                else if (imageInfo.format === 'jpeg') {
                    // Extract clean JPEG data
                    processedContent = await (0, sharp_1.default)(processedContent).jpeg().toBuffer();
                }
                else {
                    // For other formats, keep as-is
                    processedContent = await (0, sharp_1.default)(processedContent).toBuffer();
                }
            }
            catch (e) {
                // If Sharp fails, fall back to manual extraction
                const riffPos = processedContent.indexOf(node_buffer_1.Buffer.from([0x52, 0x49, 0x46, 0x46]));
                const jpegPos = processedContent.indexOf(node_buffer_1.Buffer.from([0xFF, 0xD8]));
                if (riffPos !== -1) {
                    processedContent = processedContent.slice(riffPos);
                }
                else if (jpegPos !== -1) {
                    processedContent = processedContent.slice(jpegPos);
                }
            }
        }
        // 7. Create file object  
        files.push({
            filename: metadata.FILENAME || 'unknown',
            extension: metadata.EXT || '',
            type: metadata.TYPE || '',
            doctype: metadata.DOCTYPE || '',
            sha1: metadata.SHA1 || '',
            guid: metadata.GUID || '',
            envGuid: metadata.ENV_GUID || '',
            content: processedContent,
            size: processedContent.length,
            startLine: calculateLineNumber(content, section),
            endLine: calculateLineNumber(content, section) + countLines(section)
        });
    }
    return files;
}
function parseMetadata(block) {
    const metadata = {};
    const lines = block.split('\n');
    for (const line of lines) {
        if (line.includes('/')) {
            const [key, ...valueParts] = line.split('/');
            metadata[key.trim()] = valueParts.join('/').trim();
        }
    }
    return metadata;
}
function calculateLineNumber(fullContent, section) {
    // Find where this section starts in the full content
    const sectionIndex = fullContent.indexOf(section);
    if (sectionIndex === -1) {
        return 1; // Default to line 1 if section not found
    }
    // Count newlines from start of file up to this section
    const beforeSection = fullContent.substring(0, sectionIndex);
    const lineCount = (beforeSection.match(/\n/g) || []).length;
    // Return 1-based line number
    return lineCount + 1;
}
function countLines(text) {
    // Count newlines in the text
    const lineCount = (text.match(/\n/g) || []).length;
    // If text doesn't end with newline, add 1 for the last line
    return text.length > 0 && !text.endsWith('\n') ? lineCount + 1 : lineCount;
}
async function extractFilesToDisk(files, outputDir = 'output') {
    const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
    const path = await Promise.resolve().then(() => __importStar(require('path')));
    try {
        // Create output directory if it doesn't exist
        await fs.mkdir(outputDir, { recursive: true });
        console.log(`📁 Created output directory: ${outputDir}`);
        for (const file of files) {
            // Determine output filename and content
            const outputFilename = file.filename || `unknown_${file.guid.slice(0, 8)}${file.extension}`;
            const outputPath = path.join(outputDir, outputFilename);
            let processedContent;
            // Process content based on file type
            if (file.type.includes('IMAGE') || file.doctype.includes('IMAGE')) {
                // For image files, use the content as-is from parsing stage
                processedContent = file.content;
            }
            else if (file.extension === '.txt' || file.type.includes('PLAINTEXT')) {
                // For text files, extract clean text content  
                processedContent = await processTextContent(file.content);
            }
            else if (file.type.includes('XML') || file.doctype.includes('FORM')) {
                // For XML files, extract clean XML content
                processedContent = await processXMLContent(file.content);
            }
            else {
                // For other files, use raw content
                processedContent = file.content;
            }
            // Write file to disk
            if (typeof processedContent === 'string') {
                await fs.writeFile(outputPath, processedContent, 'utf-8');
            }
            else {
                await fs.writeFile(outputPath, processedContent);
            }
            const fileType = file.type.includes('IMAGE') ? '📷' : file.extension === '.xml' ? '📄' : '📝';
            console.log(`✅ Extracted: ${fileType} ${outputFilename} (${processedContent.length} bytes)`);
        }
        console.log(`\n🎉 Successfully extracted ${files.length} files to ${outputDir}/`);
    }
    catch (error) {
        console.error('❌ Error extracting files:', error);
        throw error;
    }
}
async function processXMLContent(content) {
    const contentStr = content.toString('utf-8');
    // Look for XML declaration or root element
    let xmlStart = contentStr.indexOf('<?xml');
    if (xmlStart === -1) {
        xmlStart = contentStr.indexOf('<FORMINFO');
    }
    if (xmlStart === -1) {
        xmlStart = contentStr.indexOf('<VALUATION_RESPONSE');
    }
    if (xmlStart !== -1) {
        let xmlContent = contentStr.slice(xmlStart);
        // Remove any trailing markers
        xmlContent = xmlContent.replace(/\*\*%%.*$/, '').replace(/\*\*$/, '').trim();
        return xmlContent;
    }
    // If no XML found, return the content as-is
    return contentStr.trim();
}
async function processTextContent(content) {
    // GENERALIZED: Find the start of clean text by looking for printable ASCII sequences
    let cleanTextStart = -1;
    // Strategy 1: Look for sequences of printable ASCII characters (letters, spaces, punctuation)
    for (let i = 0; i < content.length - 10; i++) {
        let consecutivePrintable = 0;
        // Check if we have a sequence of printable characters
        for (let j = i; j < Math.min(i + 20, content.length); j++) {
            const byte = content[j];
            if ((byte >= 0x20 && byte <= 0x7E) || byte === 0x09 || byte === 0x0A || byte === 0x0D) {
                consecutivePrintable++;
            }
            else {
                break;
            }
        }
        // If we found 10+ consecutive printable chars, this is likely the text start
        if (consecutivePrintable >= 10) {
            cleanTextStart = i;
            break;
        }
    }
    if (cleanTextStart !== -1) {
        const textBuffer = content.slice(cleanTextStart);
        let textContent = textBuffer.toString('utf-8');
        // Remove trailing markers  
        textContent = textContent.replace(/\*\*$/s, '').trim();
        return textContent;
    }
    // Strategy 2: Look for _SIG/D.C. marker and extract after it
    const sigBytes = node_buffer_1.Buffer.from('_SIG/D.C.');
    const sigIndex = content.indexOf(sigBytes);
    if (sigIndex !== -1) {
        const afterSig = content.slice(sigIndex + sigBytes.length);
        let textContent = afterSig.toString('utf-8');
        // Remove non-printable characters at the start
        textContent = textContent.replace(/^[^\x20-\x7E\u00A0-\uFFFF]*/, '');
        textContent = textContent.replace(/\*\*%%.*$/s, '').replace(/\*\*$/s, '').trim();
        return textContent;
    }
    // Strategy 3: Fallback - clean up the entire content
    let textContent = content.toString('utf-8');
    // Remove non-printable characters at the start
    textContent = textContent.replace(/^[^\x20-\x7E\u00A0-\uFFFF]*/, '');
    // Remove trailing markers
    textContent = textContent.replace(/\*\*%%.*$/s, '').replace(/\*\*$/s, '').trim();
    return textContent;
}
