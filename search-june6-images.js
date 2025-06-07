#!/usr/bin/env node

// Script to search for images in Pancrazio group from June 6th, 2025
import { spawn } from 'child_process';

const searchRequest = {
  jsonrpc: "2.0",
  method: "tools/call",
  params: {
    tool: "search_messages",
    arguments: {
      contactId: "393883442005-1387984909@g.us",
      dateFrom: "2025-06-06",
      dateTo: "2025-06-06",  // Same day to get only June 6th messages
      mediaType: "image",
      limit: 50  // High limit to ensure we get all images
    }
  },
  id: 1
};

console.log('Searching for images from June 6th, 2025 in Pancrazio group...\n');
console.log('Request:', JSON.stringify(searchRequest, null, 2));
console.log('\n' + '='.repeat(80) + '\n');

// Spawn the MCP server
const mcpServer = spawn('node', ['src/index.js'], {
  cwd: '/Users/andreavillani/whatsapp-mcp-server',
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production' }
});

// Handle startup messages
mcpServer.stderr.on('data', (data) => {
  const message = data.toString();
  if (message.includes('ready')) {
    console.log('Server ready, sending request...\n');
    // Send the request
    mcpServer.stdin.write(JSON.stringify(searchRequest) + '\n');
  }
});

// Collect response
let responseBuffer = '';
mcpServer.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  
  // Try to parse each complete line
  const lines = responseBuffer.split('\n');
  responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        if (response.result && response.result.content) {
          const text = response.result.content[0].text;
          
          // Extract the JSON from the response text
          const jsonMatch = text.match(/Found \d+ messages:\n(.+)/s);
          if (jsonMatch) {
            const messages = JSON.parse(jsonMatch[1]);
            
            console.log(`Total images found: ${messages.length}\n`);
            
            // Group by date and show details
            const imagesByDate = {};
            messages.forEach(msg => {
              const date = msg.timestamp.split('T')[0];
              if (!imagesByDate[date]) imagesByDate[date] = [];
              imagesByDate[date].push(msg);
            });
            
            // Show images from June 6th
            if (imagesByDate['2025-06-06']) {
              console.log(`Images from June 6th, 2025: ${imagesByDate['2025-06-06'].length}\n`);
              imagesByDate['2025-06-06'].forEach((img, idx) => {
                console.log(`Image ${idx + 1}:`);
                console.log(`  ID: ${img.id}`);
                console.log(`  From: ${img.from}`);
                console.log(`  Time: ${img.timestamp}`);
                console.log(`  Caption: ${img.body || '(no caption)'}`);
                if (img.media) {
                  console.log(`  Type: ${img.media.mimetype}`);
                  console.log(`  Size: ${(img.media.filesize / 1024).toFixed(2)} KB`);
                }
                console.log();
              });
            } else {
              console.log('No images found from June 6th, 2025');
            }
            
            // Show summary of other dates
            console.log('\nImages from other dates:');
            Object.entries(imagesByDate).forEach(([date, imgs]) => {
              if (date !== '2025-06-06') {
                console.log(`  ${date}: ${imgs.length} images`);
              }
            });
          }
          
          // Exit after processing
          mcpServer.kill();
          process.exit(0);
        }
      } catch (e) {
        // Not valid JSON, continue
      }
    }
  }
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\nTimeout - no response received');
  mcpServer.kill();
  process.exit(1);
}, 30000);