import crypto from 'crypto';
import fs from 'fs';

export class EncryptionManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyDerivationIterations = 100000;
    this.encryptionKey = this.deriveEncryptionKey();
  }

  deriveEncryptionKey() {
    const keyPath = './.master_key';
    let masterKey;

    if (fs.existsSync(keyPath)) {
      masterKey = fs.readFileSync(keyPath);
    } else {
      masterKey = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, masterKey, { mode: 0o600 });
    }

    // Derive encryption key using PBKDF2
    const salt = crypto.createHash('sha256').update('whatsapp-mcp-salt').digest();
    return crypto.pbkdf2Sync(masterKey, salt, this.keyDerivationIterations, 32, 'sha256');
  }

  encrypt(data) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
      cipher.setAAD(Buffer.from('whatsapp-mcp'));

      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  decrypt(encryptedData) {
    try {
      const { encrypted, iv, authTag } = encryptedData;
      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
      
      decipher.setAAD(Buffer.from('whatsapp-mcp'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  encryptFile(filePath) {
    try {
      const data = fs.readFileSync(filePath);
      const encrypted = this.encrypt(data.toString('base64'));
      
      const encryptedPath = `${filePath}.encrypted`;
      fs.writeFileSync(encryptedPath, JSON.stringify(encrypted), { mode: 0o600 });
      
      // Securely delete original file
      this.secureDelete(filePath);
      
      return encryptedPath;
    } catch (error) {
      throw new Error(`File encryption failed: ${error.message}`);
    }
  }

  decryptFile(encryptedPath, outputPath) {
    try {
      const encryptedData = JSON.parse(fs.readFileSync(encryptedPath, 'utf8'));
      const decrypted = this.decrypt(encryptedData);
      
      fs.writeFileSync(outputPath, Buffer.from(decrypted, 'base64'), { mode: 0o600 });
      
      return outputPath;
    } catch (error) {
      throw new Error(`File decryption failed: ${error.message}`);
    }
  }

  secureDelete(filePath) {
    try {
      if (!fs.existsSync(filePath)) return;

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // Overwrite file with random data multiple times
      const passes = 3;
      for (let i = 0; i < passes; i++) {
        const randomData = crypto.randomBytes(fileSize);
        fs.writeFileSync(filePath, randomData);
        fs.fsyncSync(fs.openSync(filePath, 'r+'));
      }

      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`Secure delete failed for ${filePath}:`, error);
    }
  }

  generateHMAC(data, secret = this.encryptionKey) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  verifyHMAC(data, signature, secret = this.encryptionKey) {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}

export class SecureCommunication {
  constructor() {
    this.encryption = new EncryptionManager();
    this.setupSecureChannels();
  }

  setupSecureChannels() {
    // Override stdio transport to add encryption layer
    const originalWrite = process.stdout.write;
    const originalRead = process.stdin.read;

    process.stdout.write = (chunk, encoding, callback) => {
      try {
        if (typeof chunk === 'string' && chunk.trim().startsWith('{')) {
          // Encrypt MCP responses
          const encrypted = this.encryption.encrypt(JSON.parse(chunk));
          const secureChunk = JSON.stringify({
            encrypted: true,
            data: encrypted,
            timestamp: Date.now()
          });
          return originalWrite.call(process.stdout, secureChunk, encoding, callback);
        }
      } catch (error) {
        // Fallback to original if encryption fails
        console.error('Encryption failed, using plaintext:', error);
      }
      
      return originalWrite.call(process.stdout, chunk, encoding, callback);
    };
  }

  createSecureMessage(message) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    
    const payload = {
      message,
      timestamp,
      nonce
    };

    const encrypted = this.encryption.encrypt(payload);
    const signature = this.encryption.generateHMAC(JSON.stringify(encrypted));

    return {
      ...encrypted,
      signature,
      version: '1.0'
    };
  }

  verifySecureMessage(secureMessage) {
    try {
      const { signature, version, ...encryptedData } = secureMessage;
      
      if (version !== '1.0') {
        throw new Error('Unsupported message version');
      }

      // Verify HMAC signature
      if (!this.encryption.verifyHMAC(JSON.stringify(encryptedData), signature)) {
        throw new Error('Message signature verification failed');
      }

      const payload = this.encryption.decrypt(encryptedData);
      
      // Check message age (prevent replay attacks)
      const messageAge = Date.now() - payload.timestamp;
      if (messageAge > 300000) { // 5 minutes
        throw new Error('Message too old, possible replay attack');
      }

      return payload.message;
    } catch (error) {
      throw new Error(`Message verification failed: ${error.message}`);
    }
  }
}