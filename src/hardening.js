import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export class SecurityHardening {
  constructor() {
    this.initializeHardening();
  }

  initializeHardening() {
    this.setupProcessSecurity();
    this.setupMemoryProtection();
    this.setupSignalHandlers();
    this.validateEnvironment();
  }

  setupProcessSecurity() {
    // Disable Node.js debugging features in production
    if (process.env.NODE_ENV === 'production') {
      delete process.env.NODE_OPTIONS;
      process.removeAllListeners('SIGUSR1'); // Disable debugging
    }

    // Set process title to avoid information disclosure
    process.title = 'mcp-server';

    // Restrict file creation umask
    process.umask(0o077); // Only owner can read/write new files
  }

  setupMemoryProtection() {
    // Force garbage collection periodically to prevent memory leaks
    if (global.gc) {
      setInterval(() => {
        global.gc();
      }, 300000); // Every 5 minutes
    }

    // Monitor memory usage
    setInterval(() => {
      const usage = process.memoryUsage();
      if (usage.heapUsed > 500 * 1024 * 1024) { // 500MB threshold
        console.error('High memory usage detected:', usage);
        this.logSecurityEvent('HIGH_MEMORY_USAGE', usage);
      }
    }, 60000); // Every minute
  }

  setupSignalHandlers() {
    const cleanup = () => {
      this.secureCleanup();
      process.exit(0);
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGQUIT', cleanup);
    
    // Handle uncaught exceptions securely
    process.on('uncaughtException', (error) => {
      this.logSecurityEvent('UNCAUGHT_EXCEPTION', { error: error.message });
      console.error('Uncaught exception:', error);
      this.secureCleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      this.logSecurityEvent('UNHANDLED_REJECTION', { reason: String(reason) });
      console.error('Unhandled rejection:', reason);
    });
  }

  validateEnvironment() {
    const requiredPerms = {
      '.': 0o755,
      'src': 0o755,
      'uploads': 0o700,
    };

    for (const [dir, expectedPerm] of Object.entries(requiredPerms)) {
      if (fs.existsSync(dir)) {
        const stats = fs.statSync(dir);
        const actualPerm = stats.mode & parseInt('777', 8);
        if (actualPerm > expectedPerm) {
          console.warn(`Insecure permissions on ${dir}: ${actualPerm.toString(8)}, expected max ${expectedPerm.toString(8)}`);
        }
      }
    }
  }

  secureCleanup() {
    try {
      // Clear sensitive environment variables
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      // Clear any cached authentication data from memory
      if (global.authCache) {
        global.authCache = null;
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      this.logSecurityEvent('SECURE_CLEANUP', { timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Error during secure cleanup:', error);
    }
  }

  logSecurityEvent(event, details) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      details,
      pid: process.pid,
      ppid: process.ppid,
    };
    
    try {
      fs.appendFileSync('./security.log', JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write security log:', error);
    }
  }
}

export class NetworkHardening {
  constructor() {
    this.setupNetworkRestrictions();
    this.monitorNetworkActivity();
  }

  setupNetworkRestrictions() {
    // Override require to prevent dynamic loading of network modules
    const originalRequire = global.require;
    
    global.require = function(id) {
      const dangerousModules = [
        'http', 'https', 'net', 'dgram', 'tls', 'cluster'
      ];
      
      if (dangerousModules.includes(id)) {
        console.warn(`Blocked attempt to load network module: ${id}`);
        throw new Error(`Module ${id} is not allowed`);
      }
      
      return originalRequire.apply(this, arguments);
    };
  }

  monitorNetworkActivity() {
    // Monitor for unexpected network connections
    const originalConnect = require('net').Socket.prototype.connect;
    
    require('net').Socket.prototype.connect = function(...args) {
      console.warn('Unexpected network connection attempt:', args);
      const logEntry = {
        timestamp: new Date().toISOString(),
        event: 'NETWORK_CONNECTION_ATTEMPT',
        args: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg)
      };
      
      try {
        fs.appendFileSync('./security.log', JSON.stringify(logEntry) + '\n');
      } catch (error) {
        console.error('Failed to log network activity:', error);
      }
      
      return originalConnect.apply(this, args);
    };
  }
}

export class DependencySecurity {
  static async scanDependencies() {
    return new Promise((resolve, reject) => {
      const audit = spawn('npm', ['audit', '--json'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      audit.stdout.on('data', (data) => {
        output += data.toString();
      });

      audit.on('close', (code) => {
        try {
          const result = JSON.parse(output);
          const vulnerabilities = result.vulnerabilities || {};
          const highSeverity = Object.values(vulnerabilities).filter(
            vuln => ['high', 'critical'].includes(vuln.severity)
          );

          if (highSeverity.length > 0) {
            console.error(`Found ${highSeverity.length} high/critical vulnerabilities`);
            const logEntry = {
              timestamp: new Date().toISOString(),
              event: 'SECURITY_VULNERABILITIES',
              count: highSeverity.length,
              vulnerabilities: highSeverity.map(v => ({
                name: v.name,
                severity: v.severity,
                via: v.via
              }))
            };
            
            fs.appendFileSync('./security.log', JSON.stringify(logEntry) + '\n');
          }

          resolve({ vulnerabilities: highSeverity.length, details: highSeverity });
        } catch (error) {
          reject(error);
        }
      });

      audit.on('error', reject);
    });
  }

  static validatePackageIntegrity() {
    try {
      const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
      const lockFile = fs.readFileSync('./package-lock.json', 'utf8');
      
      // Basic integrity check
      const hash = crypto.createHash('sha256').update(lockFile).digest('hex');
      const expectedHash = packageJson.lockfileHash;
      
      if (expectedHash && hash !== expectedHash) {
        throw new Error('Package lock file integrity check failed');
      }
      
      return true;
    } catch (error) {
      console.error('Package integrity validation failed:', error);
      return false;
    }
  }
}