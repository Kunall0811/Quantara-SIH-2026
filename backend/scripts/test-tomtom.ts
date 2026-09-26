import { tomtomIncidents } from '../src/providers/tomtom';

async function test() {
  const bbox = { south: 28.4, west: 77.0, north: 28.7, east: 77.3 };
  console.log('Fetching incidents...');
  const res = await tomtomIncidents(bbox);
  console.log('Result:', res);
}

test();
