// Inter-process communication bridge for WhatsApp operations
import fs from 'fs';
import path from 'path';

// Determine if this is business instance
const isBusinessInstance = process.env.WHATSAPP_INSTANCE === 'business' || process.argv.includes('--business');
const instancePrefix = isBusinessInstance ? 'business-' : '';

// Use more reliable paths with proper permissions
const IPC_DIR = `/tmp/whatsapp-${instancePrefix}mcp-ipc`;
const REQUEST_DIR = path.join(IPC_DIR, 'requests');
const RESPONSE_DIR = path.join(IPC_DIR, 'responses');

// Debug logger that writes to file
const debugLog = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [IPC] ${message}\n`;
  fs.appendFileSync('/tmp/whatsapp-mcp-ipc-debug.log', logMessage);
  console.error(`[IPC] ${message}`);
};

// Ensure directories exist with proper permissions
function ensureDirectories() {
  try {
    if (!fs.existsSync(IPC_DIR)) {
      fs.mkdirSync(IPC_DIR, { mode: 0o755 });
      debugLog(`Created IPC directory: ${IPC_DIR}`);
    }
    
    if (!fs.existsSync(REQUEST_DIR)) {
      fs.mkdirSync(REQUEST_DIR, { mode: 0o755 });
      debugLog(`Created requests directory: ${REQUEST_DIR}`);
    }
    
    if (!fs.existsSync(RESPONSE_DIR)) {
      fs.mkdirSync(RESPONSE_DIR, { mode: 0o755 });
      debugLog(`Created responses directory: ${RESPONSE_DIR}`);
    }
    
    // Ensure directories are writable
    fs.accessSync(REQUEST_DIR, fs.constants.W_OK);
    fs.accessSync(RESPONSE_DIR, fs.constants.W_OK);
    
    debugLog('IPC directories verified with write permissions');
  } catch (error) {
    debugLog(`Error ensuring directories: ${error.message}`);
    // Try to create with default permissions as fallback
    try {
      if (!fs.existsSync(IPC_DIR)) fs.mkdirSync(IPC_DIR);
      if (!fs.existsSync(REQUEST_DIR)) fs.mkdirSync(REQUEST_DIR);
      if (!fs.existsSync(RESPONSE_DIR)) fs.mkdirSync(RESPONSE_DIR);
      debugLog('Created directories with default permissions as fallback');
    } catch (fallbackError) {
      debugLog(`Critical error creating directories: ${fallbackError.message}`);
    }
  }
}

// Generate unique request ID
function generateRequestId() {
  return Date.now() + '-' + Math.random().toString(36).substring(7);
}

// Send request from proxy to primary with improved error handling
export async function sendRequest(operation, params) {
  try {
    ensureDirectories();
    
    const requestId = generateRequestId();
    const requestFile = path.join(REQUEST_DIR, `${requestId}.json`);
    const responseFile = path.join(RESPONSE_DIR, `${requestId}.json`);
    
    debugLog(`Sending request ${requestId} for operation: ${operation}`);
    
      // Write request with error handling
      try {
        fs.writeFileSync(requestFile, JSON.stringify({
          id: requestId,
          operation,
          params,
          timestamp: new Date().toISOString()
        }), { mode: 0o644 });
    } catch (writeError) {
      debugLog(`Error writing request file: ${writeError.message}`);
      throw new Error(`Failed to write request: ${writeError.message}`);
    }
    
    // Wait for response (max 60 seconds for media operations, 30 for others)
    const timeout = operation === 'getMediaFromContact' ? 60000 : 30000;
    const startTime = Date.now();
    
    debugLog(`Waiting for response to ${requestId} (timeout: ${timeout}ms)`);
    
    while (Date.now() - startTime < timeout) {
      try {
        if (fs.existsSync(responseFile)) {
          // Read response with error handling
          let response;
          try {
            const responseData = fs.readFileSync(responseFile, 'utf8');
            response = JSON.parse(responseData);
          } catch (readError) {
            debugLog(`Error reading response file: ${readError.message}`);
            throw new Error(`Failed to read response: ${readError.message}`);
          }
          
          debugLog(`Received response for ${requestId}`);
          
          // Clean up files
          try {
            if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
            if (fs.existsSync(responseFile)) fs.unlinkSync(responseFile);
          } catch (cleanupError) {
            debugLog(`Warning: Failed to clean up request/response files: ${cleanupError.message}`);
          }
          
          if (response.error) {
            debugLog(`Request ${requestId} returned error: ${response.error}`);
            throw new Error(response.error);
          }
          
          return response.result;
        }
      } catch (checkError) {
        if (checkError.code !== 'ENOENT') {
          debugLog(`Error checking response file: ${checkError.message}`);
        }
      }
      
      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Timeout - clean up request file
    debugLog(`Request ${requestId} timed out after ${timeout}ms`);
    try {
      if (fs.existsSync(requestFile)) {
        fs.unlinkSync(requestFile);
      }
    } catch (cleanupError) {
      debugLog(`Warning: Failed to clean up request file after timeout: ${cleanupError.message}`);
    }
    
    throw new Error('Request timeout - primary instance may not be running');
  } catch (error) {
    debugLog(`Request failed: ${error.message}`);
    throw error;
  }
}

// Process requests in primary instance with improved reliability
export function startRequestProcessor(whatsappClient) {
  ensureDirectories();
  
  debugLog('Starting IPC request processor');
  
  // Process existing requests first
  processExistingRequests();
  
  // Set up interval to process new requests
  const processorInterval = setInterval(async () => {
    try {
      await processRequests(whatsappClient);
    } catch (error) {
      debugLog(`Error in request processor: ${error.message}`);
    }
  }, 500); // Check every 500ms
  
  // Return the interval so it can be cleared if needed
  return processorInterval;
}

// Process any existing requests that might have been left from a previous run
async function processExistingRequests() {
  try {
    const files = fs.readdirSync(REQUEST_DIR).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      debugLog(`Found ${files.length} existing requests from previous run`);
      
      // For existing requests, just respond with an error
      for (const file of files) {
        try {
          const requestFile = path.join(REQUEST_DIR, file);
          const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
          const responseFile = path.join(RESPONSE_DIR, `${request.id}.json`);
          
          // Write error response
          fs.writeFileSync(responseFile, JSON.stringify({
            id: request.id,
            error: 'Server was restarted while processing request',
            timestamp: new Date().toISOString()
          }), { mode: 0o644 });
          
          // Clean up request file
          fs.unlinkSync(requestFile);
          
          debugLog(`Responded to existing request ${request.id} with restart error`);
        } catch (error) {
          debugLog(`Error handling existing request ${file}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    debugLog(`Error processing existing requests: ${error.message}`);
  }
}

// Process new incoming requests
async function processRequests(whatsappClient) {
  try {
    const files = fs.readdirSync(REQUEST_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      let request;
      const requestFile = path.join(REQUEST_DIR, file);
      
      // Read request with error handling
      try {
        const requestData = fs.readFileSync(requestFile, 'utf8');
        request = JSON.parse(requestData);
      } catch (readError) {
        debugLog(`Error reading request file ${file}: ${readError.message}`);
        continue; // Skip this file and try the next one
      }
      
      const responseFile = path.join(RESPONSE_DIR, `${request.id}.json`);
      debugLog(`Processing request ${request.id} for operation: ${request.operation}`);
      
      try {
        let result;
          
          switch (request.operation) {
            case 'getChats':
              const chats = await whatsappClient.getChats();
              result = chats.slice(0, request.params.limit || 20).map(chat => ({
                id: chat.id._serialized,
                name: chat.name,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage?.body || '',
                timestamp: chat.lastMessage?.timestamp || 0,
              }));
              break;
              
            case 'getContacts':
              const contacts = await whatsappClient.getContacts();
              result = contacts
                .filter(contact => !contact.isMe && contact.isMyContact)
                .map(contact => ({
                  id: contact.id._serialized,
                  name: contact.name || contact.pushname || contact.number,
                  number: contact.number,
                  profilePicUrl: contact.profilePicUrl,
                  isMyContact: contact.isMyContact,
                }));
              break;
              
            case 'getMessages':
              const chat = await whatsappClient.getChatById(request.params.chatId);
              const messages = await chat.fetchMessages({ limit: request.params.limit || 20 });
              result = messages.map(msg => ({
                id: msg.id._serialized,
                body: msg.body,
                from: msg.from,
                to: msg.to,
                timestamp: msg.timestamp,
                isMe: msg.fromMe,
                hasMedia: msg.hasMedia,
                type: msg.type,
              }));
              break;
              
            case 'searchMessages':
              const allChats = await whatsappClient.getChats();
              const searchResults = [];
              const query = request.params.query?.toLowerCase();
              
              for (const chat of allChats) {
                if (request.params.contactId && chat.id._serialized !== request.params.contactId) {
                  continue;
                }
                
                const messages = await chat.fetchMessages({ limit: 200 });
                
                for (const msg of messages) {
                  // Date filtering
                  if (request.params.dateFrom) {
                    const msgDate = new Date(msg.timestamp * 1000);
                    const fromDate = new Date(request.params.dateFrom);
                    if (msgDate < fromDate) continue;
                  }
                  
                  if (request.params.dateTo) {
                    const msgDate = new Date(msg.timestamp * 1000);
                    const toDate = new Date(request.params.dateTo);
                    if (msgDate > toDate) continue;
                  }

                  // Media type filtering
                  if (request.params.mediaType) {
                    if (request.params.mediaType === 'any' && !msg.hasMedia) {
                      continue;
                    } else if (request.params.mediaType !== 'any' && msg.type !== request.params.mediaType) {
                      continue;
                    }
                  }

                  // Content filtering (skip for media-only searches unless there's a caption)
                  if (query && !request.params.mediaType && !msg.body.toLowerCase().includes(query)) {
                    continue;
                  }

                  // For media searches, also check captions
                  if (query && request.params.mediaType && msg.hasMedia) {
                    const caption = msg.body || '';
                    if (!caption.toLowerCase().includes(query)) {
                      continue;
                    }
                  }

                  searchResults.push({
                    id: msg.id._serialized,
                    body: msg.body,
                    from: msg.from,
                    to: msg.to,
                    timestamp: msg.timestamp,
                    chatId: chat.id._serialized,
                    chatName: chat.name || msg.from,
                    type: msg.type,
                    hasMedia: msg.hasMedia,
                  });
                  
                  if (searchResults.length >= (request.params.limit || 10)) break;
                }
                
                if (searchResults.length >= (request.params.limit || 10)) break;
              }
              
              // Sort by timestamp (newest first)
              searchResults.sort((a, b) => b.timestamp - a.timestamp);
              result = searchResults.slice(0, request.params.limit || 10);
              break;
              
            case 'sendMessage':
              await whatsappClient.sendMessage(request.params.to, request.params.message);
              result = { success: true, message: 'Message sent successfully' };
              break;
              
            case 'getMediaFromContact':
              const targetChat = await whatsappClient.getChatById(request.params.contactId);
              
              // Simple approach: fetch recent messages with larger limit
              const allMessages = await targetChat.fetchMessages({ limit: 300 });
              console.log(`[DEBUG] Fetched ${allMessages.length} messages for media search`);
              
              const mediaFiles = allMessages
                .filter(msg => msg.hasMedia)
                .filter(msg => {
                  if (request.params.mediaType === 'all') return true;
                  if (request.params.mediaType === 'image') return msg.type === 'image';
                  if (request.params.mediaType === 'video') return msg.type === 'video';
                  if (request.params.mediaType === 'audio') return msg.type === 'audio';
                  if (request.params.mediaType === 'document') return msg.type === 'document';
                  return true;
                })
                .slice(0, request.params.limit || 50); // Increased default from 10 to 50
              
              console.log(`[DEBUG] Processing ${mediaFiles.length} media files after filtering`);
              
              const mediaInfo = [];
              
              // Create downloads directory
              const downloadsDir = path.join(process.cwd(), 'downloads');
              if (!fs.existsSync(downloadsDir)) {
                fs.mkdirSync(downloadsDir, { recursive: true });
              }
              
              for (const msg of mediaFiles) {
                try {
                  const media = await msg.downloadMedia();
                  
                  // Determine file extension
                  let extension = '.bin';
                  if (media.mimetype) {
                    if (media.mimetype.includes('jpeg') || media.mimetype.includes('jpg')) extension = '.jpg';
                    else if (media.mimetype.includes('png')) extension = '.png';
                    else if (media.mimetype.includes('gif')) extension = '.gif';
                    else if (media.mimetype.includes('mp4')) extension = '.mp4';
                    else if (media.mimetype.includes('webm')) extension = '.webm';
                    else if (media.mimetype.includes('mov')) extension = '.mov';
                    else if (media.mimetype.includes('avi')) extension = '.avi';
                    else if (media.mimetype.includes('webp')) extension = '.webp';
                    else if (media.mimetype.includes('pdf')) extension = '.pdf';
                    else if (media.mimetype.includes('audio')) extension = '.ogg';
                    else if (media.mimetype.includes('opus')) extension = '.ogg';
                  } else {
                    // Fallback based on message type
                    if (msg.type === 'image') extension = '.jpg';
                    else if (msg.type === 'video') extension = '.mp4';
                    else if (msg.type === 'audio' || msg.type === 'ptt') extension = '.ogg';
                    else if (msg.type === 'document') extension = '.pdf';
                  }
                  
                  // Create filename with timestamp and sender info
                  const timestamp = new Date(msg.timestamp * 1000).toISOString().replace(/[:.]/g, '-');
                  const sender = msg.fromMe ? 'me' : 'contact';
                  const filename = `${timestamp}_${sender}_${msg.id._serialized}${extension}`;
                  const filepath = path.join(downloadsDir, filename);
                  
                  // Save the file
                  fs.writeFileSync(filepath, media.data, 'base64');
                  
                  mediaInfo.push({
                    id: msg.id._serialized,
                    type: msg.type,
                    mimetype: media.mimetype,
                    filename: filename,
                    filepath: filepath,
                    timestamp: msg.timestamp,
                    from: msg.from,
                    fromMe: msg.fromMe,
                    caption: msg.body || '',
                    size: media.data ? Buffer.from(media.data, 'base64').length : 0,
                    saved: true
                  });
                } catch (e) {
                  mediaInfo.push({
                    id: msg.id._serialized,
                    type: msg.type,
                    timestamp: msg.timestamp,
                    from: msg.from,
                    caption: msg.body || '',
                    error: 'Failed to download media: ' + e.message,
                    saved: false
                  });
                }
              }
              
              result = mediaInfo;
              break;
              
            case 'getContactActivity':
              const activityChat = await whatsappClient.getChatById(request.params.contactId);
              const cutoffDate = new Date();
              cutoffDate.setDate(cutoffDate.getDate() - (request.params.days || 30));
              
              const activityMessages = await activityChat.fetchMessages({ limit: 200 });
              const recentActivityMessages = activityMessages.filter(msg => 
                new Date(msg.timestamp * 1000) > cutoffDate
              );

              // Analyze activity patterns
              const activity = {
                contactId: request.params.contactId,
                contactName: activityChat.name,
                totalMessages: recentActivityMessages.length,
                sentByContact: recentActivityMessages.filter(msg => msg.fromMe === false).length,
                sentByMe: recentActivityMessages.filter(msg => msg.fromMe === true).length,
                mediaMessages: recentActivityMessages.filter(msg => msg.hasMedia).length,
                firstMessage: recentActivityMessages.length > 0 ? 
                  new Date(Math.min(...recentActivityMessages.map(m => m.timestamp * 1000))).toISOString() : null,
                lastMessage: recentActivityMessages.length > 0 ? 
                  new Date(Math.max(...recentActivityMessages.map(m => m.timestamp * 1000))).toISOString() : null,
                averageMessagesPerDay: (recentActivityMessages.length / (request.params.days || 30)).toFixed(1),
              };

              result = activity;
              break;
              
            case 'getTodaysMedia':
              // Get today's media by fetching very recent messages and listing them without downloading to avoid timeouts
              const todayChat = await whatsappClient.getChatById(request.params.contactId);
              
              // Fetch only the most recent messages (smaller limit for speed)
              const recentMessages = await todayChat.fetchMessages({ limit: 30 });
              console.log(`[DEBUG] Fetched ${recentMessages.length} recent messages for today's media`);
              
              // Filter for today's media messages (last 24 hours)
              const todayTimestamp = Date.now() / 1000 - 86400; // 24 hours ago
              const todayMediaFiles = recentMessages
                .filter(msg => msg.hasMedia && msg.timestamp > todayTimestamp)
                .filter(msg => {
                  if (request.params.mediaType === 'all') return true;
                  if (request.params.mediaType === 'image') return msg.type === 'image';
                  if (request.params.mediaType === 'video') return msg.type === 'video';
                  return true;
                });
              
              console.log(`[DEBUG] Found ${todayMediaFiles.length} today's media files`);
              
              const todayMediaInfo = [];
              
              // Just list the media files without downloading to avoid timeouts
              for (const msg of todayMediaFiles) {
                todayMediaInfo.push({
                  id: msg.id._serialized,
                  type: msg.type,
                  timestamp: msg.timestamp,
                  timestampISO: new Date(msg.timestamp * 1000).toISOString(),
                  from: msg.from,
                  fromMe: msg.fromMe,
                  caption: msg.body || '',
                  hasMedia: msg.hasMedia,
                  messageType: msg.type,
                  isToday: true,
                  note: 'Media identified but not downloaded to avoid timeouts'
                });
              }
              
              result = todayMediaInfo;
              break;
              
            default:
              throw new Error(`Unknown operation: ${request.operation}`);
          }
          
          // Write response
          fs.writeFileSync(responseFile, JSON.stringify({
            id: request.id,
            result,
            timestamp: new Date().toISOString()
          }), { mode: 0o644 });
          
        } catch (error) {
          // Write error response
          fs.writeFileSync(responseFile, JSON.stringify({
            id: request.id,
            error: error.message,
            timestamp: new Date().toISOString()
          }), { mode: 0o644 });
        }
      }
    } catch (error) {
      console.error('[DEBUG] Request processor error:', error);
    }
}
