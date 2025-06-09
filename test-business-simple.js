import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

console.log('Starting WhatsApp Business test...');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'business-test',
        dataPath: './.test-business-auth'
    }),
    puppeteer: {
        headless: false, // Show browser window
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received - scan with WhatsApp Business:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Business is ready!');
});

client.on('error', (error) => {
    console.error('Error:', error);
});

console.log('Initializing...');
client.initialize().catch(console.error);