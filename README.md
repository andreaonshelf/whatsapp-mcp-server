# WhatsApp MCP Server

A Model Context Protocol (MCP) server that enables AI models like Claude to interact with WhatsApp through the whatsapp-web.js library. Supports both personal WhatsApp and WhatsApp Business accounts.

## Features

- ✅ Send text messages to contacts or groups
- ✅ Send media files (images, videos, documents, audio)
- ✅ Retrieve contact list
- ✅ Get chat list
- ✅ Fetch messages from specific chats
- ✅ Search messages by content, contact, or date
- ✅ Get media files from contacts
- ✅ Get contact activity summaries
- ✅ Export contact data in JSON or CSV format
- ✅ Support for both personal WhatsApp and WhatsApp Business
- ✅ Improved connection reliability with automatic reconnection
- ✅ QR code authentication

## Installation

1. Clone or download this project
2. Install dependencies:
```bash
npm install
```

## Usage

### Running the Server

For personal WhatsApp:
```bash
node src/index.js
```

For WhatsApp Business:
```bash
node src/index-business.js
```

You can also run the connection test to check your setup:
```bash
node test-connection.js
```

### First Time Setup

1. When you first run the server, it will display a QR code in the terminal
2. Open WhatsApp on your phone
3. Go to Settings > Linked Devices > Link a Device
4. Scan the QR code displayed in the terminal
5. Once authenticated, the server will be ready to use

### Available Tools

#### send_message
Send a text message to a WhatsApp contact or group.

**Parameters:**
- `to` (string): Phone number with country code (e.g., "1234567890") or chat ID
- `message` (string): The text message to send

#### send_media
Send media files to a WhatsApp contact or group.

**Parameters:**
- `to` (string): Phone number with country code or chat ID
- `filePath` (string): Path to the media file
- `caption` (string, optional): Caption for the media

#### get_contacts
Retrieve your WhatsApp contacts list.

#### get_chats
Get list of your WhatsApp chats.

**Parameters:**
- `limit` (number, optional): Maximum number of chats to return (default: 20)

#### get_messages
Get recent messages from a specific chat.

**Parameters:**
- `chatId` (string): Chat ID to get messages from
- `limit` (number, optional): Number of messages to retrieve (default: 10)

#### get_status
Check the WhatsApp client connection status.

#### search_messages
Search WhatsApp messages by contact, keyword, or date range.

**Parameters:**
- `query` (string, optional): Search term to look for in message content
- `contactId` (string, optional): Filter by specific contact ID or phone number
- `dateFrom` (string, optional): Start date (YYYY-MM-DD)
- `dateTo` (string, optional): End date (YYYY-MM-DD)
- `mediaType` (string, optional): Filter by media type (image, video, audio, document, any)
- `limit` (number, optional): Maximum number of results (default: 50)

#### get_media_from_contact
Get all media files (images, videos, documents) from a specific contact.

**Parameters:**
- `contactId` (string): Contact ID or phone number
- `mediaType` (string, optional): Type of media to retrieve (image, video, audio, document, all)
- `limit` (number, optional): Maximum number of media files (default: 100)
- `downloadPath` (string, optional): Directory to download media files to

#### get_contact_activity
Get recent activity summary for a specific contact (for CRM enrichment).

**Parameters:**
- `contactId` (string): Contact ID or phone number
- `days` (number, optional): Number of days to look back (default: 30)

#### get_todays_media
Get today's media files (images/videos) from a specific contact or group.

**Parameters:**
- `contactId` (string): Contact ID or phone number
- `mediaType` (string, optional): Type of media to retrieve (image, video, all)

#### export_contact_data
Export all messages and data for a contact in CRM-friendly format.

**Parameters:**
- `contactId` (string): Contact ID or phone number
- `format` (string, optional): Export format (json, csv)

#### manage_security
Manage security settings (allow/block contacts, clear session).

**Parameters:**
- `action` (string): Security action to perform (allow_contact, block_contact, clear_session, get_config)
- `contactId` (string, optional): Contact ID (required for allow_contact and block_contact)

## Configuration with Claude Desktop

Add this server to your Claude Desktop configuration file:

### macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
### Windows: `%APPDATA%\Claude\claude_desktop_config.json`

For personal WhatsApp:
```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/path/to/whatsapp-mcp-server/src/index.js"]
    }
  }
}
```

For WhatsApp Business:
```json
{
  "mcpServers": {
    "whatsapp-business": {
      "command": "node",
      "args": ["/path/to/whatsapp-mcp-server/src/index-business.js"]
    }
  }
}
```

You can add both servers to use personal and business accounts simultaneously.

## Phone Number Formats

The server accepts phone numbers in various formats:
- International format: "+1234567890"
- Without plus: "1234567890"
- With spaces or dashes: "+1 234-567-890"

The server automatically converts phone numbers to the correct WhatsApp format.

## Security Notes

- This server stores authentication data locally using whatsapp-web.js's LocalAuth
- Authentication sessions are saved in:
  - Personal WhatsApp: `~/.whatsapp-mcp-auth` folder
  - Business WhatsApp: `~/.whatsapp-business-mcp-auth` folder
- All communication happens locally - no data is sent to external servers
- Rate limiting is implemented to prevent abuse
- Contact validation can be configured to restrict access to specific contacts

## Troubleshooting

### QR Code Not Displaying
- Make sure your terminal supports Unicode characters
- Try running in a different terminal application

### Authentication Issues
- Run the connection test script: `node test-connection.js`
- Delete the auth directories and restart the server:
  - Personal WhatsApp: `~/.whatsapp-mcp-auth`
  - Business WhatsApp: `~/.whatsapp-business-mcp-auth`
- Make sure WhatsApp Web is not open in your browser

### Connection Problems
- Check your internet connection
- Verify that the WhatsApp Web version is up-to-date
- Check for stale lock files in `/tmp/whatsapp-mcp.lock` and `/tmp/whatsapp-business-mcp.lock`
- Ensure IPC directories have proper permissions
- Check debug logs in `/tmp/whatsapp-mcp-debug.log` and `/tmp/whatsapp-mcp-ipc-debug.log`

## Development

To run in development mode with auto-restart:
```bash
npm run dev
```

## Recent Fixes

- Updated WhatsApp Web version cache to the latest version
- Improved IPC communication between instances
- Enhanced error handling and logging
- Fixed authentication and session management
- Added support for WhatsApp Business
- Improved lock file handling
- Enhanced ready state management

## Dependencies

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk): MCP SDK for building servers
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js): WhatsApp Web API client
- [qrcode-terminal](https://github.com/gtanner/qrcode-terminal): Display QR codes in terminal
