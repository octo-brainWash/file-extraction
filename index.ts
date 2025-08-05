import { Buffer } from 'node:buffer';
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
  
  async function parseCompoundFile(content: string): Promise<EmbeddedFile[]> {
    const files: EmbeddedFile[] = [];
    
    // Input validation
    if (!content || typeof content !== 'string') {
      throw new Error('Invalid input: content must be a non-empty string');
    }
    
    if (!content.includes('**%%DOCU')) {
      throw new Error('Invalid file format: missing **%%DOCU markers. This does not appear to be a valid compound file.');
    }
    
    // 1. Split on **%%DOCU markers
    const sections = content.split('**%%DOCU');
    
    for (let i = 1; i < sections.length; i++) { // Skip header section
      const section = sections[i];
      
      // 2. Extract metadata (everything before _SIG/D.C.)
      const sigIndex = section.indexOf('_SIG/D.C.');
      if (sigIndex === -1) {
        console.warn(`Warning: Section ${i} missing _SIG/D.C. marker, skipping...`);
        continue; // Skip this section if marker not found
      }
      
      const metadataBlock = section.substring(0, sigIndex);
      
      // 3. Parse metadata fields
      const metadata = parseMetadata(metadataBlock);
      
      // 4. Extract content (everything after _SIG/D.C.)
      const contentStart = sigIndex + '_SIG/D.C.'.length;
      let fileContent = section.substring(contentStart);
      
      // 5. Remove trailing markers (**%% or **)
      fileContent = fileContent.replace(/\*\*%%.*$/, '').replace(/\*\*$/, '');
      
      // 6. For images, use Sharp to extract and clean image data
      let processedContent = Buffer.from(fileContent, 'binary');
      if (metadata.TYPE?.includes('IMAGE') || metadata.DOCTYPE?.includes('IMAGE')) {
        try {
          // Let Sharp find and extract the valid image data
          const imageInfo = await sharp(processedContent).metadata();
          
          if (imageInfo.format === 'webp') {
            // Extract clean WEBP data
            processedContent = await sharp(processedContent).webp().toBuffer();
            // Fix extension for WEBP files
            if (metadata.FILENAME?.endsWith('.jpg')) {
              metadata.FILENAME = metadata.FILENAME.replace('.jpg', '.webp');
            }
          } else if (imageInfo.format === 'jpeg') {
            // Extract clean JPEG data
            processedContent = await sharp(processedContent).jpeg().toBuffer();
          } else {
            // For other formats, keep as-is
            processedContent = await sharp(processedContent).toBuffer();
          }
        } catch (e) {
          // If Sharp fails, fall back to manual extraction
          const riffPos = processedContent.indexOf(Buffer.from([0x52, 0x49, 0x46, 0x46]));
          const jpegPos = processedContent.indexOf(Buffer.from([0xFF, 0xD8]));
          
          if (riffPos !== -1) {
            processedContent = processedContent.slice(riffPos);
          } else if (jpegPos !== -1) {
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
  
  function parseMetadata(block: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    const lines = block.split('\n');
    
    for (const line of lines) {
      if (line.includes('/')) {
        const [key, ...valueParts] = line.split('/');
        metadata[key.trim()] = valueParts.join('/').trim();
      }
    }
    
    return metadata;
  }

  function calculateLineNumber(fullContent: string, section: string): number {
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

  function countLines(text: string): number {
    // Count newlines in the text
    const lineCount = (text.match(/\n/g) || []).length;
    
    // If text doesn't end with newline, add 1 for the last line
    return text.length > 0 && !text.endsWith('\n') ? lineCount + 1 : lineCount;
  }

  async function extractFilesToDisk(files: EmbeddedFile[], outputDir: string = 'output'): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(outputDir, { recursive: true });
      console.log(`📁 Created output directory: ${outputDir}`);
      
      for (const file of files) {
        
        // Determine output filename and content
        const outputFilename = file.filename || `unknown_${file.guid.slice(0, 8)}${file.extension}`;
        const outputPath = path.join(outputDir, outputFilename);
        
        let processedContent: string | Buffer;
        
        // Process content based on file type
        if (file.type.includes('IMAGE') || file.doctype.includes('IMAGE')) {
          // For image files, use the content as-is from parsing stage
          processedContent = file.content;
        } else if (file.extension === '.txt' || file.type.includes('PLAINTEXT')) {
          // For text files, extract clean text content  
          processedContent = await processTextContent(file.content);
        } else if (file.type.includes('XML') || file.doctype.includes('FORM')) {
          // For XML files, extract clean XML content
          processedContent = await processXMLContent(file.content);
        } else {
          // For other files, use raw content
          processedContent = file.content;
        }
        
        // Write file to disk
        if (typeof processedContent === 'string') {
          await fs.writeFile(outputPath, processedContent, 'utf-8');
        } else {
          await fs.writeFile(outputPath, processedContent);
        }
        
        const fileType = file.type.includes('IMAGE') ? '📷' : file.extension === '.xml' ? '📄' : '📝';
        console.log(`✅ Extracted: ${fileType} ${outputFilename} (${processedContent.length} bytes)`);
      }
      
      console.log(`\n🎉 Successfully extracted ${files.length} files to ${outputDir}/`);
      
    } catch (error) {
      console.error('❌ Error extracting files:', error);
      throw error;
    }
  }

  async function processXMLContent(content: Buffer): Promise<string> {
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



  async function processTextContent(content: Buffer): Promise<string> {
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
        } else {
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
    const sigBytes = Buffer.from('_SIG/D.C.');
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

  // Export the main parsing function
  export { parseCompoundFile, EmbeddedFile, extractFilesToDisk };

  // Example usage / test function
  async function main() {
    try {
      const fs = await import('fs/promises');
      
      // Check if sample.env exists
      try {
        await fs.access('sample.env');
      } catch (error) {
        console.error('❌ Error: sample.env file not found in current directory');
        console.log('💡 Make sure you have a sample.env file to parse');
        process.exit(1);
      }
      
      console.log('📂 Reading sample.env file...');
      const fileContent = await fs.readFile('sample.env', 'utf-8');
      
      if (!fileContent) {
        console.error('❌ Error: sample.env file is empty');
        process.exit(1);
      }
      
      console.log('🔍 Parsing compound file...');
      const embeddedFiles = await parseCompoundFile(fileContent);
      
      if (embeddedFiles.length === 0) {
        console.warn('⚠️  No embedded files found in the compound file');
        return;
      }
      
      console.log(`\n📊 Found ${embeddedFiles.length} embedded files:\n`);
      
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
  // Run if this file is executed directly
  main();
