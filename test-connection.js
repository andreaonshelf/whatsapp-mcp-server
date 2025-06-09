#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

console.log(`${colors.cyan}WhatsApp MCP Connection Test${colors.reset}`);
console.log(`${colors.cyan}===========================${colors.reset}\n`);

// Check if IPC directories exist and are writable
function checkIpcDirectories() {
  console.log(`${colors.blue}Checking IPC directories...${colors.reset}`);
  
  const personalIpcDir = '/tmp/whatsapp-mcp-ipc';
  const businessIpcDir = '/tmp/whatsapp-business-mcp-ipc';
  
  // Check personal IPC directory
  if (fs.existsSync(personalIpcDir)) {
    console.log(`${colors.green}✓ Personal IPC directory exists: ${personalIpcDir}${colors.reset}`);
    
    // Check if writable
    try {
      fs.accessSync(personalIpcDir, fs.constants.W_OK);
      console.log(`${colors.green}✓ Personal IPC directory is writable${colors.reset}`);
    } catch (error) {
      console.log(`${colors.red}✗ Personal IPC directory is not writable: ${error.message}${colors.reset}`);
      console.log(`${colors.yellow}Attempting to fix permissions...${colors.reset}`);
      try {
        fs.chmodSync(personalIpcDir, 0o755);
        console.log(`${colors.green}✓ Fixed permissions on personal IPC directory${colors.reset}`);
      } catch (fixError) {
        console.log(`${colors.red}✗ Failed to fix permissions: ${fixError.message}${colors.reset}`);
      }
    }
  } else {
    console.log(`${colors.yellow}! Personal IPC directory does not exist (will be created when needed)${colors.reset}`);
  }
  
  // Check business IPC directory
  if (fs.existsSync(businessIpcDir)) {
    console.log(`${colors.green}✓ Business IPC directory exists: ${businessIpcDir}${colors.reset}`);
    
    // Check if writable
    try {
      fs.accessSync(businessIpcDir, fs.constants.W_OK);
      console.log(`${colors.green}✓ Business IPC directory is writable${colors.reset}`);
    } catch (error) {
      console.log(`${colors.red}✗ Business IPC directory is not writable: ${error.message}${colors.reset}`);
      console.log(`${colors.yellow}Attempting to fix permissions...${colors.reset}`);
      try {
        fs.chmodSync(businessIpcDir, 0o755);
        console.log(`${colors.green}✓ Fixed permissions on business IPC directory${colors.reset}`);
      } catch (fixError) {
        console.log(`${colors.red}✗ Failed to fix permissions: ${fixError.message}${colors.reset}`);
      }
    }
  } else {
    console.log(`${colors.yellow}! Business IPC directory does not exist (will be created when needed)${colors.reset}`);
  }
  
  console.log('');
}

// Check lock files
function checkLockFiles() {
  console.log(`${colors.blue}Checking lock files...${colors.reset}`);
  
  const personalLockFile = '/tmp/whatsapp-mcp.lock';
  const businessLockFile = '/tmp/whatsapp-business-mcp.lock';
  
  // Check personal lock file
  if (fs.existsSync(personalLockFile)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(personalLockFile, 'utf8'));
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime();
      const ageMinutes = Math.round(lockAge / 60000);
      
      // Check if the process is still running
      let processRunning = false;
      try {
        process.kill(lockData.pid, 0); // Check if process exists
        processRunning = true;
      } catch (e) {
        processRunning = false;
      }
      
      if (processRunning) {
        console.log(`${colors.green}✓ Personal WhatsApp instance is running (PID: ${lockData.pid}, age: ${ageMinutes} minutes)${colors.reset}`);
      } else {
        console.log(`${colors.yellow}! Personal WhatsApp lock file exists but process is not running${colors.reset}`);
        console.log(`${colors.yellow}  Lock data: ${JSON.stringify(lockData)}${colors.reset}`);
        console.log(`${colors.yellow}  This stale lock file will be removed when a new instance starts${colors.reset}`);
      }
    } catch (error) {
      console.log(`${colors.red}✗ Error reading personal lock file: ${error.message}${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}! No personal WhatsApp instance is currently running${colors.reset}`);
  }
  
  // Check business lock file
  if (fs.existsSync(businessLockFile)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(businessLockFile, 'utf8'));
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime();
      const ageMinutes = Math.round(lockAge / 60000);
      
      // Check if the process is still running
      let processRunning = false;
      try {
        process.kill(lockData.pid, 0); // Check if process exists
        processRunning = true;
      } catch (e) {
        processRunning = false;
      }
      
      if (processRunning) {
        console.log(`${colors.green}✓ Business WhatsApp instance is running (PID: ${lockData.pid}, age: ${ageMinutes} minutes)${colors.reset}`);
      } else {
        console.log(`${colors.yellow}! Business WhatsApp lock file exists but process is not running${colors.reset}`);
        console.log(`${colors.yellow}  Lock data: ${JSON.stringify(lockData)}${colors.reset}`);
        console.log(`${colors.yellow}  This stale lock file will be removed when a new instance starts${colors.reset}`);
      }
    } catch (error) {
      console.log(`${colors.red}✗ Error reading business lock file: ${error.message}${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}! No business WhatsApp instance is currently running${colors.reset}`);
  }
  
  console.log('');
}

// Check state files
function checkStateFiles() {
  console.log(`${colors.blue}Checking state files...${colors.reset}`);
  
  const personalStateFile = '/tmp/whatsapp-mcp-state.json';
  const businessStateFile = '/tmp/whatsapp-business-mcp-state.json';
  
  // Check personal state file
  if (fs.existsSync(personalStateFile)) {
    try {
      const stateData = JSON.parse(fs.readFileSync(personalStateFile, 'utf8'));
      console.log(`${colors.green}✓ Personal WhatsApp state file exists${colors.reset}`);
      console.log(`${colors.green}  Ready: ${stateData.isReady}, Instance ID: ${stateData.instanceId}${colors.reset}`);
      console.log(`${colors.green}  Last updated: ${stateData.timestamp}${colors.reset}`);
    } catch (error) {
      console.log(`${colors.red}✗ Error reading personal state file: ${error.message}${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}! No personal WhatsApp state file found${colors.reset}`);
  }
  
  // Check business state file
  if (fs.existsSync(businessStateFile)) {
    try {
      const stateData = JSON.parse(fs.readFileSync(businessStateFile, 'utf8'));
      console.log(`${colors.green}✓ Business WhatsApp state file exists${colors.reset}`);
      console.log(`${colors.green}  Ready: ${stateData.isReady}, Instance ID: ${stateData.instanceId}${colors.reset}`);
      console.log(`${colors.green}  Last updated: ${stateData.timestamp}${colors.reset}`);
    } catch (error) {
      console.log(`${colors.red}✗ Error reading business state file: ${error.message}${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}! No business WhatsApp state file found${colors.reset}`);
  }
  
  console.log('');
}

// Check auth directories
function checkAuthDirectories() {
  console.log(`${colors.blue}Checking authentication directories...${colors.reset}`);
  
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const personalAuthDir = path.join(homeDir, '.whatsapp-mcp-auth');
  const businessAuthDir = path.join(homeDir, '.whatsapp-business-mcp-auth');
  
  // Check personal auth directory
  if (fs.existsSync(personalAuthDir)) {
    console.log(`${colors.green}✓ Personal WhatsApp auth directory exists: ${personalAuthDir}${colors.reset}`);
    
    // Check for session files
    const sessionDir = path.join(personalAuthDir, 'session-mcp-client');
    if (fs.existsSync(sessionDir)) {
      console.log(`${colors.green}✓ Personal WhatsApp session exists${colors.reset}`);
    } else {
      console.log(`${colors.yellow}! No personal WhatsApp session found (QR code will be required)${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}! Personal WhatsApp auth directory does not exist (will be created when needed)${colors.reset}`);
  }
  
  // Check business auth directory
  if (fs.existsSync(businessAuthDir)) {
    console.log(`${colors.green}✓ Business WhatsApp auth directory exists: ${businessAuthDir}${colors.reset}`);
    
    // Check for session files
    const sessionDir = path.join(businessAuthDir, 'session-mcp-business-client');
    if (fs.existsSync(sessionDir)) {
      console.log(`${colors.green}✓ Business WhatsApp session exists${colors.reset}`);
    } else {
      console.log(`${colors.yellow}! No business WhatsApp session found (QR code will be required)${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}! Business WhatsApp auth directory does not exist (will be created when needed)${colors.reset}`);
  }
  
  console.log('');
}

// Run a quick test of the personal WhatsApp instance
async function testPersonalWhatsApp() {
  console.log(`${colors.blue}Testing personal WhatsApp connection...${colors.reset}`);
  
  return new Promise((resolve) => {
    // Run the test with a timeout
    const testProcess = spawn('node', ['src/index.js'], {
      stdio: 'pipe',
      env: { ...process.env, TEST_MODE: 'true', TEST_TIMEOUT: '10000' }
    });
    
    let output = '';
    let errorOutput = '';
    
    testProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    testProcess.stderr.on('data', (data) => {
      const line = data.toString();
      errorOutput += line;
      
      // Print important debug messages
      if (line.includes('[DEBUG]')) {
        console.log(`${colors.cyan}${line.trim()}${colors.reset}`);
      }
      
      // Check for QR code
      if (line.includes('QR code received')) {
        console.log(`${colors.yellow}! QR code needed for personal WhatsApp${colors.reset}`);
      }
      
      // Check for ready state
      if (line.includes('WhatsApp client ready event fired') || line.includes('Server is now ready')) {
        console.log(`${colors.green}✓ Personal WhatsApp is ready!${colors.reset}`);
      }
    });
    
    // Set a timeout to kill the process after 10 seconds
    const timeout = setTimeout(() => {
      testProcess.kill();
      console.log(`${colors.yellow}! Test timeout - stopping personal WhatsApp test${colors.reset}`);
      
      if (errorOutput.includes('QR code received')) {
        console.log(`${colors.yellow}! Authentication required - scan QR code to complete setup${colors.reset}`);
      } else if (errorOutput.includes('ready')) {
        console.log(`${colors.green}✓ Personal WhatsApp connection test passed${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ Personal WhatsApp connection test inconclusive${colors.reset}`);
      }
      
      resolve();
    }, 10000);
    
    testProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (code === 0) {
        console.log(`${colors.green}✓ Personal WhatsApp connection test passed${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ Personal WhatsApp connection test failed with code ${code}${colors.reset}`);
      }
      
      resolve();
    });
  });
}

// Run a quick test of the business WhatsApp instance
async function testBusinessWhatsApp() {
  console.log(`${colors.blue}Testing business WhatsApp connection...${colors.reset}`);
  
  return new Promise((resolve) => {
    // Run the test with a timeout
    const testProcess = spawn('node', ['src/index-business.js'], {
      stdio: 'pipe',
      env: { ...process.env, TEST_MODE: 'true', TEST_TIMEOUT: '10000' }
    });
    
    let output = '';
    let errorOutput = '';
    
    testProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    testProcess.stderr.on('data', (data) => {
      const line = data.toString();
      errorOutput += line;
      
      // Print important debug messages
      if (line.includes('[DEBUG]') || line.includes('[BUSINESS]')) {
        console.log(`${colors.magenta}${line.trim()}${colors.reset}`);
      }
      
      // Check for QR code
      if (line.includes('QR code received')) {
        console.log(`${colors.yellow}! QR code needed for business WhatsApp${colors.reset}`);
      }
      
      // Check for ready state
      if (line.includes('WhatsApp client ready event fired') || line.includes('Server is now ready')) {
        console.log(`${colors.green}✓ Business WhatsApp is ready!${colors.reset}`);
      }
    });
    
    // Set a timeout to kill the process after 10 seconds
    const timeout = setTimeout(() => {
      testProcess.kill();
      console.log(`${colors.yellow}! Test timeout - stopping business WhatsApp test${colors.reset}`);
      
      if (errorOutput.includes('QR code received')) {
        console.log(`${colors.yellow}! Authentication required - scan QR code to complete setup${colors.reset}`);
      } else if (errorOutput.includes('ready')) {
        console.log(`${colors.green}✓ Business WhatsApp connection test passed${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ Business WhatsApp connection test inconclusive${colors.reset}`);
      }
      
      resolve();
    }, 10000);
    
    testProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (code === 0) {
        console.log(`${colors.green}✓ Business WhatsApp connection test passed${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ Business WhatsApp connection test failed with code ${code}${colors.reset}`);
      }
      
      resolve();
    });
  });
}

// Print summary and recommendations
function printSummary() {
  console.log(`${colors.blue}Summary and Recommendations${colors.reset}`);
  console.log(`${colors.blue}===========================${colors.reset}\n`);
  
  console.log(`${colors.cyan}1. To start the personal WhatsApp MCP server:${colors.reset}`);
  console.log(`   node src/index.js\n`);
  
  console.log(`${colors.cyan}2. To start the business WhatsApp MCP server:${colors.reset}`);
  console.log(`   node src/index-business.js\n`);
  
  console.log(`${colors.cyan}3. If you encounter connection issues:${colors.reset}`);
  console.log(`   - Ensure you have a stable internet connection`);
  console.log(`   - Check that WhatsApp Web is accessible in your browser`);
  console.log(`   - Clear the session and scan the QR code again`);
  console.log(`   - Check the debug logs in /tmp/whatsapp-mcp-debug.log\n`);
  
  console.log(`${colors.cyan}4. For IPC issues:${colors.reset}`);
  console.log(`   - Ensure the /tmp directory is writable`);
  console.log(`   - Check permissions on the IPC directories`);
  console.log(`   - Remove stale lock files if necessary\n`);
  
  console.log(`${colors.green}Connection test complete!${colors.reset}`);
}

// Run all checks
async function runTests() {
  checkIpcDirectories();
  checkLockFiles();
  checkStateFiles();
  checkAuthDirectories();
  
  await testPersonalWhatsApp();
  console.log('');
  
  await testBusinessWhatsApp();
  console.log('');
  
  printSummary();
}

runTests().catch(console.error);
