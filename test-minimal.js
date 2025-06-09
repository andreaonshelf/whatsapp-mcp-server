import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

console.log('Starting minimal WhatsApp test...');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'test-minimal'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', (qr) => {
    console.log('QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
    setTimeout(() => {
        console.log('Test successful! Exiting...');
        process.exit(0);
    }, 5000);
});

client.on('auth_failure', msg => {
    console.error('Authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out:', reason);
});

client.initialize().catch(err => {
    console.error('Initialization error:', err);
    process.exit(1);
});