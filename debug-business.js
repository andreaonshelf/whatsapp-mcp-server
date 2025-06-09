#!/usr/bin/env node
process.env.WHATSAPP_INSTANCE = 'business';
process.argv.push('--business');

// Modify to run with visible browser
const originalCode = require('./src/index.js');

// Override headless setting
const { Client } = require('whatsapp-web.js');
const originalClient = Client;

Client.prototype.initialize = async function() {
  this.options.puppeteer.headless = false; // Make browser visible
  return originalClient.prototype.initialize.call(this);
};

console.log('Running WhatsApp Business with visible browser for debugging...');