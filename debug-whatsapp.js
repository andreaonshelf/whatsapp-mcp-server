import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'debug-test' }),
  puppeteer: { 
    headless: false, 
    devtools: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('ready', async () => {
  console.log('=== Ready event fired ===');
  
  const page = client.pupPage;
  
  // Wait a bit and check what's available
  for (let i = 0; i < 10; i++) {
    console.log(`\n--- Check ${i + 1} ---`);
    
    const debug = await page.evaluate(() => {
      return {
        hasWindow: typeof window !== 'undefined',
        hasStore: typeof window.Store !== 'undefined',
        hasChat: typeof window.Store?.Chat !== 'undefined',
        hasChatGetChats: typeof window.Store?.Chat?.getChats !== 'undefined',
        storeKeys: window.Store ? Object.keys(window.Store).slice(0, 10) : [],
        chatKeys: window.Store?.Chat ? Object.keys(window.Store.Chat).slice(0, 10) : [],
        url: window.location.href
      };
    });
    
    console.log(JSON.stringify(debug, null, 2));
    
    if (debug.hasChatGetChats) {
      console.log('SUCCESS: getChats is available!');
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  process.exit(0);
});

client.on('qr', () => {
  console.log('QR code needed - check browser');
});

client.on('authenticated', () => {
  console.log('Authenticated!');
});

client.initialize();