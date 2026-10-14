const http = require('http');

const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';

function ping() {
  http
    .get(url, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        console.log(`[wait-for-vite] Vite dev server ready at ${url}`);
        process.exit(0);
      }
      setTimeout(ping, 300);
    })
    .on('error', () => {
      setTimeout(ping, 300);
    });
}

console.log(`[wait-for-vite] Waiting for ${url}...`);
ping();
