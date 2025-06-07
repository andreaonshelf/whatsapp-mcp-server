import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class SecurityManager {
  constructor() {
    this.sessionKey = this.generateOrLoadSessionKey();
    this.rateLimiter = new Map();
    this.allowedContacts = new Set();
    this.blockedContacts = new Set();
    this.loadSecurityConfig();
  }

  generateOrLoadSessionKey() {
    const keyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.whatsapp_mcp_session_key');
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }
    
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  }

  loadSecurityConfig() {
    const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.whatsapp_mcp_security_config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.allowedContacts = new Set(config.allowedContacts || []);
        this.blockedContacts = new Set(config.blockedContacts || []);
      } catch (error) {
        console.error('Failed to load security config:', error);
      }
    }
  }

  saveSecurityConfig() {
    const config = {
      allowedContacts: Array.from(this.allowedContacts),
      blockedContacts: Array.from(this.blockedContacts),
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync('./security_config.json', JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  validateContact(contactId) {
    if (this.blockedContacts.has(contactId)) {
      throw new Error(`Contact ${contactId} is blocked`);
    }
    
    if (this.allowedContacts.size > 0 && !this.allowedContacts.has(contactId)) {
      throw new Error(`Contact ${contactId} is not in allowed list`);
    }
    
    return true;
  }

  checkRateLimit(action, contactId = 'global') {
    const key = `${action}_${contactId}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = action === 'send_message' ? 20 : 5;

    if (!this.rateLimiter.has(key)) {
      this.rateLimiter.set(key, []);
    }

    const requests = this.rateLimiter.get(key);
    const recentRequests = requests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= maxRequests) {
      throw new Error(`Rate limit exceeded for ${action}. Max ${maxRequests} requests per minute.`);
    }

    recentRequests.push(now);
    this.rateLimiter.set(key, recentRequests);
    
    return true;
  }

  sanitizeMessage(message) {
    if (typeof message !== 'string') {
      throw new Error('Message must be a string');
    }
    
    if (message.length > 4096) {
      throw new Error('Message too long. Maximum 4096 characters.');
    }
    
    // Remove potential malicious content
    const sanitized = message
      .replace(/javascript:/gi, '')
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/on\w+\s*=\s*"[^"]*"/gi, '');
    
    return sanitized;
  }

  validateFilePath(filePath) {
    const resolvedPath = path.resolve(filePath);
    const allowedDir = path.resolve('./uploads');
    
    if (!resolvedPath.startsWith(allowedDir)) {
      throw new Error('File path outside allowed directory');
    }
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('File does not exist');
    }
    
    const stats = fs.statSync(resolvedPath);
    if (stats.size > 50 * 1024 * 1024) { // 50MB limit
      throw new Error('File too large. Maximum 50MB.');
    }
    
    return resolvedPath;
  }

  logSecurityEvent(event, details) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      details,
      sessionId: crypto.createHash('sha256').update(this.sessionKey).digest('hex').substring(0, 8)
    };
    
    const logPath = './security.log';
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  }

  addAllowedContact(contactId) {
    this.allowedContacts.add(contactId);
    this.saveSecurityConfig();
    this.logSecurityEvent('CONTACT_ALLOWED', { contactId });
  }

  blockContact(contactId) {
    this.blockedContacts.add(contactId);
    this.allowedContacts.delete(contactId);
    this.saveSecurityConfig();
    this.logSecurityEvent('CONTACT_BLOCKED', { contactId });
  }

  clearSession() {
    try {
      if (fs.existsSync('./.wwebjs_auth')) {
        fs.rmSync('./.wwebjs_auth', { recursive: true, force: true });
      }
      if (fs.existsSync('./.session_key')) {
        fs.unlinkSync('./.session_key');
      }
      this.logSecurityEvent('SESSION_CLEARED', {});
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }
}