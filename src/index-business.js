#!/usr/bin/env node

// This is a copy of index.js configured for WhatsApp Business
// It uses a different auth directory and instance name

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

// Use different paths for business instance
const BUSINESS_AUTH_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.whatsapp-business-mcp-auth');
const BUSINESS_LOCK_FILE = '/tmp/whatsapp-business-mcp.lock';
const BUSINESS_STATE_FILE = '/tmp/whatsapp-business-mcp-state.json';

// Set environment variables to indicate this is a business instance
process.env.WHATSAPP_INSTANCE = 'business';
if (!process.argv.includes('--business')) {
  process.argv.push('--business');
}

// Import the main index.js file to reuse all the code
// This ensures both personal and business versions stay in sync
import './index.js';

console.error('[BUSINESS] WhatsApp Business MCP Server - Starting...');
