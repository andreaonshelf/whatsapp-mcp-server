# Security Features & Best Practices

## Implemented Security Features

### ✅ Authentication & Session Management
- **Local Authentication Only**: Uses WhatsApp Web's LocalAuth strategy
- **Secure Session Storage**: Sessions stored locally in `.wwebjs_auth/` with restricted permissions
- **Session Key Generation**: Cryptographically secure session keys with 600 permissions
- **Session Clearing**: Ability to clear authentication data on demand

### ✅ Access Control
- **Contact Allowlist**: Restrict communication to approved contacts only
- **Contact Blocklist**: Block specific contacts from receiving messages
- **Dynamic Management**: Add/remove contacts from allow/block lists via MCP tools

### ✅ Rate Limiting
- **Message Rate Limits**: Max 20 messages per minute per contact
- **API Rate Limits**: Max 5 API calls per minute for data retrieval
- **Global Rate Limiting**: Prevents abuse across all operations

### ✅ Input Validation & Sanitization
- **Message Sanitization**: Removes potential XSS and script injection
- **File Path Validation**: Restricts file access to `uploads/` directory only
- **File Size Limits**: Maximum 50MB per media file
- **Message Length Limits**: Maximum 4096 characters per message

### ✅ Audit Logging
- **Security Event Logging**: All security events logged to `security.log`
- **Timestamped Entries**: Each log entry includes timestamp and session ID
- **Action Tracking**: Tracks message sending, contact access, and security changes

### ✅ Secure Transport
- **Stdio Communication**: MCP communication only through stdin/stdout
- **No Network Exposure**: No open ports or network interfaces
- **Local Processing**: All operations happen locally

## Security Configuration

### Contact Management
```javascript
// Allow specific contacts only
manage_security({ action: 'allow_contact', contactId: '+1234567890' })

// Block unwanted contacts
manage_security({ action: 'block_contact', contactId: 'spam@c.us' })

// View current security config
manage_security({ action: 'get_config' })
```

### Session Management
```javascript
// Clear all authentication data (requires restart)
manage_security({ action: 'clear_session' })
```

## Best Practices

### 1. File Security
- **Restricted Directory**: Only place files in `uploads/` directory
- **File Validation**: Files are validated before sending
- **Size Limits**: Keep media files under 50MB
- **Clean Up**: Regularly clean uploaded files

### 2. Contact Management
- **Use Allowlists**: Enable contact allowlists for maximum security
- **Regular Review**: Periodically review allowed/blocked contacts
- **Block Unknown**: Block any suspicious or unknown contacts

### 3. Monitoring
- **Check Logs**: Regularly review `security.log` for unusual activity
- **Rate Limit Alerts**: Monitor for rate limit violations
- **Authentication Events**: Watch for unexpected authentication attempts

### 4. Environment Security
- **File Permissions**: Ensure `.session_key` has 600 permissions
- **Directory Access**: Restrict access to the entire MCP server directory
- **Regular Updates**: Keep dependencies updated

## Security Configurations

### Recommended Allowlist Setup
1. Start with empty allowlist (allows all contacts)
2. Add trusted contacts one by one
3. Test each contact before production use
4. Regular security config backups

### File Upload Security
1. Only upload files to `uploads/` directory
2. Scan files for malware before uploading
3. Use descriptive, safe filenames
4. Regular cleanup of old files

## Threat Model

### Mitigated Threats
- ✅ Unauthorized message sending
- ✅ File system traversal attacks
- ✅ Rate limiting/DoS attacks
- ✅ XSS/Script injection in messages
- ✅ Unauthorized contact access
- ✅ Session hijacking (local only)

### Remaining Considerations
- ⚠️ Physical access to the machine
- ⚠️ WhatsApp account compromise
- ⚠️ Dependency vulnerabilities
- ⚠️ Local privilege escalation

## Emergency Procedures

### Suspected Compromise
1. Run `manage_security({ action: 'clear_session' })`
2. Check `security.log` for unusual activity
3. Review and update contact allowlists
4. Restart the MCP server
5. Re-authenticate with fresh QR code

### Regular Maintenance
- Weekly: Review security logs
- Monthly: Update dependencies
- Quarterly: Review contact permissions
- As needed: Clear old uploaded files

## Configuration Files

- `.session_key` - Encrypted session identifier (600 permissions)
- `security_config.json` - Contact allow/block lists (600 permissions)
- `security.log` - Audit trail of all security events
- `.wwebjs_auth/` - WhatsApp Web authentication data