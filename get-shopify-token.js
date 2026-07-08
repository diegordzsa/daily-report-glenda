import http from 'node:http';
import { URL } from 'node:url';

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'read_orders';

if (!CLIENT_ID || !CLIENT_SECRET || !SHOP) {
  console.error('\nMissing env vars. Usage:\n');
  console.error('  SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=xxx SHOPIFY_STORE_DOMAIN=xxx node get-shopify-token.js\n');
  process.exit(1);
}

const authUrl = `https://${SHOP}/admin/oauth/authorize?` + new URLSearchParams({
  client_id: CLIENT_ID,
  scope: SCOPES,
  redirect_uri: REDIRECT_URI,
}).toString();

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Shopify OAuth — Offline Access Token');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('1. Open this link in your browser:\n');
console.log(`   ${authUrl}\n`);
console.log('2. Authorize the app in Shopify');
console.log('3. You will be redirected to localhost — the token will appear here\n');
console.log(`Waiting for callback on http://localhost:${PORT} ...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('Missing code parameter');
    return;
  }

  console.log('Received authorization code, exchanging for access token...\n');

  try {
    const tokenRes = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error(`Token exchange failed: ${tokenRes.status} — ${body}`);
      res.writeHead(500);
      res.end('Token exchange failed. Check the terminal.');
      server.close();
      process.exit(1);
    }

    const data = await tokenRes.json();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  SUCCESS! Offline access token:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`   ${data.access_token}\n`);
    console.log(`Scopes: ${data.scope}\n`);
    console.log('Save this token as SHOPIFY_ACCESS_TOKEN in your GitHub secrets.');
    console.log('You can close this terminal now.\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px">
        <h1>Token obtained!</h1>
        <p>Check your terminal for the access token.</p>
        <p>You can close this tab.</p>
      </body></html>
    `);

    server.close();
  } catch (err) {
    console.error('Error exchanging token:', err.message);
    res.writeHead(500);
    res.end('Error. Check the terminal.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);
