import fs from 'fs';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class SecurityMonitor extends EventEmitter {
  constructor() {
    super();
    this.anomalyThresholds = {
      messageRate: 30, // messages per minute
      failedAuthAttempts: 5,
      unexpectedErrors: 10,
      memoryUsage: 0.8, // 80% of max
    };
    
    this.metrics = {
      messagesPerMinute: 0,
      failedAuthAttempts: 0,
      errors: 0,
      startTime: Date.now(),
      lastActivity: Date.now(),
    };
    
    this.setupMonitoring();
  }

  setupMonitoring() {
    // Monitor message rate
    setInterval(() => {
      this.checkMessageRate();
      this.resetCounters();
    }, 60000); // Every minute

    // Monitor memory usage
    setInterval(() => {
      this.checkMemoryUsage();
    }, 30000); // Every 30 seconds

    // Monitor for suspicious patterns
    setInterval(() => {
      this.detectAnomalies();
    }, 120000); // Every 2 minutes

    // Auto-cleanup old logs
    setInterval(() => {
      this.cleanupLogs();
    }, 86400000); // Daily
  }

  logEvent(event, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      details,
      pid: process.pid,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };

    // Write to security log
    try {
      fs.appendFileSync('./security.log', JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write security log:', error);
    }

    // Update metrics
    this.updateMetrics(event, details);

    // Emit event for real-time monitoring
    this.emit('securityEvent', logEntry);
  }

  updateMetrics(event, details) {
    this.metrics.lastActivity = Date.now();

    switch (event) {
      case 'MESSAGE_SENT':
        this.metrics.messagesPerMinute++;
        break;
      case 'AUTH_FAILURE':
        this.metrics.failedAuthAttempts++;
        break;
      case 'ERROR':
      case 'UNCAUGHT_EXCEPTION':
        this.metrics.errors++;
        break;
    }
  }

  checkMessageRate() {
    if (this.metrics.messagesPerMinute > this.anomalyThresholds.messageRate) {
      this.triggerAlert('HIGH_MESSAGE_RATE', {
        rate: this.metrics.messagesPerMinute,
        threshold: this.anomalyThresholds.messageRate
      });
    }
  }

  checkMemoryUsage() {
    const usage = process.memoryUsage();
    const usagePercent = usage.heapUsed / usage.heapTotal;
    
    if (usagePercent > this.anomalyThresholds.memoryUsage) {
      this.triggerAlert('HIGH_MEMORY_USAGE', {
        usage: usage,
        percentage: usagePercent
      });
    }
  }

  detectAnomalies() {
    // Check for failed auth attempts
    if (this.metrics.failedAuthAttempts > this.anomalyThresholds.failedAuthAttempts) {
      this.triggerAlert('MULTIPLE_AUTH_FAILURES', {
        attempts: this.metrics.failedAuthAttempts
      });
    }

    // Check for high error rate
    if (this.metrics.errors > this.anomalyThresholds.unexpectedErrors) {
      this.triggerAlert('HIGH_ERROR_RATE', {
        errors: this.metrics.errors
      });
    }

    // Check for no activity (potential hanging)
    const timeSinceActivity = Date.now() - this.metrics.lastActivity;
    if (timeSinceActivity > 1800000) { // 30 minutes
      this.triggerAlert('NO_ACTIVITY_DETECTED', {
        timeSinceActivity: timeSinceActivity
      });
    }
  }

  triggerAlert(alertType, details) {
    const alert = {
      timestamp: new Date().toISOString(),
      type: alertType,
      details,
      severity: this.getAlertSeverity(alertType),
    };

    // Log alert
    this.logEvent('SECURITY_ALERT', alert);

    // Emit alert for immediate action
    this.emit('securityAlert', alert);

    console.error(`🚨 SECURITY ALERT: ${alertType}`, details);

    // Take automatic action for critical alerts
    if (alert.severity === 'critical') {
      this.handleCriticalAlert(alertType, details);
    }
  }

  getAlertSeverity(alertType) {
    const criticalAlerts = [
      'MULTIPLE_AUTH_FAILURES',
      'UNAUTHORIZED_ACCESS_ATTEMPT',
      'MEMORY_EXHAUSTION'
    ];

    const highAlerts = [
      'HIGH_MESSAGE_RATE',
      'HIGH_MEMORY_USAGE',
      'HIGH_ERROR_RATE'
    ];

    if (criticalAlerts.includes(alertType)) return 'critical';
    if (highAlerts.includes(alertType)) return 'high';
    return 'medium';
  }

  handleCriticalAlert(alertType, details) {
    switch (alertType) {
      case 'MULTIPLE_AUTH_FAILURES':
        // Temporarily disable new connections
        this.emit('disableConnections');
        break;
      
      case 'MEMORY_EXHAUSTION':
        // Force garbage collection
        if (global.gc) global.gc();
        break;
      
      case 'UNAUTHORIZED_ACCESS_ATTEMPT':
        // Clear session and require re-auth
        this.emit('clearSession');
        break;
    }
  }

  resetCounters() {
    this.metrics.messagesPerMinute = 0;
    this.metrics.failedAuthAttempts = 0;
    this.metrics.errors = 0;
  }

  cleanupLogs() {
    try {
      const logPath = './security.log';
      if (!fs.existsSync(logPath)) return;

      const stats = fs.statSync(logPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      // Rotate log if it's over 10MB
      if (fileSizeMB > 10) {
        const timestamp = new Date().toISOString().split('T')[0];
        const archivePath = `./security.log.${timestamp}`;
        
        fs.renameSync(logPath, archivePath);
        this.logEvent('LOG_ROTATED', { archivePath, sizeMB: fileSizeMB });
      }

      // Clean up old archive files (keep last 30 days)
      const files = fs.readdirSync('./')
        .filter(file => file.startsWith('security.log.'))
        .map(file => ({
          name: file,
          time: fs.statSync(file).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // Remove files older than 30 days
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      files.forEach(file => {
        if (file.time < thirtyDaysAgo) {
          fs.unlinkSync(file.name);
          this.logEvent('LOG_ARCHIVED_DELETED', { filename: file.name });
        }
      });
    } catch (error) {
      console.error('Log cleanup failed:', error);
    }
  }

  getSecurityReport() {
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    
    return {
      status: 'active',
      uptime: `${uptimeHours} hours`,
      metrics: { ...this.metrics },
      thresholds: { ...this.anomalyThresholds },
      alerts: this.getRecentAlerts(),
      timestamp: new Date().toISOString(),
    };
  }

  getRecentAlerts() {
    try {
      const logPath = './security.log';
      if (!fs.existsSync(logPath)) return [];

      const logs = fs.readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .slice(-100) // Last 100 entries
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(log => log && log.event === 'SECURITY_ALERT')
        .slice(-10); // Last 10 alerts

      return logs;
    } catch (error) {
      console.error('Failed to read security alerts:', error);
      return [];
    }
  }

  updateThresholds(newThresholds) {
    this.anomalyThresholds = { ...this.anomalyThresholds, ...newThresholds };
    this.logEvent('THRESHOLDS_UPDATED', newThresholds);
  }
}

export class IntrusionDetection {
  constructor(monitor) {
    this.monitor = monitor;
    this.patterns = new Map();
    this.setupDetection();
  }

  setupDetection() {
    // Monitor for suspicious file access patterns
    this.monitorFileAccess();
    
    // Monitor for unusual network activity
    this.monitorNetworkPatterns();
    
    // Monitor for code injection attempts
    this.monitorCodeInjection();
  }

  monitorFileAccess() {
    const originalReadFile = fs.readFile;
    const originalWriteFile = fs.writeFile;
    
    fs.readFile = (...args) => {
      const path = args[0];
      if (this.isSuspiciousPath(path)) {
        this.monitor.triggerAlert('SUSPICIOUS_FILE_ACCESS', { path, operation: 'read' });
      }
      return originalReadFile.apply(fs, args);
    };

    fs.writeFile = (...args) => {
      const path = args[0];
      if (this.isSuspiciousPath(path)) {
        this.monitor.triggerAlert('SUSPICIOUS_FILE_ACCESS', { path, operation: 'write' });
      }
      return originalWriteFile.apply(fs, args);
    };
  }

  isSuspiciousPath(path) {
    const suspiciousPaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/root/',
      '../',
      '..\\',
      '/proc/',
      '/sys/',
    ];
    
    return suspiciousPaths.some(suspicious => 
      String(path).toLowerCase().includes(suspicious)
    );
  }

  monitorNetworkPatterns() {
    // Track unusual network connection attempts
    const connectionAttempts = new Map();
    
    setInterval(() => {
      connectionAttempts.clear();
    }, 300000); // Reset every 5 minutes
  }

  monitorCodeInjection() {
    // Monitor for potential code injection in messages
    const injectionPatterns = [
      /eval\s*\(/i,
      /function\s*\(/i,
      /javascript:/i,
      /<script/i,
      /require\s*\(/i,
      /process\./i,
    ];

    this.checkForInjection = (input) => {
      for (const pattern of injectionPatterns) {
        if (pattern.test(input)) {
          this.monitor.triggerAlert('CODE_INJECTION_ATTEMPT', { 
            pattern: pattern.source,
            input: input.substring(0, 100) // First 100 chars only
          });
          return true;
        }
      }
      return false;
    };
  }
}