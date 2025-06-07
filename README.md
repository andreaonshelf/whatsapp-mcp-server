# WhatsApp MCP Server

A Model Context Protocol (MCP) server that enables AI models like Claude to interact with WhatsApp through the whatsapp-web.js library.

## Features

- ✅ Send text messages to contacts or groups
- ✅ Send media files (images, videos, documents, audio)
- ✅ Retrieve contact list
- ✅ Get chat list
- ✅ Fetch messages from specific chats
- ✅ Check connection status
- ✅ QR code authentication

## Installation

1. Clone or download this project
2. Install dependencies:
```bash
npm install
```

## Usage

### Running the Server

```bash
npm start
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

## Configuration with Claude Desktop

Add this server to your Claude Desktop configuration file:

### macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
### Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

## Phone Number Formats

The server accepts phone numbers in various formats:
- International format: "+1234567890"
- Without plus: "1234567890"
- With spaces or dashes: "+1 234-567-890"

The server automatically converts phone numbers to the correct WhatsApp format.

## Security Notes

- This server stores authentication data locally using whatsapp-web.js's LocalAuth
- Authentication session is saved in `.wwebjs_auth` folder
- The server only connects to your personal WhatsApp account
- All communication happens locally - no data is sent to external servers

## Troubleshooting

### QR Code Not Displaying
- Make sure your terminal supports Unicode characters
- Try running in a different terminal application

### Authentication Issues
- Delete the `.wwebjs_auth` folder and restart the server
- Make sure WhatsApp Web is not open in your browser

### Connection Problems
- Check your internet connection
- Restart the server if it gets stuck

## Development

To run in development mode with auto-restart:
```bash
npm run dev
```

## Dependencies

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk): MCP SDK for building servers
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js): WhatsApp Web API client
- [qrcode-terminal](https://github.com/gtanner/qrcode-terminal): Display QR codes in terminal