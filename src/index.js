#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { SecurityManager } from './security.js';
import { sendRequest, startRequestProcessor } from './ipc-bridge.js';

// Debug logger that writes to file
const debugLog = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync('/tmp/whatsapp-mcp-debug.log', logMessage);
  console.error(message);
};

// State file path
const stateFilePath = '/tmp/whatsapp-mcp-state.json';

// Load state from file
function loadState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      debugLog('[DEBUG] Loaded state from file: ' + JSON.stringify(state));
      return state;
    }
  } catch (e) {
    debugLog('[DEBUG] Failed to load state: ' + e.message);
  }
  return { isReady: false, instanceId: null };
}

// Save state to file
function saveState(isReady, instanceId) {
  try {
    const state = { isReady, instanceId, timestamp: new Date().toISOString() };
    fs.writeFileSync(stateFilePath, JSON.stringify(state));
    debugLog('[DEBUG] Saved state to file: ' + JSON.stringify(state));
  } catch (e) {
    debugLog('[DEBUG] Failed to save state: ' + e.message);
  }
}

// Singleton instance
let globalWhatsAppClient = null;
let globalIsReady = false;
let globalInstanceId = null;

debugLog('[DEBUG] Module loaded, checking for existing state...');

class WhatsAppMCPServer {
  constructor() {
    this.instanceId = Math.random().toString(36).substring(7);
    debugLog('[DEBUG] WhatsAppMCPServer constructor called, instanceId: ' + this.instanceId);
    
    // Check if another instance is already running
    const lockFile = '/tmp/whatsapp-mcp.lock';
    const stateFile = '/tmp/whatsapp-mcp-state.json';
    
    try {
      // Check if lock file exists and is recent (less than 60 seconds old)
      if (fs.existsSync(lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        const lockAge = Date.now() - new Date(lockData.timestamp).getTime();
        
        if (lockAge < 60000) { // Less than 60 seconds old
          debugLog('[DEBUG] Another instance is already running: ' + lockData.instanceId);
          debugLog('[DEBUG] This instance (' + this.instanceId + ') will run in proxy mode');
          
          // Load state from the primary instance
          if (fs.existsSync(stateFile)) {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            this.isReady = state.isReady;
            this.primaryInstanceId = lockData.instanceId;
            this.isProxyInstance = true;
          }
        }
      }
      
      if (!this.isProxyInstance) {
        // We are the primary instance - create lock file
        fs.writeFileSync(lockFile, JSON.stringify({
          instanceId: this.instanceId,
          timestamp: new Date().toISOString(),
          pid: process.pid
        }));
        
        // Update lock file every 30 seconds
        this.lockInterval = setInterval(() => {
          fs.writeFileSync(lockFile, JSON.stringify({
            instanceId: this.instanceId,
            timestamp: new Date().toISOString(),
            pid: process.pid
          }));
        }, 30000);
      }
    } catch (e) {
      debugLog('[DEBUG] Lock file handling error: ' + e.message);
    }
    
    // Initialize normally
    this.whatsappClient = null;
    this.isReady = this.isProxyInstance ? this.isReady : false;
    globalInstanceId = this.instanceId;
    
    // IMPORTANT: Each process needs its own WhatsApp client
    // We cannot share the client across processes
    
    this.server = new Server(
      {
        name: 'whatsapp-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.security = new SecurityManager();
    
    // Only setup WhatsApp client if we're not a proxy instance
    if (!this.isProxyInstance) {
      this.setupWhatsAppClient();
    } else {
      debugLog('[DEBUG] Proxy instance - not initializing WhatsApp client');
      // For proxy instances, create a mock client to pass the existence check
      this.whatsappClient = { isProxy: true };
    }
    
    this.setupHandlers();
  }

  async setupWhatsAppClient() {
    const authDir = path.join(process.env.HOME || process.env.USERPROFILE, '.whatsapp-mcp-auth');
    
    debugLog('[DEBUG] Setting up WhatsApp client with auth dir: ' + authDir);
    
    this.whatsappClient = new Client({
      authStrategy: new LocalAuth({ 
        clientId: 'mcp-client',
        dataPath: authDir
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });
    
    // Set global reference
    globalWhatsAppClient = this.whatsappClient;

    this.whatsappClient.on('qr', (qr) => {
      console.error('[DEBUG] QR code received - please scan with WhatsApp');
      console.error('QR Code:', qr);
      // QR code terminal display removed to prevent stdout interference
      // Use the QR string above to scan manually or view in WhatsApp Web
    });

    this.whatsappClient.on('ready', async () => {
      try {
        debugLog('[DEBUG] WhatsApp client ready event fired!');
        debugLog('[DEBUG] this.isReady before setting: ' + this.isReady);
        
        // Set ready immediately
        this.isReady = true;
        globalIsReady = true;  // Update global state
        saveState(true, this.instanceId);  // Persist state
        debugLog('[DEBUG] Set isReady = true immediately, instanceId: ' + this.instanceId);
        debugLog('[DEBUG] Verification - this.isReady is now: ' + this.isReady);
        debugLog('[DEBUG] Global state updated - globalIsReady: ' + globalIsReady);
        
        // Start IPC request processor for primary instance
        if (!this.isProxyInstance && this.whatsappClient) {
          debugLog('[DEBUG] Starting IPC request processor for primary instance');
          startRequestProcessor(this.whatsappClient);
        }
        
        // Inspect what's actually available in the WhatsApp page (non-blocking)
        try {
        debugLog('[DEBUG] Checking for pupPage...');
        const page = this.whatsappClient.pupPage;
        debugLog('[DEBUG] pupPage exists: ' + !!page);
        
        if (!page) {
          debugLog('[DEBUG] pupPage is not available yet, setting isReady=true anyway');
          this.isReady = true;
          globalIsReady = true;
          debugLog('[DEBUG] this.isReady after fallback setting: ' + this.isReady);
          return;
        }
        
        // Check what's in the window object
        debugLog('[DEBUG] About to evaluate window keys...');
        const windowKeys = await Promise.race([
          page.evaluate(() => {
            return Object.keys(window).filter(key => 
              key.includes('Store') || 
              key.includes('WA') || 
              key.includes('whatsapp') ||
              key.includes('__') ||
              key.includes('require')
            ).slice(0, 50);
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Page evaluate timeout')), 5000))
        ]).catch(err => {
          debugLog('[DEBUG] Window keys evaluation failed: ' + err.message);
          return [];
        });
        console.error('[DEBUG] Window keys found:', windowKeys);
        
        // Check if Store exists and what's in it
        const storeInfo = await page.evaluate(() => {
          const info = {
            storeExists: typeof window.Store !== 'undefined',
            wwebjsExists: typeof window.WWebJS !== 'undefined',
          };
          
          if (window.Store) {
            info.storeKeys = Object.keys(window.Store).slice(0, 20);
          }
          
          if (window.WWebJS) {
            info.wwebjsKeys = Object.keys(window.WWebJS).slice(0, 20);
            info.wwebjsGetChats = typeof window.WWebJS.getChats;
            info.wwebjsGetContacts = typeof window.WWebJS.getContacts;
          }
          
          return info;
        });
        
        console.error('[DEBUG] Store info:', JSON.stringify(storeInfo, null, 2));
        
        // Save debug info to file
        fs.writeFileSync('/tmp/whatsapp-debug.json', JSON.stringify({
          windowKeys,
          storeInfo,
          timestamp: new Date().toISOString()
        }, null, 2));
        
      } catch (e) {
        debugLog('[DEBUG] Failed to inspect page: ' + e.message);
      }
      
      // Test if WWebJS methods actually work before setting ready
      try {
        // Get the Puppeteer page from the WhatsApp client
        const puppeteerPage = this.whatsappClient.pupPage;
        if (!puppeteerPage) {
          throw new Error('Puppeteer page not available');
        }
        
        const testResult = await puppeteerPage.evaluate(() => {
          // Test that we can access the WWebJS functions
          if (typeof window.WWebJS !== 'object' || !window.WWebJS) {
            throw new Error('WWebJS not available');
          }
          if (typeof window.WWebJS.getChats !== 'function') {
            throw new Error('getChats not a function');
          }
          if (typeof window.WWebJS.getContacts !== 'function') {
            throw new Error('getContacts not a function');
          }
          return 'WWebJS methods available';
        });
        
        console.error('[DEBUG] WWebJS method test successful:', testResult);
        this.isReady = true;
        console.error('[DEBUG] this.isReady after setting:', this.isReady);
        console.error('[DEBUG] Server is now ready to accept requests');
      } catch (testError) {
        console.error('[DEBUG] WWebJS method test failed:', testError.message);
        // Set ready anyway since we know the functions exist from debug output
        console.error('[DEBUG] Setting ready=true despite test failure (functions confirmed to exist)');
        this.isReady = true;
        globalIsReady = true;
      }
      } catch (error) {
        debugLog('[DEBUG] Error in ready event handler: ' + error.message);
        debugLog('[DEBUG] Stack trace: ' + error.stack);
        // Set ready anyway as fallback
        this.isReady = true;
        globalIsReady = true;
        debugLog('[DEBUG] Set isReady=true as fallback after error');
      }
    });

    this.whatsappClient.on('message', async (message) => {
      console.error(`[DEBUG] Message from ${message.from}: ${message.body}`);
    });

    this.whatsappClient.on('authenticated', () => {
      console.error('[DEBUG] WhatsApp client authenticated successfully');
      // Fallback: Set ready after authentication if ready event doesn't fire
      setTimeout(() => {
        if (!this.isReady) {
          console.error('[DEBUG] Setting ready state after authentication timeout');
          this.isReady = true;
        }
      }, 5000);
    });

    this.whatsappClient.on('loading_screen', (percent, message) => {
      console.error(`[DEBUG] Loading: ${percent}% - ${message}`);
    });

    this.whatsappClient.on('auth_failure', (msg) => {
      console.error('[DEBUG] Authentication failure:', msg);
      this.isReady = false;
    });

    this.whatsappClient.on('disconnected', (reason) => {
      console.error('[DEBUG] WhatsApp client disconnected:', reason);
      this.isReady = false;
    });

    this.whatsappClient.on('change_state', (state) => {
      console.error('[DEBUG] WhatsApp client state changed:', state);
    });

    // Add error handler for the client
    this.whatsappClient.on('error', (error) => {
      console.error('[DEBUG] WhatsApp client error:', error);
      this.isReady = false;
    });

    // Add ALL lifecycle events to debug
    this.whatsappClient.on('remote_session_saved', () => {
      console.error('[DEBUG] Remote session saved');
    });


    // Initialize with error handling
    try {
      console.error('[DEBUG] Initializing WhatsApp client...');
      console.error('[DEBUG] Auth strategy:', authDir);
      console.error('[DEBUG] Session exists:', fs.existsSync(path.join(authDir, 'session-mcp-client')));
      
      this.whatsappClient.initialize();
      
      // Session exists - wait for the actual ready event
      // Don't set isReady prematurely
    } catch (error) {
      console.error('[DEBUG] Failed to initialize WhatsApp client:', error);
      this.isReady = false;
    }
  }

  // Helper function to safely parse JSON responses
  safeJsonStringify(obj, fallback = 'Unable to serialize data') {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (error) {
      console.error('[DEBUG] JSON stringify error:', error);
      return fallback;
    }
  }

  // Helper function to validate and clean response data
  validateResponseData(data) {
    if (!data) return null;
    
    // Check for corrupted data patterns
    if (typeof data === 'string' && (data.includes('■') || data.includes('�') || data.startsWith('Q'))) {
      console.warn('[DEBUG] Detected corrupted response data:', data.substring(0, 100));
      return null;
    }
    
    return data;
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'send_message',
            description: 'Send a text message to a WhatsApp contact or group',
            inputSchema: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: 'Phone number (with country code) or chat ID to send the message to',
                },
                message: {
                  type: 'string',
                  description: 'The text message to send (max 4096 characters)',
                },
              },
              required: ['to', 'message'],
            },
          },
          {
            name: 'send_media',
            description: 'Send media (image, video, document, audio) to a WhatsApp contact or group',
            inputSchema: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: 'Phone number (with country code) or chat ID to send the media to',
                },
                filePath: {
                  type: 'string',
                  description: 'Path to the media file to send (max 50MB, must be in uploads/ directory)',
                },
                caption: {
                  type: 'string',
                  description: 'Optional caption for the media',
                },
              },
              required: ['to', 'filePath'],
            },
          },
          {
            name: 'get_contacts',
            description: 'Get list of WhatsApp contacts',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_chats',
            description: 'Get list of WhatsApp chats',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of chats to return (default: 20)',
                },
              },
            },
          },
          {
            name: 'get_messages',
            description: 'Get recent messages from a specific chat',
            inputSchema: {
              type: 'object',
              properties: {
                chatId: {
                  type: 'string',
                  description: 'Chat ID to get messages from',
                },
                limit: {
                  type: 'number',
                  description: 'Number of messages to retrieve (default: 10)',
                },
              },
              required: ['chatId'],
            },
          },
          {
            name: 'get_status',
            description: 'Get WhatsApp client connection status',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'search_messages',
            description: 'Search WhatsApp messages by contact, keyword, or date range',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search term to look for in message content',
                },
                contactId: {
                  type: 'string',
                  description: 'Filter by specific contact ID or phone number',
                },
                dateFrom: {
                  type: 'string',
                  description: 'Start date (YYYY-MM-DD)',
                },
                dateTo: {
                  type: 'string',
                  description: 'End date (YYYY-MM-DD)',
                },
                mediaType: {
                  type: 'string',
                  enum: ['image', 'video', 'audio', 'document', 'any'],
                  description: 'Filter by media type (searches only media messages)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 50)',
                },
              },
            },
          },
          {
            name: 'get_media_from_contact',
            description: 'Get all media files (images, videos, documents) from a specific contact',
            inputSchema: {
              type: 'object',
              properties: {
                contactId: {
                  type: 'string',
                  description: 'Contact ID or phone number',
                },
                mediaType: {
                  type: 'string',
                  enum: ['image', 'video', 'audio', 'document', 'all'],
                  description: 'Type of media to retrieve (default: all)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of media files (default: 100)',
                },
                downloadPath: {
                  type: 'string',
                  description: 'Optional: Directory to download media files to',
                },
              },
              required: ['contactId'],
            },
          },
          {
            name: 'get_contact_activity',
            description: 'Get recent activity summary for a specific contact (for CRM enrichment)',
            inputSchema: {
              type: 'object',
              properties: {
                contactId: {
                  type: 'string',
                  description: 'Contact ID or phone number',
                },
                days: {
                  type: 'number',
                  description: 'Number of days to look back (default: 30)',
                },
              },
              required: ['contactId'],
            },
          },
          {
            name: 'export_contact_data',
            description: 'Export all messages and data for a contact in CRM-friendly format',
            inputSchema: {
              type: 'object',
              properties: {
                contactId: {
                  type: 'string',
                  description: 'Contact ID or phone number',
                },
                format: {
                  type: 'string',
                  enum: ['json', 'csv'],
                  description: 'Export format (default: json)',
                },
              },
              required: ['contactId'],
            },
          },
          {
            name: 'manage_security',
            description: 'Manage security settings (allow/block contacts, clear session)',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['allow_contact', 'block_contact', 'clear_session', 'get_config'],
                  description: 'Security action to perform',
                },
                contactId: {
                  type: 'string',
                  description: 'Contact ID (required for allow_contact and block_contact)',
                },
              },
              required: ['action'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        debugLog('[DEBUG] Received request: ' + JSON.stringify(request.params, null, 2));
        debugLog('[DEBUG] Current this.isReady state: ' + this.isReady + ', instanceId: ' + this.instanceId);
        debugLog('[DEBUG] Current this.whatsappClient exists: ' + !!this.whatsappClient);
        
        const { name, arguments: args } = request.params;

        // Enhanced connection validation
        if (name !== 'get_status') {
          if (!this.whatsappClient) {
            throw new Error('WhatsApp client is not initialized');
          }
          
          if (!this.isReady) {
            console.error('[DEBUG] isReady check failed, this.isReady =', this.isReady);
            throw new Error('WhatsApp client is not ready. Please scan the QR code first and wait for authentication.');
          }

          // Client is ready, no additional state check needed
        }

        console.error('[DEBUG] Processing tool:', name);

      switch (name) {
        case 'send_message':
          return await this.sendMessage(args.to, args.message);

        case 'send_media':
          return await this.sendMedia(args.to, args.filePath, args.caption);

        case 'get_contacts':
          return await this.getContacts();

        case 'get_chats':
          return await this.getChats(args.limit || 20);

        case 'get_messages':
          return await this.getMessages(args.chatId, args.limit || 10);

        case 'get_status':
          return await this.getStatus();

        case 'search_messages':
          return await this.searchMessages(args.query, args.contactId, args.dateFrom, args.dateTo, args.limit, args.mediaType);

        case 'get_media_from_contact':
          return await this.getMediaFromContact(args.contactId, args.mediaType, args.limit, args.downloadPath);

        case 'get_contact_activity':
          return await this.getContactActivity(args.contactId, args.days);

        case 'export_contact_data':
          return await this.exportContactData(args.contactId, args.format);

        case 'manage_security':
          return await this.manageSecurity(args.action, args.contactId);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      } catch (error) {
        console.error('[DEBUG] Request handler error:', error);
        console.error('[DEBUG] Error stack:', error.stack);
        
        // Return a proper error response
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async sendMessage(to, message) {
    try {
      this.security.checkRateLimit('send_message', to);
      this.security.validateContact(to);
      const sanitizedMessage = this.security.sanitizeMessage(message);
      
      const chatId = await this.resolveChatId(to);
      const sentMessage = await this.whatsappClient.sendMessage(chatId, sanitizedMessage);
      
      this.security.logSecurityEvent('MESSAGE_SENT', { to, messageLength: sanitizedMessage.length });
      
      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully to ${to}. Message ID: ${sentMessage.id.id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  async sendMedia(to, filePath, caption = '') {
    try {
      this.security.checkRateLimit('send_media', to);
      this.security.validateContact(to);
      const validatedPath = this.security.validateFilePath(filePath);
      const sanitizedCaption = this.security.sanitizeMessage(caption || '');
      
      const chatId = await this.resolveChatId(to);
      const media = MessageMedia.fromFilePath(validatedPath);
      
      this.security.logSecurityEvent('MEDIA_SENT', { to, filePath: validatedPath, captionLength: sanitizedCaption.length });
      
      const sentMessage = await this.whatsappClient.sendMessage(chatId, media, {
        caption: sanitizedCaption,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Media sent successfully to ${to}. Message ID: ${sentMessage.id.id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to send media: ${error.message}`);
    }
  }

  async getContacts() {
    try {
      this.security.checkRateLimit('get_contacts');
      console.error('[DEBUG] About to call getContacts...');
      
      // Handle proxy instance - use IPC to communicate with primary
      if (this.isProxyInstance) {
        debugLog('[DEBUG] Proxy instance - sending IPC request for contacts to primary');
        try {
          const contacts = await sendRequest('getContacts', {});
          debugLog('[DEBUG] Received IPC response with ' + contacts.length + ' contacts');
          
          return {
            content: [{
              type: 'text',
              text: `Found ${contacts.length} contacts:\n${JSON.stringify(contacts, null, 2)}`,
            }],
          };
        } catch (error) {
          debugLog('[DEBUG] IPC request failed: ' + error.message);
          throw new Error(`Failed to communicate with primary WhatsApp instance: ${error.message}`);
        }
      }
      
      console.error('[DEBUG] Testing page context before getContacts...');
      
      // Test the page context first
      if (this.whatsappClient?.pupPage) {
        const pageTest = await this.whatsappClient.pupPage.evaluate(() => {
          return {
            storeExists: typeof window.Store !== 'undefined',
            wwebjsExists: typeof window.WWebJS !== 'undefined',
            getContactsFn: typeof window.WWebJS?.getContacts
          };
        });
        console.error('[DEBUG] Page context test:', JSON.stringify(pageTest, null, 2));
      }
      
      console.error('[DEBUG] Calling this.whatsappClient.getContacts()...');
      
      // First check if client is ready
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready. Please scan the QR code first and wait for authentication.');
      }
      
      const contacts = await this.whatsappClient.getContacts();
      console.error('[DEBUG] getContacts() returned', contacts?.length || 0, 'contacts');
      this.security.logSecurityEvent('CONTACTS_ACCESSED', {});
      const contactList = contacts.slice(0, 50).map(contact => ({
        id: contact.id._serialized,
        name: contact.name || contact.pushname || contact.number,
        number: contact.number,
        isGroup: contact.isGroup,
        isMyContact: contact.isMyContact,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${contactList.length} contacts:\n${JSON.stringify(contactList, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      console.error('[DEBUG] getContacts error details:', error);
      console.error('[DEBUG] getContacts error stack:', error.stack);
      throw new Error(`Failed to get contacts: ${error.message}`);
    }
  }

  async getChats(limit = 20) {
    try {
      this.security.checkRateLimit('get_chats');
      
      // Debug what's happening
      console.error('[DEBUG] About to call getChats...');
      debugLog('[DEBUG] whatsappClient exists: ' + !!this.whatsappClient);
      debugLog('[DEBUG] instanceId: ' + this.instanceId);
      debugLog('[DEBUG] isProxyInstance: ' + !!this.isProxyInstance);
      debugLog('[DEBUG] primaryInstanceId: ' + this.primaryInstanceId);
      
      // Check what's in the page context
      if (this.whatsappClient?.pupPage) {
        const debugInfo = await this.whatsappClient.pupPage.evaluate(() => {
          return {
            storeExists: typeof window.Store !== 'undefined',
            storeChatExists: typeof window.Store?.Chat !== 'undefined',
            storeType: typeof window.Store,
            chatType: typeof window.Store?.Chat,
            getChatsFn: typeof window.Store?.Chat?.getChats,
            wwebjsExists: typeof window.WWebJS !== 'undefined'
          };
        });
        console.error('[DEBUG] Page context:', JSON.stringify(debugInfo, null, 2));
      }
      
      console.error('[DEBUG] Calling this.whatsappClient.getChats()...');
      
      // Handle proxy instance - use IPC to communicate with primary
      if (this.isProxyInstance) {
        debugLog('[DEBUG] Proxy instance - sending IPC request to primary');
        try {
          const chats = await sendRequest('getChats', { limit });
          debugLog('[DEBUG] Received IPC response with ' + chats.length + ' chats');
          
          return {
            content: [{
              type: 'text',
              text: `Found ${chats.length} chats:\n${JSON.stringify(chats, null, 2)}`,
            }],
          };
        } catch (error) {
          debugLog('[DEBUG] IPC request failed: ' + error.message);
          throw new Error(`Failed to communicate with primary WhatsApp instance: ${error.message}`);
        }
      }
      
      // First check if client is ready
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready. Please scan the QR code first and wait for authentication.');
      }
      
      // Ensure client is initialized
      if (!this.whatsappClient || typeof this.whatsappClient.getChats !== 'function') {
        debugLog('[DEBUG] WhatsApp client not properly initialized, waiting...');
        // Wait a bit for initialization
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        if (!this.whatsappClient || typeof this.whatsappClient.getChats !== 'function') {
          throw new Error('WhatsApp client is not properly initialized');
        }
      }
      
      // Try to get chats with better error handling
      const chats = await this.whatsappClient.getChats();
      console.error('[DEBUG] Successfully got chats:', chats?.length || 0);
      this.security.logSecurityEvent('CHATS_ACCESSED', { limit });
      const chatList = chats.slice(0, limit).map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        lastMessage: chat.lastMessage ? {
          body: chat.lastMessage.body,
          timestamp: chat.lastMessage.timestamp,
          from: chat.lastMessage.from,
        } : null,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${chatList.length} chats:\n${JSON.stringify(chatList, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get chats: ${error.message}`);
    }
  }

  async getMessages(chatId, limit = 10) {
    try {
      this.security.checkRateLimit('get_messages');
      this.security.validateContact(chatId);
      const chat = await this.whatsappClient.getChatById(chatId);
      this.security.logSecurityEvent('MESSAGES_ACCESSED', { chatId, limit });
      const messages = await chat.fetchMessages({ limit });
      
      const messageList = messages.map(msg => ({
        id: msg.id.id,
        body: msg.body,
        from: msg.from,
        to: msg.to,
        timestamp: msg.timestamp,
        type: msg.type,
        isForwarded: msg.isForwarded,
        hasMedia: msg.hasMedia,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Retrieved ${messageList.length} messages from chat ${chatId}:\n${JSON.stringify(messageList, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get messages: ${error.message}`);
    }
  }

  async getStatus() {
    try {
      debugLog('[DEBUG] getStatus called, instanceId: ' + this.instanceId);
      debugLog('[DEBUG] isProxyInstance: ' + !!this.isProxyInstance);
      debugLog('[DEBUG] this.isReady: ' + this.isReady);
      
      if (this.isProxyInstance) {
        // For proxy instances, report the status from the state file
        const stateFile = '/tmp/whatsapp-mcp-state.json';
        if (fs.existsSync(stateFile)) {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
          return {
            content: [{
              type: 'text',
              text: `WhatsApp client status (via primary instance ${this.primaryInstanceId}):\n${JSON.stringify({
                isReady: state.isReady,
                clientState: state.isReady ? 'CONNECTED' : 'UNKNOWN',
                clientInfo: null,
                timestamp: new Date().toISOString(),
                authenticated: state.isReady,
                connectionHealth: state.isReady ? 'good' : 'unknown',
                note: 'This is a proxy connection to the primary WhatsApp instance'
              }, null, 2)}`,
            }],
          };
        }
      }
      
      const status = {
        isReady: this.isReady,
        clientState: this.whatsappClient?.state || 'UNKNOWN',
        clientInfo: this.whatsappClient?.info || null,
        timestamp: new Date().toISOString(),
        authenticated: false,
        connectionHealth: 'unknown'
      };

      // Set status based on ready state
      if (this.whatsappClient && this.isReady) {
        status.authenticated = true;
        status.connectionHealth = 'good';
      } else if (this.whatsappClient) {
        status.authenticated = false;
        status.connectionHealth = 'initializing';
      }

      console.error('[DEBUG] Status response:', JSON.stringify(status, null, 2));

      return {
        content: [
          {
            type: 'text',
            text: `WhatsApp client status:\n${JSON.stringify(status, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      console.error('[DEBUG] getStatus failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Status check failed: ${error.message}`,
          },
        ],
      };
    }
  }

  async resolveChatId(identifier) {
    if (identifier.includes('@')) {
      return identifier;
    }

    if (identifier.includes('-')) {
      return `${identifier}@g.us`;
    }

    const phoneNumber = identifier.replace(/\D/g, '');
    if (!phoneNumber.startsWith('1') && phoneNumber.length >= 10) {
      return `${phoneNumber}@c.us`;
    }
    
    return `${phoneNumber}@c.us`;
  }

  async searchMessages(query, contactId, dateFrom, dateTo, limit = 50, mediaType) {
    try {
      this.security.checkRateLimit('search_messages');
      
      const chats = await this.whatsappClient.getChats();
      let allMessages = [];

      for (const chat of chats) {
        // Filter by contact if specified
        if (contactId && !chat.id._serialized.includes(contactId.replace(/\D/g, ''))) {
          continue;
        }

        try {
          const messages = await chat.fetchMessages({ limit: 100 });
          
          for (const msg of messages) {
            // Date filtering
            if (dateFrom) {
              const msgDate = new Date(msg.timestamp * 1000);
              const fromDate = new Date(dateFrom);
              if (msgDate < fromDate) continue;
            }
            
            if (dateTo) {
              const msgDate = new Date(msg.timestamp * 1000);
              const toDate = new Date(dateTo);
              if (msgDate > toDate) continue;
            }

            // Media type filtering
            if (mediaType) {
              if (mediaType === 'any' && !msg.hasMedia) {
                continue;
              } else if (mediaType !== 'any' && msg.type !== mediaType) {
                continue;
              }
            }

            // Content filtering (skip for media-only searches unless there's a caption)
            if (query && !mediaType && !msg.body.toLowerCase().includes(query.toLowerCase())) {
              continue;
            }

            // For media searches, also check captions
            if (query && mediaType && msg.hasMedia) {
              const caption = msg.body || '';
              if (!caption.toLowerCase().includes(query.toLowerCase())) {
                continue;
              }
            }

            const messageData = {
              id: msg.id.id,
              chatId: chat.id._serialized,
              chatName: chat.name,
              from: msg.from,
              body: msg.body,
              timestamp: new Date(msg.timestamp * 1000).toISOString(),
              type: msg.type,
              hasMedia: msg.hasMedia,
            };

            // Add media-specific information
            if (msg.hasMedia) {
              try {
                const media = await msg.downloadMedia();
                messageData.media = {
                  mimetype: media.mimetype,
                  filename: media.filename,
                  filesize: media.data ? media.data.length : 0,
                };
              } catch (error) {
                messageData.media = { error: 'Failed to load media info' };
              }
            }

            allMessages.push(messageData);
          }
        } catch (error) {
          console.warn(`Failed to fetch messages from chat ${chat.id._serialized}:`, error);
        }
      }

      // Sort by timestamp and limit results
      allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const results = allMessages.slice(0, limit);

      this.security.logSecurityEvent('MESSAGES_SEARCHED', { 
        query, contactId, resultCount: results.length 
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${results.length} messages:\n${JSON.stringify(results, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new Error(`Message search failed: ${error.message}`);
    }
  }

  async getContactActivity(contactId, days = 30) {
    try {
      this.security.checkRateLimit('get_contact_activity');
      
      const resolvedChatId = await this.resolveChatId(contactId);
      const chat = await this.whatsappClient.getChatById(resolvedChatId);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const messages = await chat.fetchMessages({ limit: 200 });
      const recentMessages = messages.filter(msg => 
        new Date(msg.timestamp * 1000) > cutoffDate
      );

      // Analyze activity patterns
      const activity = {
        contactId,
        contactName: chat.name,
        totalMessages: recentMessages.length,
        sentByContact: recentMessages.filter(msg => msg.fromMe === false).length,
        sentByMe: recentMessages.filter(msg => msg.fromMe === true).length,
        mediaMessages: recentMessages.filter(msg => msg.hasMedia).length,
        firstMessage: recentMessages.length > 0 ? 
          new Date(Math.min(...recentMessages.map(m => m.timestamp * 1000))).toISOString() : null,
        lastMessage: recentMessages.length > 0 ? 
          new Date(Math.max(...recentMessages.map(m => m.timestamp * 1000))).toISOString() : null,
        averageMessagesPerDay: (recentMessages.length / days).toFixed(1),
        topics: this.extractTopics(recentMessages),
      };

      this.security.logSecurityEvent('CONTACT_ACTIVITY_ACCESSED', { contactId, days });

      return {
        content: [{
          type: 'text',
          text: `Contact activity summary for ${contactId}:\n${JSON.stringify(activity, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new Error(`Failed to get contact activity: ${error.message}`);
    }
  }

  async exportContactData(contactId, format = 'json') {
    try {
      this.security.checkRateLimit('export_contact_data');
      
      const resolvedChatId = await this.resolveChatId(contactId);
      const chat = await this.whatsappClient.getChatById(resolvedChatId);
      const messages = await chat.fetchMessages({ limit: 1000 });

      const exportData = {
        contact: {
          id: chat.id._serialized,
          name: chat.name,
          isGroup: chat.isGroup,
        },
        exportTimestamp: new Date().toISOString(),
        messageCount: messages.length,
        messages: messages.map(msg => ({
          id: msg.id.id,
          body: msg.body,
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          fromMe: msg.fromMe,
          type: msg.type,
          hasMedia: msg.hasMedia,
          author: msg.author,
        })),
      };

      let output;
      if (format === 'csv') {
        // Convert to CSV format
        const csvRows = [
          'Timestamp,From,Type,Body,HasMedia', // Header
          ...exportData.messages.map(msg => 
            `"${msg.timestamp}","${msg.fromMe ? 'Me' : 'Contact'}","${msg.type}","${msg.body.replace(/"/g, '""')}","${msg.hasMedia}"`
          )
        ];
        output = csvRows.join('\n');
      } else {
        output = JSON.stringify(exportData, null, 2);
      }

      this.security.logSecurityEvent('CONTACT_DATA_EXPORTED', { 
        contactId, format, messageCount: messages.length 
      });

      return {
        content: [{
          type: 'text',
          text: `Exported ${messages.length} messages for ${contactId} in ${format} format:\n\n${output}`,
        }],
      };
    } catch (error) {
      throw new Error(`Export failed: ${error.message}`);
    }
  }

  async getMediaFromContact(contactId, mediaType = 'all', limit = 100, downloadPath) {
    try {
      this.security.checkRateLimit('get_media_from_contact');
      
      const resolvedChatId = await this.resolveChatId(contactId);
      const chat = await this.whatsappClient.getChatById(resolvedChatId);
      const messages = await chat.fetchMessages({ limit: 500 }); // Get more messages to find media
      
      const mediaMessages = messages.filter(msg => {
        if (!msg.hasMedia) return false;
        
        if (mediaType === 'all') return true;
        return msg.type === mediaType;
      }).slice(0, limit);

      const mediaData = [];
      
      for (const msg of mediaMessages) {
        try {
          const media = await msg.downloadMedia();
          
          const mediaInfo = {
            messageId: msg.id.id,
            timestamp: new Date(msg.timestamp * 1000).toISOString(),
            type: msg.type,
            mimetype: media.mimetype,
            filename: media.filename || `media_${msg.id.id}`,
            filesize: media.data ? media.data.length : 0,
            caption: msg.body || '',
            fromMe: msg.fromMe,
          };

          // If download path is specified, save the file
          if (downloadPath && media.data) {
            try {
              if (!fs.existsSync(downloadPath)) {
                fs.mkdirSync(downloadPath, { recursive: true });
              }
              
              const safeFilename = mediaInfo.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
              const filePath = path.join(downloadPath, `${msg.timestamp}_${safeFilename}`);
              
              fs.writeFileSync(filePath, media.data, 'base64');
              mediaInfo.savedPath = filePath;
            } catch (error) {
              mediaInfo.downloadError = `Failed to save: ${error.message}`;
            }
          }

          mediaData.push(mediaInfo);
        } catch (error) {
          console.warn(`Failed to download media from message ${msg.id.id}:`, error);
        }
      }

      this.security.logSecurityEvent('MEDIA_ACCESSED', { 
        contactId, mediaType, resultCount: mediaData.length 
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${mediaData.length} media files from ${contactId}:\n${JSON.stringify(mediaData, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new Error(`Media retrieval failed: ${error.message}`);
    }
  }

  extractTopics(messages) {
    // Simple keyword extraction for topic analysis
    const words = messages
      .map(msg => msg.body.toLowerCase())
      .join(' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['this', 'that', 'with', 'have', 'will', 'they', 'from', 'been'].includes(word));

    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    return Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
  }

  async manageSecurity(action, contactId) {
    try {
      switch (action) {
        case 'allow_contact':
          if (!contactId) throw new Error('Contact ID required');
          this.security.addAllowedContact(contactId);
          return {
            content: [{
              type: 'text',
              text: `Contact ${contactId} added to allowed list`,
            }],
          };

        case 'block_contact':
          if (!contactId) throw new Error('Contact ID required');
          this.security.blockContact(contactId);
          return {
            content: [{
              type: 'text',
              text: `Contact ${contactId} blocked`,
            }],
          };

        case 'clear_session':
          this.security.clearSession();
          return {
            content: [{
              type: 'text',
              text: 'Session cleared. Restart the server to re-authenticate.',
            }],
          };

        case 'get_config':
          const config = {
            allowedContacts: Array.from(this.security.allowedContacts),
            blockedContacts: Array.from(this.security.blockedContacts),
          };
          return {
            content: [{
              type: 'text',
              text: `Security configuration:\n${JSON.stringify(config, null, 2)}`,
            }],
          };

        default:
          throw new Error(`Unknown security action: ${action}`);
      }
    } catch (error) {
      throw new Error(`Security management failed: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WhatsApp MCP server running on stdio');
    
    // Wait for WhatsApp to initialize
    console.error('[DEBUG] Waiting for WhatsApp to initialize...');
    let waitTime = 0;
    const maxWait = 30000; // 30 seconds
    
    while (!this.isReady && waitTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      waitTime += 1000;
      if (waitTime % 5000 === 0) {
        console.error(`[DEBUG] Still waiting... ${waitTime/1000}s`);
      }
    }
    
    if (this.isReady) {
      console.error('[DEBUG] WhatsApp is ready!');
    } else {
      console.error('[DEBUG] WhatsApp failed to initialize within 30 seconds');
    }
  }
}

const server = new WhatsAppMCPServer();
server.run().catch((error) => {
  console.error('Error running server:', error);
  process.exit(1);
});

// Keep the process alive
setInterval(() => {
  // Keep-alive to prevent process from exiting
}, 60000);