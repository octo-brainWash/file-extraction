# File Recognition - Proprietary Archive File Parser

A robust TypeScript-based parser for custom proprietary archive file formats. This tool can reverse-engineer and extract embedded files from compound archive files similar to .tar format, handling various file types including images, text documents, and XML files.

## Overview

This project was developed to handle proprietary, undocumented file formats that bundle multiple files together in an arbitrary ordering. The parser can:

- **Reverse-engineer** custom archive file formats
- **Extract embedded files** with their original metadata
- **Handle multiple file types** (images, text, XML, forms)
- **Process image files** using Sharp for optimization
- **Maintain file integrity** with SHA1 verification
- **Provide detailed file information** including line positions and sizes

## Features

### Core Functionality
- 🔍 **Smart File Detection**: Automatically identifies file boundaries using signature markers
- 📁 **Multi-format Support**: Handles images (JPEG, WebP), text files, XML documents, and forms
- 🛡️ **Error Handling**: Comprehensive validation and graceful error recovery
- 📊 **Metadata Extraction**: Retrieves file names, types, GUIDs, SHA1 hashes, and more
- 💾 **File Extraction**: Saves extracted files to disk with proper formatting

### File Format Support
- **Images**: JPEG, WebP (with Sharp processing for clean extraction)
- **Text Files**: Plain text with encoding detection
- **XML Documents**: Forms and structured data
- **Binary Files**: Raw content preservation

## Installation

### Prerequisites
- Node.js (version 16 or higher)
- npm or yarn

### Setup
1. Clone the repository:
```bash
git clone <repository-url>
cd file-recognition
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Usage

### Basic Usage

Place your proprietary archive file (e.g., `sample.env`) in the project root directory and run:

```bash
npm start
```

This will:
1. Parse the archive file
2. Display information about all embedded files
3. Extract files to the `extracted_output/` directory

### Programmatic Usage

```typescript
import { parseCompoundFile, extractFilesToDisk } from './index';
import { readFile } from 'fs/promises';

async function parseCustomArchive() {
  try {
    // Read the archive file
    const fileContent = await readFile('sample.env', 'utf-8');
    
    // Parse embedded files
    const embeddedFiles = await parseCompoundFile(fileContent);
    
    // Display file information
    console.log(`Found ${embeddedFiles.length} embedded files:`);
    embeddedFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file.filename} (${file.size} bytes)`);
    });
    
    // Extract files to disk
    await extractFilesToDisk(embeddedFiles, 'output');
    
  } catch (error) {
    console.error('Error parsing archive:', error.message);
  }
}
```

### API Reference

#### `parseCompoundFile(content: string): Promise<EmbeddedFile[]>`
Parses a compound archive file and returns an array of embedded file objects.

**Parameters:**
- `content`: The raw content of the archive file as a string

**Returns:**
- Promise resolving to an array of `EmbeddedFile` objects

**Throws:**
- Error if content is invalid or missing required markers

#### `extractFilesToDisk(files: EmbeddedFile[], outputDir?: string): Promise<void>`
Extracts embedded files to the specified directory.

**Parameters:**
- `files`: Array of EmbeddedFile objects from parseCompoundFile
- `outputDir`: Output directory path (default: 'output')

#### `EmbeddedFile` Interface
```typescript
interface EmbeddedFile {
  filename: string;     // Original filename
  extension: string;    // File extension
  type: string;        // File type identifier
  doctype: string;     // Document type
  sha1: string;        // SHA1 hash for verification
  guid: string;        // Unique identifier
  envGuid: string;     // Environment GUID
  content: Buffer;     // File content as Buffer
  startLine: number;   // Starting line in archive
  endLine: number;     // Ending line in archive
  size: number;        // File size in bytes
}
```

## File Format Details

The parser understands proprietary archive formats with the following structure:

### Archive Structure
- **Section Markers**: `**%%DOCU` - Delimits file sections
- **Signature Marker**: `_SIG/D.C.` - Separates metadata from content
- **Metadata Format**: Key/Value pairs separated by `/`
- **Content**: Raw file data following the signature marker

### Example Archive Section
```
**%%DOCU
FILENAME/document.txt
TYPE/PLAINTEXT
EXT/.txt
SHA1/abc123...
GUID/def456...
_SIG/D.C.
[Raw file content here]
**%%
```

## Error Handling

The parser includes comprehensive error handling for common issues:

- **Invalid Input**: Validates content format and structure
- **Missing Markers**: Gracefully handles sections without required signatures
- **Corrupt Files**: Attempts recovery and provides warnings
- **File Access**: Clear error messages for missing files
- **Image Processing**: Fallback methods when Sharp processing fails

## Development

### Project Structure
```
file-recognition/
├── index.ts              # Main parser implementation
├── package.json          # Project dependencies
├── tsconfig.json         # TypeScript configuration
├── extracted_output/     # Default extraction directory
└── sample.env           # Example archive file
```

### Building and Testing
```bash
# Build the project
npm run build

# Run the parser
npm start

# Run with TypeScript directly
npx ts-node index.ts
```

### Dependencies
- **sharp**: Image processing and optimization
- **@types/node**: TypeScript definitions for Node.js
- **typescript**: TypeScript compiler
- **ts-node**: TypeScript execution environment

## Troubleshooting

### Common Issues

**"File not found" errors:**
- Ensure the archive file exists in the project root
- Check file permissions and accessibility

**"Invalid file format" errors:**
- Verify the file contains `**%%DOCU` markers
- Check if the file is corrupted or partially downloaded

**Image extraction issues:**
- Sharp dependency may need system-specific compilation
- Fallback extraction methods will be used automatically
- Image extraction is not consistent and might not work for all images

**Memory issues with large files:**
- The parser loads entire files into memory
- Consider processing smaller archive files or implementing streaming

For additional support, please check the error messages which provide specific guidance for resolution.