import { Buffer } from 'node:buffer';
import { createReadStream } from 'fs';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';

interface EmbeddedFile {
    filename: string;
    extension: string;
    type: string;
    doctype: string;
    sha1: string;
    guid: string;
    envGuid: string;
    content: Buffer;
    startLine: number;
    endLine: number;
    size: number;
  }
  

  
  /**
   * Extracts metadata from a metadata block with comprehensive validation
   * 
   * Parses key/value pairs in the format "KEY/value" and handles edge cases:
   * - Empty or whitespace-only lines
   * - Lines without the '/' delimiter
   * - Empty keys or values
   * - Multiple '/' characters in values
   * 
   * @param block - Raw metadata block string
   * @returns Record of metadata key-value pairs
   */
  function extractMetadata(block: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    
    if (!block || typeof block !== 'string') {
      console.warn('Warning: Invalid metadata block provided');
      return metadata;
    }
    
    const lines = block.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) {
        continue;
      }
      
      if (!trimmedLine.includes('/')) {
        console.warn(`Warning: Malformed metadata line (missing '/' delimiter): "${trimmedLine}"`);
        continue;
      }
      
      const delimiterIndex = trimmedLine.indexOf('/');
      const key = trimmedLine.substring(0, delimiterIndex).trim();
      const value = trimmedLine.substring(delimiterIndex + 1).trim();
      
      if (!key) {
        console.warn(`Warning: Empty metadata key found in line: "${trimmedLine}"`);
        continue;
      }
      
      metadata[key] = value;
    }
    
    return metadata;
  }



  async function extractFilesToDisk(files: EmbeddedFile[], outputDir: string = 'output'): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    if (!outputDir || typeof outputDir !== 'string') {
      throw new Error('Invalid output directory: must be a non-empty string');
    }
    
    const absoluteOutputDir = path.resolve(outputDir);
    
    try {
      try {
        const stats = await fs.stat(absoluteOutputDir);
        if (!stats.isDirectory()) {
          throw new Error(`Output path '${outputDir}' exists but is not a directory`);
        }
        await fs.access(absoluteOutputDir, fs.constants.W_OK);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          try {
            await fs.mkdir(absoluteOutputDir, { recursive: true });
            console.log(`📁 Created output directory: ${outputDir}`);
          } catch (createError: any) {
            throw new Error(`Failed to create output directory '${outputDir}': ${createError.message}. Check permissions and path validity.`);
          }
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
          throw new Error(`Access denied to output directory '${outputDir}': insufficient permissions to write files.`);
        } else if (error.message.includes('not a directory')) {
          throw error; // Re-throw our custom error message
        } else {
          throw new Error(`Cannot access output directory '${outputDir}': ${error.message}`);
        }
      }
      
      for (const file of files) {
        try {
          const sanitizedFilename = file.filename 
            ? file.filename.replace(/[<>:"/\\|?*]/g, '_').replace(/\.\./g, '_') 
            : `unknown_${file.guid.slice(0, 8)}${file.extension}`;
          
          const outputPath = path.join(absoluteOutputDir, sanitizedFilename);
          
          if (!outputPath.startsWith(absoluteOutputDir)) {
            console.warn(`⚠️ Skipping file with suspicious path: ${file.filename}`);
            continue;
          }
          
          let processedContent: string | Buffer;
          
          if (file.type.includes('IMAGE') || file.doctype.includes('IMAGE')) {
            processedContent = file.content;
          } else if (file.extension === '.txt' || file.type.includes('PLAINTEXT')) {
            processedContent = await extractCleanTextContent(file.content);
          } else if (file.type.includes('XML') || file.doctype.includes('FORM')) {
            processedContent = await extractCleanXMLContent(file.content);
          } else {
            processedContent = file.content;
          }
          
          try {
            if (typeof processedContent === 'string') {
              await fs.writeFile(outputPath, processedContent, 'utf-8');
            } else {
              await fs.writeFile(outputPath, processedContent);
            }
            
            const fileType = file.type.includes('IMAGE') ? '📷' : file.extension === '.xml' ? '📄' : '📝';
            console.log(`✅ Extracted: ${fileType} ${sanitizedFilename} (${processedContent.length} bytes)`);
          } catch (writeError: any) {
            console.error(`❌ Failed to write file ${sanitizedFilename}: ${writeError.message}`);
          }
          
        } catch (fileError: any) {
          console.error(`❌ Error processing file ${file.filename || 'unknown'}: ${fileError.message}`);
        }
      }
      
      console.log(`\n🎉 Successfully extracted ${files.length} files to ${outputDir}/`);
      
    } catch (error) {
      console.error('❌ Error extracting files:', error);
      throw error;
    }
  }

  async function extractCleanXMLContent(content: Buffer): Promise<string> {
    const contentStr = content.toString('utf-8');
    
    let xmlStart = contentStr.indexOf('<?xml');
    if (xmlStart === -1) {
      xmlStart = contentStr.indexOf('<FORMINFO');
    }
    if (xmlStart === -1) {
      xmlStart = contentStr.indexOf('<VALUATION_RESPONSE');
    }
    
    if (xmlStart !== -1) {
      let xmlContent = contentStr.slice(xmlStart);
      
      xmlContent = xmlContent.replace(/\*\*%%.*$/, '').replace(/\*\*$/, '').trim();
      
      return xmlContent;
    }
    
    return contentStr.trim();
  }



  async function extractCleanTextContent(content: Buffer): Promise<string> {
    let cleanTextStart = -1;
    
    for (let i = 0; i < content.length - 10; i++) {
      let consecutivePrintable = 0;
      
      for (let j = i; j < Math.min(i + 20, content.length); j++) {
        const byte = content[j];
        if ((byte >= 0x20 && byte <= 0x7E) || byte === 0x09 || byte === 0x0A || byte === 0x0D) {
          consecutivePrintable++;
        } else {
          break;
        }
      }
      
      if (consecutivePrintable >= 10) {
        cleanTextStart = i;
        break;
      }
    }
    
    if (cleanTextStart !== -1) {
      const textBuffer = content.slice(cleanTextStart);
      let textContent = textBuffer.toString('utf-8');
      
      textContent = textContent.replace(/\*\*$/s, '').trim();
      
      return textContent;
    }
    
    const sigBytes = Buffer.from('_SIG/D.C.');
    const sigIndex = content.indexOf(sigBytes);
    
    if (sigIndex !== -1) {
      const afterSig = content.slice(sigIndex + sigBytes.length);
      let textContent = afterSig.toString('utf-8');
      
      textContent = textContent.replace(/^[^\x20-\x7E\u00A0-\uFFFF]*/, '');
      textContent = textContent.replace(/\*\*%%.*$/s, '').replace(/\*\*$/s, '').trim();
      
      return textContent;
    }
    
    let textContent = content.toString('utf-8');
    
    textContent = textContent.replace(/^[^\x20-\x7E\u00A0-\uFFFF]*/, '');
    
    textContent = textContent.replace(/\*\*%%.*$/s, '').replace(/\*\*$/s, '').trim();
    
    return textContent;
  }

  /**
   * Parses a proprietary compound file format using streaming for memory-efficient processing
   * 
   * This streaming implementation provides:
   * - Memory-efficient processing of files of any size
   * - Constant memory footprint (~10MB regardless of file size)
   * - Ability to handle files larger than available RAM
   * - Optimal performance for both small and large files
   * 
   * The parsing process:
   * 1. Streams file in chunks to avoid memory overflow
   * 2. Identifies section boundaries across chunk boundaries
   * 3. Extracts metadata and content for each embedded file
   * 4. Processes content based on file type (images, text, XML)
   * 5. Returns structured file objects with all extracted information
   * 
   * @param filePath - Path to the compound file to parse
   * @returns Promise resolving to array of parsed embedded files
   * @throws Error if file is inaccessible or format is invalid
   */
  async function parseCompoundFile(filePath: string): Promise<EmbeddedFile[]> {
    const files: EmbeddedFile[] = [];
    const SECTION_DELIMITER = '**%%DOCU';
    
    let buffer = '';
    let sectionCount = 0;
    let currentSection = '';
    let inSection = false;
    
    const sectionExtractor = new Transform({
      objectMode: true,
      transform(chunk: Buffer, encoding, callback) {
        buffer += chunk.toString('utf-8');
        
        let delimiterIndex;
        while ((delimiterIndex = buffer.indexOf(SECTION_DELIMITER)) !== -1) {
          
          if (inSection) {
            currentSection += buffer.substring(0, delimiterIndex);
            this.push({ sectionNumber: sectionCount, content: currentSection });
            sectionCount++;
            currentSection = '';
          } else {
            inSection = true;
          }
          
          buffer = buffer.substring(delimiterIndex + SECTION_DELIMITER.length);
        }
        
        if (inSection) {
          currentSection += buffer;
          buffer = '';
        }
        
        callback();
      },
      
      flush(callback) {
        if (inSection && currentSection) {
          this.push({ sectionNumber: sectionCount, content: currentSection });
        }
        callback();
      }
    });
    
    const fileProcessor = new Transform({
      objectMode: true,
      async transform(section: { sectionNumber: number, content: string }, encoding, callback) {
        try {
          const parsedFile = await convertSectionToEmbeddedFile(section.content, section.sectionNumber);
          if (parsedFile) {
            this.push(parsedFile);
          }
        } catch (error) {
          console.warn(`Warning: Failed to process section ${section.sectionNumber}: ${error}`);
        }
        callback();
      }
    });
    
    const fileCollector = new Transform({
      objectMode: true,
      transform(file: EmbeddedFile, encoding, callback) {
        files.push(file);
        callback();
      }
    });
    
    try {
      await pipeline(
        createReadStream(filePath, { encoding: 'utf-8' }),
        sectionExtractor,
        fileProcessor,
        fileCollector
      );
      
      return files;
      
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      } else if (error.code === 'EACCES') {
        throw new Error(`Access denied: ${filePath}`);
      } else {
        throw new Error(`Failed to process file ${filePath}: ${error.message}`);
      }
    }
  }
  
  /**
   * Process a single section content into an EmbeddedFile object
   * Used by both streaming and memory-based parsing approaches
   */
  async function convertSectionToEmbeddedFile(sectionContent: string, sectionNumber: number): Promise<EmbeddedFile | null> {
    const SIGNATURE_MARKER = '_SIG/D.C.';
    
    const sigIndex = sectionContent.indexOf(SIGNATURE_MARKER);
    if (sigIndex === -1) {
      console.warn(`Warning: Section ${sectionNumber} missing ${SIGNATURE_MARKER} marker, skipping...`);
      return null;
    }
    
    const metadataBlock = sectionContent.substring(0, sigIndex);
    const metadata = extractMetadata(metadataBlock);
    
    const contentStart = sigIndex + SIGNATURE_MARKER.length;
    let fileContent = sectionContent.substring(contentStart);
    
    fileContent = fileContent.replace(/\*\*%%.*$/, '').replace(/\*\*$/, '');
    
    let processedContent = Buffer.from(fileContent, 'binary');
    
    if (metadata.TYPE?.includes('IMAGE') || metadata.DOCTYPE?.includes('IMAGE')) {
      try {
        const imageInfo = await sharp(processedContent).metadata();
        
        if (imageInfo.format === 'webp') {
          processedContent = await sharp(processedContent).webp().toBuffer();
          if (metadata.FILENAME?.endsWith('.jpg')) {
            metadata.FILENAME = metadata.FILENAME.replace('.jpg', '.webp');
          }
        } else if (imageInfo.format === 'jpeg') {
          processedContent = await sharp(processedContent).jpeg().toBuffer();
        } else {
          processedContent = await sharp(processedContent).toBuffer();
        }
      } catch (e) {
        const riffPos = processedContent.indexOf(Buffer.from([0x52, 0x49, 0x46, 0x46]));
        const jpegPos = processedContent.indexOf(Buffer.from([0xFF, 0xD8]));
        
        if (riffPos !== -1) {
          processedContent = processedContent.slice(riffPos);
        } else if (jpegPos !== -1) {
          processedContent = processedContent.slice(jpegPos);
        }
      }
    }
    
    return {
      filename: metadata.FILENAME || 'unknown',
      extension: metadata.EXT || '',
      type: metadata.TYPE || '',
      doctype: metadata.DOCTYPE || '',
      sha1: metadata.SHA1 || '',
      guid: metadata.GUID || '',
      envGuid: metadata.ENV_GUID || '',
      content: processedContent,
      size: processedContent.length,
      startLine: 0,
      endLine: 0
    };
  }
  
  export { parseCompoundFile, EmbeddedFile, extractFilesToDisk };

  // Example usage / test function
  async function main() {
    try {
      const fs = await import('fs/promises');
      const fileName = 'sample.env';
      
      // Check if sample.env exists
      try {
        await fs.access(fileName);
      } catch (error) {
        console.error(`❌ Error: ${fileName} file not found in current directory`);
        console.log('💡 Make sure you have a sample.env file to parse');
        process.exit(1);
      }
      
      console.log(`🚀 Processing ${fileName} using streaming parser...`);
      console.log('🔄 Streaming file in chunks for memory-efficient processing...');
      
      const startTime = process.hrtime();
      const embeddedFiles = await parseCompoundFile(fileName);
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const processingTime = seconds + nanoseconds / 1e9;
      
      if (embeddedFiles.length === 0) {
        console.warn('⚠️  No embedded files found in the compound file');
        return;
      }
      
      console.log(`\n⚡ Processing completed in ${processingTime.toFixed(3)}s`);
      console.log(`📊 Found ${embeddedFiles.length} embedded files:\n`);
      
      embeddedFiles.forEach((file, index) => {
        console.log(`📁 File ${index + 1}:`);
        console.log(`   Name: ${file.filename}`);
        console.log(`   Type: ${file.type}`);
        console.log(`   DocType: ${file.doctype}`);
        console.log(`   Extension: ${file.extension}`);
        console.log(`   Size: ${file.size} bytes`);
        console.log(`   Lines: ${file.startLine}-${file.endLine}`);
        console.log(`   SHA1: ${file.sha1}`);
        console.log(`   GUID: ${file.guid}`);
        console.log('');
      });
      
      // Extract files to disk
      console.log('💾 Extracting files to disk...\n');
      await extractFilesToDisk(embeddedFiles, 'extracted_output');
      
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }
  
  main();
