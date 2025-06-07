#!/usr/bin/env node

import { DependencySecurity, SecurityHardening } from './hardening.js';
import fs from 'fs';
import path from 'path';

class SecurityChecker {
  constructor() {
    this.issues = [];
    this.warnings = [];
    this.passed = [];
  }

  async runAllChecks() {
    console.log('🔍 Running comprehensive security checks...\n');

    await this.checkDependencies();
    this.checkFilePermissions();
    this.checkEnvironmentSecurity();
    this.checkConfigurationSecurity();
    this.checkNetworkSecurity();
    
    this.printResults();
    
    // Exit with error code if critical issues found
    if (this.issues.length > 0) {
      process.exit(1);
    }
  }

  async checkDependencies() {
    console.log('📦 Checking dependencies...');
    
    try {
      const result = await DependencySecurity.scanDependencies();
      
      if (result.vulnerabilities > 0) {
        this.issues.push(`Found ${result.vulnerabilities} high/critical vulnerabilities`);
        console.log(`❌ ${result.vulnerabilities} high/critical vulnerabilities found`);
      } else {
        this.passed.push('No high/critical vulnerabilities found');
        console.log('✅ No high/critical vulnerabilities found');
      }

      const integrityCheck = DependencySecurity.validatePackageIntegrity();
      if (integrityCheck) {
        this.passed.push('Package integrity validated');
        console.log('✅ Package integrity validated');
      } else {
        this.warnings.push('Package integrity check failed');
        console.log('⚠️  Package integrity check failed');
      }
    } catch (error) {
      this.warnings.push(`Dependency check failed: ${error.message}`);
      console.log(`⚠️  Dependency check failed: ${error.message}`);
    }
  }

  checkFilePermissions() {
    console.log('\n🔒 Checking file permissions...');
    
    const criticalFiles = [
      { path: '.session_key', expected: 0o600 },
      { path: 'security_config.json', expected: 0o600 },
      { path: '.master_key', expected: 0o600 },
      { path: 'uploads', expected: 0o700, isDirectory: true },
    ];

    for (const file of criticalFiles) {
      if (fs.existsSync(file.path)) {
        const stats = fs.statSync(file.path);
        const actualPerm = stats.mode & parseInt('777', 8);
        
        if (actualPerm <= file.expected) {
          this.passed.push(`${file.path} has secure permissions (${actualPerm.toString(8)})`);
          console.log(`✅ ${file.path} permissions: ${actualPerm.toString(8)}`);
        } else {
          this.issues.push(`${file.path} has insecure permissions: ${actualPerm.toString(8)}, expected: ${file.expected.toString(8)}`);
          console.log(`❌ ${file.path} permissions: ${actualPerm.toString(8)} (too permissive)`);
        }
      } else if (file.path === 'uploads') {
        this.warnings.push(`${file.path} directory missing`);
        console.log(`⚠️  ${file.path} directory missing`);
      }
    }
  }

  checkEnvironmentSecurity() {
    console.log('\n🌐 Checking environment security...');
    
    // Check for sensitive environment variables
    const sensitiveVars = [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY',
      'DATABASE_PASSWORD', 'JWT_SECRET'
    ];
    
    let foundSensitive = false;
    for (const varName of sensitiveVars) {
      if (process.env[varName]) {
        this.warnings.push(`Sensitive environment variable found: ${varName}`);
        foundSensitive = true;
      }
    }
    
    if (!foundSensitive) {
      this.passed.push('No sensitive environment variables exposed');
      console.log('✅ No sensitive environment variables found');
    } else {
      console.log('⚠️  Sensitive environment variables detected');
    }

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    
    if (majorVersion >= 18) {
      this.passed.push(`Node.js version ${nodeVersion} is supported`);
      console.log(`✅ Node.js version: ${nodeVersion}`);
    } else {
      this.issues.push(`Node.js version ${nodeVersion} is outdated and potentially insecure`);
      console.log(`❌ Node.js version ${nodeVersion} is outdated`);
    }
  }

  checkConfigurationSecurity() {
    console.log('\n⚙️  Checking configuration security...');
    
    // Check if running as root (dangerous)
    if (process.getuid && process.getuid() === 0) {
      this.issues.push('Running as root user (dangerous)');
      console.log('❌ Running as root user');
    } else {
      this.passed.push('Not running as root user');
      console.log('✅ Not running as root user');
    }

    // Check if security config exists
    if (fs.existsSync('security_config.json')) {
      try {
        const config = JSON.parse(fs.readFileSync('security_config.json', 'utf8'));
        
        if (config.allowedContacts && config.allowedContacts.length > 0) {
          this.passed.push(`Contact allowlist configured (${config.allowedContacts.length} contacts)`);
          console.log(`✅ Contact allowlist: ${config.allowedContacts.length} contacts`);
        } else {
          this.warnings.push('No contact allowlist configured');
          console.log('⚠️  No contact allowlist configured');
        }
        
        if (config.blockedContacts && config.blockedContacts.length > 0) {
          this.passed.push(`Contact blocklist configured (${config.blockedContacts.length} contacts)`);
          console.log(`✅ Contact blocklist: ${config.blockedContacts.length} contacts`);
        }
      } catch (error) {
        this.warnings.push('Invalid security configuration file');
        console.log('⚠️  Invalid security configuration file');
      }
    } else {
      this.warnings.push('No security configuration file found');
      console.log('⚠️  No security configuration file found');
    }
  }

  checkNetworkSecurity() {
    console.log('\n🌍 Checking network security...');
    
    // Check for open network listeners
    try {
      const netstat = require('child_process').execSync('netstat -an 2>/dev/null || ss -an 2>/dev/null || true', { encoding: 'utf8' });
      const listeners = netstat.split('\n').filter(line => 
        line.includes('LISTEN') && line.includes('127.0.0.1')
      );
      
      if (listeners.length === 0) {
        this.passed.push('No network listeners detected');
        console.log('✅ No network listeners detected');
      } else {
        this.warnings.push(`${listeners.length} network listeners detected`);
        console.log(`⚠️  ${listeners.length} network listeners detected`);
      }
    } catch (error) {
      this.warnings.push('Could not check network listeners');
      console.log('⚠️  Could not check network listeners');
    }

    // Check if process is isolated
    if (process.platform === 'linux') {
      try {
        const namespaces = fs.readFileSync(`/proc/${process.pid}/cgroup`, 'utf8');
        if (namespaces.includes('docker') || namespaces.includes('lxc')) {
          this.passed.push('Process appears to be containerized');
          console.log('✅ Process appears to be containerized');
        } else {
          this.warnings.push('Process not containerized');
          console.log('⚠️  Process not containerized');
        }
      } catch (error) {
        this.warnings.push('Could not check process isolation');
      }
    }
  }

  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SECURITY CHECK RESULTS');
    console.log('='.repeat(60));
    
    console.log(`\n✅ PASSED (${this.passed.length}):`);
    this.passed.forEach(item => console.log(`   • ${item}`));
    
    if (this.warnings.length > 0) {
      console.log(`\n⚠️  WARNINGS (${this.warnings.length}):`);
      this.warnings.forEach(item => console.log(`   • ${item}`));
    }
    
    if (this.issues.length > 0) {
      console.log(`\n❌ CRITICAL ISSUES (${this.issues.length}):`);
      this.issues.forEach(item => console.log(`   • ${item}`));
      console.log('\n🚨 Please fix critical issues before running in production!');
    } else {
      console.log('\n🎉 All critical security checks passed!');
    }
    
    console.log('\n💡 Recommendations:');
    console.log('   • Run `npm run security-scan` regularly');
    console.log('   • Use `npm run hardened-start` for production');
    console.log('   • Enable contact allowlists for maximum security');
    console.log('   • Monitor security.log for suspicious activity');
    console.log('   • Keep dependencies updated with `npm run security-fix`');
  }
}

// Run checks if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new SecurityChecker();
  checker.runAllChecks().catch(error => {
    console.error('Security check failed:', error);
    process.exit(1);
  });
}