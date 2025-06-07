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
  
  // Wait for response (max 60 seconds for media operations, 30 for others)
  const timeout = operation === 'getMediaFromContact' ? 60000 : 30000;
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
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
                
                const messages = await chat.fetchMessages({ limit: 100 });
                const matches = messages.filter(msg => 
                  !query || msg.body.toLowerCase().includes(query)
                );
                
                searchResults.push(...matches.slice(0, request.params.limit || 10));
                if (searchResults.length >= (request.params.limit || 10)) break;
              }
              
              result = searchResults.map(msg => ({
                id: msg.id._serialized,
                body: msg.body,
                from: msg.from,
                to: msg.to,
                timestamp: msg.timestamp,
                chatId: msg.from,
                chatName: msg.chat?.name || msg.from,
              }));
              break;
              
            case 'sendMessage':
              await whatsappClient.sendMessage(request.params.to, request.params.message);
              result = { success: true, message: 'Message sent successfully' };
              break;
              
            case 'getMediaFromContact':
              const targetChat = await whatsappClient.getChatById(request.params.contactId);
              const mediaMessages = await targetChat.fetchMessages({ limit: 100 });
              
              const mediaFiles = mediaMessages
                .filter(msg => msg.hasMedia)
                .filter(msg => {
                  if (request.params.mediaType === 'all') return true;
                  if (request.params.mediaType === 'image') return msg.type === 'image';
                  if (request.params.mediaType === 'video') return msg.type === 'video';
                  if (request.params.mediaType === 'audio') return msg.type === 'audio';
                  if (request.params.mediaType === 'document') return msg.type === 'document';
                  return true;
                })
                .slice(0, request.params.limit || 10);
              
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
                    else if (media.mimetype.includes('webp')) extension = '.webp';
                    else if (media.mimetype.includes('pdf')) extension = '.pdf';
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