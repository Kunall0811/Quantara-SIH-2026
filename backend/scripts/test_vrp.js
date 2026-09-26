const http = require('http');
const data = JSON.stringify({
  depot: { lat: 18.5204, lon: 73.8567 },
  customers: [
    { lat: 18.5304, lon: 73.8478, demand: 1 },
    { lat: 18.5590, lon: 73.7869, demand: 1 },
    { lat: 18.5912, lon: 73.7389, demand: 1 },
    { lat: 18.5074, lon: 73.8077, demand: 1 },
    { lat: 18.5610, lon: 73.8080, demand: 1 }
  ],
  fleet: [
    { id: 'Q-01', capacity: 5 },
    { id: 'Q-02', capacity: 5 }
  ]
});
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/optimization/vrp-run',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};
const req = http.request(options, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('STATUS:', res.statusCode, 'BODY:', body));
});
req.on('error', e => console.error(e));
req.write(data);
req.end();
