// Inter-process communication bridge for WhatsApp operations
import fs from 'fs';
import path from 'path';

const IPC_DIR = '/tmp/whatsapp-mcp-ipc';
const REQUEST_DIR = path.join(IPC_DIR, 'requests');
const RESPONSE_DIR = path.join(IPC_DIR, 'responses');

// Ensure directories exist
function ensureDirectories() {
  if (!fs.existsSync(IPC_DIR)) fs.mkdirSync(IPC_DIR);
  if (!fs.existsSync(REQUEST_DIR)) fs.mkdirSync(REQUEST_DIR);
  if (!fs.existsSync(RESPONSE_DIR)) fs.mkdirSync(RESPONSE_DIR);
}

// Generate unique request ID
function generateRequestId() {
  return Date.now() + '-' + Math.random().toString(36).substring(7);
}

// Send request from proxy to primary
export async function sendRequest(operation, params) {
  ensureDirectories();
  
  const requestId = generateRequestId();
  const requestFile = path.join(REQUEST_DIR, `${requestId}.json`);
  const responseFile = path.join(RESPONSE_DIR, `${requestId}.json`);
  
  // Write request
  fs.writeFileSync(requestFile, JSON.stringify({
    id: requestId,
    operation,
    params,
    timestamp: new Date().toISOString()
  }));
  
  // Wait for response (max 30 seconds)
  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    if (fs.existsSync(responseFile)) {
      const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      
      // Clean up files
      fs.unlinkSync(requestFile);
      fs.unlinkSync(responseFile);
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      return response.result;
    }
    
    // Wait 100ms before checking again
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Timeout - clean up request file
  if (fs.existsSync(requestFile)) {
    fs.unlinkSync(requestFile);
  }
  
  throw new Error('Request timeout - primary instance may not be running');
}

// Process requests in primary instance
export function startRequestProcessor(whatsappClient) {
  ensureDirectories();
  
  setInterval(async () => {
    try {
      const files = fs.readdirSync(REQUEST_DIR).filter(f => f.endsWith('.json'));
      
      for (const file of files) {
        const requestFile = path.join(REQUEST_DIR, file);
        const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
        const responseFile = path.join(RESPONSE_DIR, `${request.id}.json`);
        
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
              
            default:
              throw new Error(`Unknown operation: ${request.operation}`);
          }
          
          // Write response
          fs.writeFileSync(responseFile, JSON.stringify({
            id: request.id,
            result,
            timestamp: new Date().toISOString()
          }));
          
        } catch (error) {
          // Write error response
          fs.writeFileSync(responseFile, JSON.stringify({
            id: request.id,
            error: error.message,
            timestamp: new Date().toISOString()
          }));
        }
      }
    } catch (error) {
      console.error('[DEBUG] Request processor error:', error);
    }
  }, 500); // Check every 500ms
}