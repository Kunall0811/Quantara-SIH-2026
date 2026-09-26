fetch('http://localhost:5000/api/optimization/benchmark', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    origin: { lat: 19.1197, lon: 72.8468 },
    destination: { lat: 19.0596, lon: 72.8295 },
    waypoints: [{ lat: 19.0176, lon: 72.8431 }, { lat: 19.1176, lon: 72.9060 }, { lat: 19.0176, lon: 72.8161 }],
    algorithms: ['EXACT', 'QPSO', 'PSO', 'GA', 'SA'],
    maxIterations: 100, populationSize: 30, useWeather: false, runs: 1, vehicleCount: 3,
    weights: { distance: 10, travelTime: 20, traffic: 10, fuelCost: 5, risk: 5, weather: 2, turns: 1 }
  })
}).then(res => res.json()).then(console.log).catch(console.error);
