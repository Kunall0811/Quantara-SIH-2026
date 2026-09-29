# 🚦 Quantara

### Quantum-Inspired Intelligent Traffic Route Optimization in Transportation Systems Using Metaheuristic Optimization

**SIH 2026 | Problem Statement 26137 | Transportation & Logistics**

#### Live App: https://quantara-sih-2026-production-b6d5.up.railway.app

---

## 📌 Overview

**Quantara** is a quantum-inspired intelligent route optimization platform for **multi-vehicle transportation and logistics**.

It uses **Quantum Particle Swarm Optimization (QPSO)** with a traffic-aware transportation graph to optimize vehicle routes while considering:

* 🚚 Multiple vehicles and customer locations
* 📦 Customer demands and vehicle capacities
* ⏱️ Time windows and route duration
* 🛣️ Travel distance and travel time
* 🚦 Traffic congestion and changing traffic conditions
* 🚧 Road closures and incidents
* 🔄 Dynamic route re-optimization

> ⚛️ **Quantum-inspired does not mean quantum hardware.** QPSO runs entirely on conventional computing hardware using quantum-behaved particle-swarm mathematics.

---

## 🎯 Problem

Large-scale **Vehicle Routing Problems (VRP)** become highly complex when multiple vehicles need to serve many customers while satisfying capacity, demand, time-window, and route constraints. At the same time, real-world transportation conditions are constantly changing and static routes can become inefficient when traffic conditions, road availability, vehicle status, or operational constraints change.

* 🚚 **Multiple vehicles & customers** create a huge number of possible route combinations.
* 🚦 **Dynamic traffic & congestion** can make planned routes inefficient.
* 🚧 **Accidents and road closures** can suddenly disrupt existing routes.
* 📦 **Operational constraints** such as capacity, demand, and time windows must be satisfied.
* ⚖️ **Travel time, distance, and congestion** need to be optimized together.

**Core Challenge:** Efficiently generate feasible, near-optimal routes for multiple vehicles while continuously adapting to changing traffic and road conditions.

Quantara combines **VRP optimization, weighted road networks, traffic-aware routing, and quantum-inspired metaheuristic optimization** to address these challenges.

---

## 💡 Solution Workflow

```text
Input Data
    ↓
Transportation Graph
    ↓
VRP Formulation
    ↓
QPSO Optimization
    ↓
Route Validation
    ↓
Multi-Vehicle Routes
    ↓
Performance Evaluation
    ↓
Benchmarking
    ↓
Dynamic Re-optimization
    ↓
Optimized Route Output
```

---

## ⚛️ Core Optimization

### Quantum Particle Swarm Optimization — QPSO

QPSO is the primary optimization algorithm used to explore large route-search spaces and generate near-optimal routing solutions.

The platform also supports comparative evaluation using:

* ⚛️ QPSO
* ⚛️ Adaptive QPSO
* 🔵 PSO
* 🧬 Genetic Algorithm (GA)
* 🔥 Simulated Annealing (SA)
* 🎯 Exact exhaustive solver for small instances

All optimization methods use the same objective function and constraint framework for comparative evaluation.

---

## 🚚 Vehicle Routing

Quantara supports multi-vehicle routing with:

* 🏢 Depot
* 📍 Multiple delivery locations
* 🚛 Multiple vehicles
* 📦 Customer demands
* ⚖️ Vehicle capacity constraints
* ⏰ Time-window constraints
* 🔄 Route continuity
* 🏁 Depot start and return
* 🚧 Road availability constraints

---

## 🚦 Traffic-Aware Digital Twin

The transportation network is represented as a **weighted road graph**. A stateful digital twin maintains changing transportation conditions used during planning and re-optimization.

The system can model:

* 🚦 Traffic surges
* 🚧 Road closures
* 🚨 Accidents/incidents
* 🚛 Vehicle breakdowns
* 🌧️ Weather changes
* 🕐 Rush-hour conditions

When conditions change, the system can update the transportation state and **re-optimize affected routes**.

Traffic can use external TomTom data when configured, with internal simulation/fallback available for demonstrations.

---

## 📊 Optimization & Evaluation Metrics

| Metric              | Purpose                           |
| ------------------- | --------------------------------- |
| ⏱️ Travel Time      | Evaluate total journey duration   |
| 📏 Distance         | Evaluate total route distance     |
| 🚦 Congestion       | Evaluate congestion-related cost  |
| 📦 Feasibility      | Verify operational constraints    |
| ⚡ Runtime          | Measure computational performance |
| 📈 Solution Quality | Compare optimization results      |
| 🔄 Convergence      | Analyze optimization progress     |
| 📊 Scalability      | Evaluate increasing problem sizes |

---

## 🧪 Benchmarking & Validation

Quantara provides systematic testing across multiple optimization and routing scenarios.

### 🔬 Validation Areas

* ✅ QPSO validation
* ✅ Multi-vehicle VRP testing
* ✅ Capacity constraint testing
* ✅ Time-window testing
* ✅ Dynamic traffic testing
* ✅ Road-closure testing
* ✅ Convergence analysis
* ✅ Runtime analysis
* ✅ Solution-quality comparison
* ✅ Exact-method comparison for small instances
* ✅ Scalability testing

### 📈 Scalability

```text
10 → 25 → 50 → 100 → 250 → 500 → 1000
```

Problem sizes are evaluated based on actual execution where supported; cases beyond configured runtime limits are reported rather than silently estimated.

---

## 🗺️ Platform Features

* 🗺️ Interactive route visualization
* 🚚 Multi-vehicle route display
* 📍 Customer and depot management
* 🚦 Traffic-aware optimization
* 🔄 Dynamic re-routing
* 📊 Performance metrics
* 📈 Convergence visualization
* 🧪 Algorithm benchmarking
* 🧠 Scenario and what-if analysis
* 🔐 Authentication
* 📜 Optimization history
* ⚙️ Configurable optimization parameters
* 🤖 FRIDAY tool-calling assistant
* 🎬 SIH Demo Mode

---

## 🛠️ Tech Stack

### Frontend

* React
* TypeScript
* Vite
* Map-based visualization

### Backend

* Node.js
* Express
* TypeScript
* REST APIs

### Optimization & Routing

* QPSO
* Adaptive QPSO
* PSO
* Genetic Algorithm
* Simulated Annealing
* Dijkstra / A*
* Exact solver for small instances

### Data & External Services

* MongoDB
* Socket.IO
* TomTom Traffic API
* OSRM
* Open-Meteo
* Groq
* Gemini

---

## 📂 Project Structure

```text
qroute-node/
│
├── backend/
│   ├── src/
│   │   ├── algorithms/
│   │   ├── services/
│   │   ├── routes/
│   │   ├── data/
│   │   └── ...
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
│
├── documentation/
│
├── README.md
└── .gitignore
```

---

## 🚀 Quick Start

### 1️⃣ Clone the Repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd qroute-node
```

### 2️⃣ Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend runs on:

```text
http://localhost:5000
```

### 3️⃣ Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

---

## 🔐 Environment Variables

Create `backend/.env` using `backend/.env.example`:

```env
JWT_SECRET=
MONGODB_URI=
TOMTOM_API_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
```

External services are optional where supported. Without MongoDB, the application can use an in-memory store for demonstrations.
Without a TomTom API key, traffic and route data can fall back to the internal simulation.

---

## 👤 Demo Accounts

The application provides seeded demonstration accounts:

```text
Admin:
admin@qroute.in
admin123

Citizen:
citizen@qroute.in
citizen123
```

> ⚠️ These credentials are for local/demo use only.

---

## 🎬 SIH Demo Mode

Quantara includes a dedicated **SIH Demo Mode** that executes the platform workflow through real backend functionality.

```text
Open /sih-demo
      ↓
Start Demo
      ↓
Backend Processing
      ↓
Digital Twin
      ↓
Optimization
      ↓
Scenario Analysis
      ↓
Benchmarking
      ↓
Results
```

---

## 🧪 Testing

### Backend

```bash
cd backend
npm test
```

### Frontend

```bash
cd frontend
npx tsc -b
npx vite build
```

---

## 📚 Documentation

Additional documentation covers:

* `docs/ARCHITECTURE.md` — system architecture
* `docs/QPSO.md` — QPSO methodology
* `docs/DIGITAL_TWIN.md` — digital-twin state and re-optimization flow
* `docs/BENCHMARKING.md` — benchmarking and scalability methodology
* `docs/FRIDAY.md` — FRIDAY assistant and tool registry

---

## 🏆 Smart India Hackathon 2026

**Problem Statement:** 26137

**Title:** Quantum-Inspired Intelligent Traffic Route Optimization in Transportation Systems Using Metaheuristic Optimization

**Organization:** Egreen Quanta

**Team:** TEAM HUSTLERS

**Project:** Quantara

**Category:** Software

**Theme:** Transportation & Logistics

---

## 📄 License

This project is licensed under the **MIT License**.

---

