/**
 * EvoLab — Evolutionary Creature Sandbox
 * All game logic in one file: physics, creatures, evolution, rendering, UI.
 */

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  popSize: 30,
  evalTime: 10,        // seconds per generation
  creatureSegments: 3,  // body parts
  genomeSize: null,     // computed from segments
  groundY: 0.7,        // fraction of canvas height
  startX: 80,
  finishX: 3000,       // world units — long track
  gravity: { x: 0, y: 1.2 },
  speedMultiplier: 1,
  paused: false,
};

// Genome: for each joint between segments, we store [phase, freq, amplitude]
// Plus segment sizes. Total = segments*1 (size) + (segments-1)*3 (joint params)
CONFIG.genomeSize = CONFIG.creatureSegments + (CONFIG.creatureSegments - 1) * 3;

// ============================================================
// STATE
// ============================================================
const STATE = {
  generation: 0,
  population: [],       // array of { genome, fitness, bodies, creature }
  bestAllTime: null,     // { fitness, genome, replay }
  bestGenFitness: 0,
  fitnessHistory: [],    // [{gen, best, avg}]
  simTime: 0,
  phase: 'evaluating',  // 'evaluating' | 'evolving'
  camera: { x: 0, y: 0, zoom: 1 },
  ghostReplay: null,
  bestReplayData: [],
};

// ============================================================
// PIPELINE (default)
// ============================================================
let pipeline = [
  { type: 'evaluate', removable: false },
  { type: 'elitism', config: { count: 2 } },
  { type: 'select', config: { method: 'tournament', tournamentSize: 3 } },
  { type: 'crossover', config: { rate: 0.7, method: 'uniform' } },
  { type: 'mutate', config: { rate: 0.15, strength: 0.3 } },
];

// ============================================================
// MATTER.JS SETUP
// ============================================================
const { Engine, World, Bodies, Body, Composite, Constraint, Events, Vector } = Matter;

let engine, world;
let groundBodies = [];
let creatures = [];

function initPhysics() {
  engine = Engine.create({
    gravity: CONFIG.gravity,
    enableSleeping: false,
  });
  world = engine.world;
  buildGround();
}

function buildGround() {
  // Clear old
  groundBodies.forEach(b => Composite.remove(world, b));
  groundBodies = [];

  const segments = generateTerrain();
  segments.forEach(seg => {
    const cx = (seg.x1 + seg.x2) / 2;
    const cy = (seg.y1 + seg.y2) / 2;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const body = Bodies.rectangle(cx, cy, len, 8, {
      isStatic: true,
      angle: angle,
      friction: 0.8,
      restitution: 0.2,
      render: { fillStyle: '#2a2a3e' },
      collisionFilter: { category: 0x0001 },
    });
    body._groundSeg = true;
    groundBodies.push(body);
    Composite.add(world, body);
  });
}

function generateTerrain() {
  const segs = [];
  const canvasH = canvas.height;
  const baseY = canvasH * CONFIG.groundY;
  let x = -200;
  const endX = CONFIG.finishX + 400;

  while (x < endX) {
    const segLen = 80 + Math.random() * 120;
    const nextX = x + segLen;
    const y1 = baseY + Math.sin(x * 0.003) * 30 + Math.sin(x * 0.001) * 50;
    const y2 = baseY + Math.sin(nextX * 0.003) * 30 + Math.sin(nextX * 0.001) * 50;
    segs.push({ x1: x, y1, x2: nextX, y2 });
    x = nextX;
  }
  return segs;
}

// ============================================================
// GENOME / CREATURE
// ============================================================
function randomGenome() {
  const g = [];
  for (let i = 0; i < CONFIG.genomeSize; i++) {
    g.push(Math.random() * 2 - 1); // [-1, 1]
  }
  return g;
}

function decodeGenome(genome) {
  const nSeg = CONFIG.creatureSegments;
  const sizes = [];
  const joints = [];

  for (let i = 0; i < nSeg; i++) {
    sizes.push(8 + Math.abs(genome[i]) * 12); // radius 8-20
  }

  for (let i = 0; i < nSeg - 1; i++) {
    const base = nSeg + i * 3;
    joints.push({
      phase: genome[base] * Math.PI,
      freq: 1 + Math.abs(genome[base + 1]) * 6,     // 1-7 Hz
      amplitude: Math.abs(genome[base + 2]) * 0.012,  // force multiplier
    });
  }

  return { sizes, joints };
}

function spawnCreature(genome, index) {
  const decoded = decodeGenome(genome);
  const startX = CONFIG.startX;
  const canvasH = canvas.height;
  const startY = canvasH * CONFIG.groundY - 80;

  const bodies = [];
  const constraints = [];

  for (let i = 0; i < decoded.sizes.length; i++) {
    const r = decoded.sizes[i];
    const x = startX + i * 28;
    const y = startY;
    const body = Bodies.circle(x, y, r, {
      friction: 0.6,
      restitution: 0.3,
      density: 0.002,
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001, // only collide with ground, not other creatures
      },
    });
    body._creatureIdx = index;
    bodies.push(body);
    Composite.add(world, body);
  }

  for (let i = 0; i < bodies.length - 1; i++) {
    const c = Constraint.create({
      bodyA: bodies[i],
      bodyB: bodies[i + 1],
      stiffness: 0.6,
      damping: 0.1,
      length: 24,
    });
    constraints.push(c);
    Composite.add(world, c);
  }

  return {
    genome,
    decoded,
    bodies,
    constraints,
    fitness: 0,
    finished: false,
    maxX: startX,
    replayPositions: [],
  };
}

function removeCreature(creature) {
  creature.bodies.forEach(b => Composite.remove(world, b));
  creature.constraints.forEach(c => Composite.remove(world, c));
}

function applyOscillation(creature, time) {
  const { decoded, bodies } = creature;
  for (let i = 0; i < decoded.joints.length; i++) {
    const j = decoded.joints[i];
    const force = Math.sin(time * j.freq * Math.PI * 2 + j.phase) * j.amplitude;

    const bodyA = bodies[i];
    const bodyB = bodies[i + 1];

    const dx = bodyB.position.x - bodyA.position.x;
    const dy = bodyB.position.y - bodyA.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    // Perpendicular force (creates walking motion)
    const px = -ny * force;
    const py = nx * force;

    Body.applyForce(bodyA, bodyA.position, { x: -px, y: -py });
    Body.applyForce(bodyB, bodyB.position, { x: px, y: py });

    // Also some along-axis pulsing
    const axialForce = force * 0.5;
    Body.applyForce(bodyA, bodyA.position, { x: -nx * axialForce, y: -ny * axialForce });
    Body.applyForce(bodyB, bodyB.position, { x: nx * axialForce, y: ny * axialForce });
  }
}

function evaluateFitness(creature) {
  let maxX = 0;
  creature.bodies.forEach(b => {
    if (b.position.x > maxX) maxX = b.position.x;
  });
  creature.maxX = Math.max(creature.maxX, maxX);
  creature.fitness = Math.max(0, creature.maxX - CONFIG.startX);
  return creature.fitness;
}

// ============================================================
// EVOLUTION OPERATORS
// ============================================================
function selectTournament(pop, size) {
  let best = null;
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * pop.length);
    if (!best || pop[idx].fitness > best.fitness) {
      best = pop[idx];
    }
  }
  return best;
}

function selectRoulette(pop) {
  const totalFitness = pop.reduce((s, c) => s + c.fitness + 1, 0);
  let r = Math.random() * totalFitness;
  for (const c of pop) {
    r -= (c.fitness + 1);
    if (r <= 0) return c;
  }
  return pop[pop.length - 1];
}

function crossoverUniform(g1, g2) {
  return g1.map((v, i) => Math.random() < 0.5 ? v : g2[i]);
}

function crossoverSinglePoint(g1, g2) {
  const point = Math.floor(Math.random() * g1.length);
  return g1.map((v, i) => i < point ? v : g2[i]);
}

function mutate(genome, rate, strength) {
  return genome.map(v => {
    if (Math.random() < rate) {
      return Math.max(-1, Math.min(1, v + (Math.random() * 2 - 1) * strength));
    }
    return v;
  });
}

function runPipeline(population) {
  const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
  const popSize = parseInt(document.getElementById('pop-size').value) || CONFIG.popSize;
  let newGenomes = [];

  // Walk through pipeline steps
  for (const step of pipeline) {
    switch (step.type) {
      case 'evaluate':
        // Already done
        break;

      case 'elitism': {
        const count = Math.min(step.config.count, sorted.length);
        for (let i = 0; i < count; i++) {
          newGenomes.push([...sorted[i].genome]);
        }
        break;
      }

      case 'select':
        // Selection is used by crossover/mutate implicitly — we store method
        break;

      case 'crossover': {
        const selectMethod = pipeline.find(s => s.type === 'select')?.config?.method || 'tournament';
        const tournSize = pipeline.find(s => s.type === 'select')?.config?.tournamentSize || 3;
        const needed = popSize - newGenomes.length;
        for (let i = 0; i < needed; i++) {
          const p1 = selectMethod === 'tournament'
            ? selectTournament(sorted, tournSize)
            : selectRoulette(sorted);
          const p2 = selectMethod === 'tournament'
            ? selectTournament(sorted, tournSize)
            : selectRoulette(sorted);

          let child;
          if (Math.random() < step.config.rate) {
            child = step.config.method === 'uniform'
              ? crossoverUniform(p1.genome, p2.genome)
              : crossoverSinglePoint(p1.genome, p2.genome);
          } else {
            child = [...p1.genome];
          }
          newGenomes.push(child);
        }
        break;
      }

      case 'mutate': {
        // Mutate all except elites
        const eliteCount = pipeline.find(s => s.type === 'elitism')?.config?.count || 0;
        newGenomes = newGenomes.map((g, i) => {
          if (i < eliteCount) return g;
          return mutate(g, step.config.rate, step.config.strength);
        });
        break;
      }
    }
  }

  // If pipeline didn't produce crossover, just fill remaining with mutated copies
  while (newGenomes.length < popSize) {
    const parent = selectTournament(sorted, 3);
    newGenomes.push(mutate([...parent.genome], 0.2, 0.3));
  }

  return newGenomes.slice(0, popSize);
}

// ============================================================
// CANVAS / RENDERING
// ============================================================
const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
}

window.addEventListener('resize', () => {
  resizeCanvas();
  if (groundBodies.length > 0) {
    // Rebuild ground on resize
    buildGround();
  }
});

function worldToScreen(wx, wy) {
  const cw = canvas.width / devicePixelRatio;
  const ch = canvas.height / devicePixelRatio;
  const sx = (wx - STATE.camera.x) * STATE.camera.zoom + cw * 0.15;
  const sy = (wy - STATE.camera.y) * STATE.camera.zoom + ch * 0.5;
  return { x: sx, y: sy };
}

function drawScene() {
  const cw = canvas.width / devicePixelRatio;
  const ch = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, cw, ch);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#0a0a14');
  grad.addColorStop(1, '#0d0d1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  // Grid lines (subtle)
  ctx.strokeStyle = '#15152020';
  ctx.lineWidth = 1;
  const gridSize = 100 * STATE.camera.zoom;
  const offsetX = (-STATE.camera.x * STATE.camera.zoom + cw * 0.15) % gridSize;
  const offsetY = (-STATE.camera.y * STATE.camera.zoom + ch * 0.5) % gridSize;
  for (let x = offsetX; x < cw; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = offsetY; y < ch; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }

  // Start line
  const startScreen = worldToScreen(CONFIG.startX, 0);
  ctx.strokeStyle = '#00e4a040';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(startScreen.x, 0);
  ctx.lineTo(startScreen.x, ch);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#00e4a060';
  ctx.font = '10px "IBM Plex Mono"';
  ctx.fillText('START', startScreen.x + 4, 20);

  // Finish line
  const finishScreen = worldToScreen(CONFIG.finishX, 0);
  ctx.strokeStyle = '#ff6b4a40';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(finishScreen.x, 0);
  ctx.lineTo(finishScreen.x, ch);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#ff6b4a60';
  ctx.fillText('FINISH', finishScreen.x + 4, 20);

  // Ground
  groundBodies.forEach(body => {
    const verts = body.vertices;
    const screenVerts = verts.map(v => worldToScreen(v.x, v.y));
    ctx.fillStyle = '#1e1e2e';
    ctx.strokeStyle = '#2e3a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenVerts[0].x, screenVerts[0].y);
    for (let i = 1; i < screenVerts.length; i++) {
      ctx.lineTo(screenVerts[i].x, screenVerts[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // Ghost replay (best all time)
  if (STATE.ghostReplay && STATE.ghostReplay.length > 0) {
    const frameIdx = Math.min(
      Math.floor((STATE.simTime / CONFIG.evalTime) * STATE.ghostReplay.length),
      STATE.ghostReplay.length - 1
    );
    const frame = STATE.ghostReplay[frameIdx];
    if (frame) {
      ctx.globalAlpha = 0.15;
      frame.forEach(pos => {
        const sp = worldToScreen(pos.x, pos.y);
        ctx.fillStyle = '#ff6b4a';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pos.r * STATE.camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
  }

  // Creatures
  creatures.forEach((creature, ci) => {
    const hue = (ci / creatures.length) * 60 + 140; // green-blue range
    creature.bodies.forEach((body, bi) => {
      const sp = worldToScreen(body.position.x, body.position.y);
      const r = creature.decoded.sizes[bi] * STATE.camera.zoom;

      ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.7)`;
      ctx.strokeStyle = `hsla(${hue}, 70%, 65%, 0.9)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Draw constraints
    creature.constraints.forEach(c => {
      const a = worldToScreen(c.bodyA.position.x, c.bodyA.position.y);
      const b = worldToScreen(c.bodyB.position.x, c.bodyB.position.y);
      ctx.strokeStyle = `hsla(${hue}, 50%, 50%, 0.4)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
  });
}

// ============================================================
// FITNESS GRAPH
// ============================================================
const graphCanvas = document.getElementById('fitness-graph');
const gctx = graphCanvas.getContext('2d');

function drawGraph() {
  const rect = graphCanvas.parentElement.getBoundingClientRect();
  graphCanvas.width = (rect.width - 8) * devicePixelRatio;
  graphCanvas.height = (rect.height - 16) * devicePixelRatio;
  gctx.scale(devicePixelRatio, devicePixelRatio);

  const w = graphCanvas.width / devicePixelRatio;
  const h = graphCanvas.height / devicePixelRatio;

  gctx.clearRect(0, 0, w, h);

  const data = STATE.fitnessHistory;
  if (data.length < 2) return;

  const maxFit = Math.max(...data.map(d => d.best), 1);
  const xStep = w / (data.length - 1);

  // Best line
  gctx.strokeStyle = '#ff6b4a';
  gctx.lineWidth = 1.5;
  gctx.beginPath();
  data.forEach((d, i) => {
    const x = i * xStep;
    const y = h - (d.best / maxFit) * (h - 4);
    i === 0 ? gctx.moveTo(x, y) : gctx.lineTo(x, y);
  });
  gctx.stroke();

  // Avg line
  gctx.strokeStyle = '#5b8aff80';
  gctx.lineWidth = 1;
  gctx.beginPath();
  data.forEach((d, i) => {
    const x = i * xStep;
    const y = h - (d.avg / maxFit) * (h - 4);
    i === 0 ? gctx.moveTo(x, y) : gctx.lineTo(x, y);
  });
  gctx.stroke();

  // Labels
  gctx.fillStyle = '#ff6b4a80';
  gctx.font = '8px "IBM Plex Mono"';
  gctx.fillText(`best: ${maxFit.toFixed(0)}`, 4, 10);
  gctx.fillStyle = '#5b8aff60';
  gctx.fillText(`avg`, 4, 20);
}

// ============================================================
// SIMULATION LOOP
// ============================================================
function spawnPopulation(genomes) {
  // Clear old creatures
  creatures.forEach(c => removeCreature(c));
  creatures = [];

  genomes.forEach((g, i) => {
    creatures.push(spawnCreature(g, i));
  });
}

function startGeneration(genomes) {
  STATE.simTime = 0;
  STATE.phase = 'evaluating';
  STATE.bestGenFitness = 0;
  spawnPopulation(genomes);
}

function endGeneration() {
  // Compute fitnesses
  creatures.forEach(c => evaluateFitness(c));

  const sorted = [...creatures].sort((a, b) => b.fitness - a.fitness);
  const bestFit = sorted[0]?.fitness || 0;
  const avgFit = creatures.reduce((s, c) => s + c.fitness, 0) / creatures.length;

  STATE.bestGenFitness = bestFit;
  STATE.fitnessHistory.push({ gen: STATE.generation, best: bestFit, avg: avgFit });

  // Track all-time best and its replay
  if (!STATE.bestAllTime || bestFit > STATE.bestAllTime.fitness) {
    STATE.bestAllTime = {
      fitness: bestFit,
      genome: [...sorted[0].genome],
    };
    // Save replay from creature
    STATE.ghostReplay = sorted[0].replayPositions;
  }

  // Run pipeline
  const newGenomes = runPipeline(creatures);

  STATE.generation++;

  // Start next gen
  startGeneration(newGenomes);
}

let lastTime = 0;

function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  if (CONFIG.paused) {
    drawScene();
    requestAnimationFrame(gameLoop);
    return;
  }

  dt = Math.min(dt, 0.05); // cap
  dt *= CONFIG.speedMultiplier;

  // Step physics (multiple sub-steps for speed)
  const steps = Math.ceil(CONFIG.speedMultiplier);
  const subDt = dt / steps;

  for (let s = 0; s < steps; s++) {
    STATE.simTime += subDt;

    // Apply forces
    creatures.forEach(c => {
      applyOscillation(c, STATE.simTime);

      // Record replay data every few frames
      if (Math.random() < 0.1) {
        c.replayPositions.push(
          c.bodies.map(b => ({
            x: b.position.x,
            y: b.position.y,
            r: c.decoded.sizes[c.bodies.indexOf(b)],
          }))
        );
      }
    });

    Engine.update(engine, subDt * 1000);
  }

  // Evaluate
  creatures.forEach(c => evaluateFitness(c));

  // Camera follows the leading creature
  let leadX = CONFIG.startX;
  creatures.forEach(c => {
    if (c.maxX > leadX) leadX = c.maxX;
  });
  STATE.camera.x += (leadX - 200 - STATE.camera.x) * 0.03;

  // Check generation end
  if (STATE.simTime >= CONFIG.evalTime) {
    endGeneration();
  }

  // HUD
  updateHUD();
  drawScene();
  drawGraph();

  requestAnimationFrame(gameLoop);
}

function updateHUD() {
  document.getElementById('hud-gen').textContent = STATE.generation;
  document.getElementById('hud-pop').textContent = creatures.length;

  const bestGen = Math.max(...creatures.map(c => c.fitness), 0);
  document.getElementById('hud-best-gen').textContent = bestGen.toFixed(0);

  const bestAll = STATE.bestAllTime?.fitness || 0;
  document.getElementById('hud-best-all').textContent = bestAll.toFixed(0);

  const alive = creatures.filter(c => !c.finished).length;
  document.getElementById('hud-alive').textContent = alive;
  document.getElementById('hud-time').textContent = STATE.simTime.toFixed(1) + 's';
}

// ============================================================
// PIPELINE UI
// ============================================================
function renderPipeline() {
  const container = document.getElementById('pipeline-nodes');
  container.innerHTML = '';

  pipeline.forEach((step, idx) => {
    if (idx > 0) {
      const connector = document.createElement('div');
      connector.className = 'pipe-connector';
      connector.textContent = '↓';
      container.appendChild(connector);
    }

    const node = document.createElement('div');
    node.className = 'pipe-node';
    node.draggable = step.type !== 'evaluate';
    node.dataset.index = idx;

    const header = document.createElement('div');
    header.className = 'pipe-node-header';

    const typeLabel = document.createElement('span');
    typeLabel.className = `pipe-node-type ${step.type}`;
    typeLabel.textContent = step.type;
    header.appendChild(typeLabel);

    if (step.removable !== false && step.type !== 'evaluate') {
      const removeBtn = document.createElement('span');
      removeBtn.className = 'pipe-node-remove';
      removeBtn.textContent = '×';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        pipeline.splice(idx, 1);
        renderPipeline();
      };
      header.appendChild(removeBtn);
    }

    node.appendChild(header);

    // Config controls
    const configDiv = document.createElement('div');
    configDiv.className = 'pipe-node-config';

    switch (step.type) {
      case 'evaluate':
        // No config
        break;

      case 'elitism':
        configDiv.appendChild(makeNumberInput('Count', step.config, 'count', 0, 20, 1));
        break;

      case 'select':
        configDiv.appendChild(makeSelectInput('Method', step.config, 'method', ['tournament', 'roulette']));
        if (step.config.method === 'tournament') {
          configDiv.appendChild(makeNumberInput('Tourn. Size', step.config, 'tournamentSize', 2, 10, 1));
        }
        break;

      case 'crossover':
        configDiv.appendChild(makeNumberInput('Rate', step.config, 'rate', 0, 1, 0.05));
        configDiv.appendChild(makeSelectInput('Method', step.config, 'method', ['uniform', 'single-point']));
        break;

      case 'mutate':
        configDiv.appendChild(makeNumberInput('Rate', step.config, 'rate', 0, 1, 0.05));
        configDiv.appendChild(makeNumberInput('Strength', step.config, 'strength', 0, 1, 0.05));
        break;
    }

    node.appendChild(configDiv);

    // Drag events
    if (step.type !== 'evaluate') {
      node.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        node.classList.add('dragging');
      });
      node.addEventListener('dragend', () => {
        node.classList.remove('dragging');
      });
      node.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      node.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx = idx;
        if (fromIdx !== toIdx && fromIdx > 0 && toIdx > 0) {
          const [moved] = pipeline.splice(fromIdx, 1);
          pipeline.splice(toIdx, 0, moved);
          renderPipeline();
        }
      });
    }

    container.appendChild(node);
  });
}

function makeNumberInput(label, configObj, key, min, max, step) {
  const row = document.createElement('div');
  row.className = 'config-row';

  const lbl = document.createElement('span');
  lbl.className = 'config-label';
  lbl.textContent = label;

  const input = document.createElement('input');
  input.className = 'config-input';
  input.type = 'number';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = configObj[key];
  input.addEventListener('change', () => {
    configObj[key] = parseFloat(input.value);
  });

  row.appendChild(lbl);
  row.appendChild(input);
  return row;
}

function makeSelectInput(label, configObj, key, options) {
  const row = document.createElement('div');
  row.className = 'config-row';

  const lbl = document.createElement('span');
  lbl.className = 'config-label';
  lbl.textContent = label;

  const select = document.createElement('select');
  select.className = 'config-select';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === configObj[key]) o.selected = true;
    select.appendChild(o);
  });
  select.addEventListener('change', () => {
    configObj[key] = select.value;
    renderPipeline(); // Re-render in case options change
  });

  row.appendChild(lbl);
  row.appendChild(select);
  return row;
}

// Add node buttons
document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    const defaults = {
      select: { method: 'tournament', tournamentSize: 3 },
      crossover: { rate: 0.7, method: 'uniform' },
      mutate: { rate: 0.15, strength: 0.3 },
      elitism: { count: 2 },
    };
    pipeline.push({ type, config: { ...defaults[type] } });
    renderPipeline();
  });
});

// ============================================================
// CONTROLS
// ============================================================
document.getElementById('btn-pause').addEventListener('click', () => {
  CONFIG.paused = !CONFIG.paused;
  const btn = document.getElementById('btn-pause');
  btn.textContent = CONFIG.paused ? '▶ Resume' : '⏸ Pause';
  btn.classList.toggle('active', CONFIG.paused);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  STATE.generation = 0;
  STATE.bestAllTime = null;
  STATE.fitnessHistory = [];
  STATE.ghostReplay = null;
  STATE.camera = { x: 0, y: 0, zoom: 1 };

  creatures.forEach(c => removeCreature(c));
  creatures = [];

  // Rebuild world
  Composite.clear(world, false, true);
  buildGround();

  const genomes = Array.from({ length: parseInt(document.getElementById('pop-size').value) || CONFIG.popSize }, randomGenome);
  startGeneration(genomes);
});

// Speed buttons
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    CONFIG.speedMultiplier = parseInt(btn.dataset.speed);
  });
});

// Pop size / eval time
document.getElementById('pop-size').addEventListener('change', (e) => {
  CONFIG.popSize = parseInt(e.target.value) || 30;
});
document.getElementById('eval-time').addEventListener('change', (e) => {
  CONFIG.evalTime = parseInt(e.target.value) || 10;
});

// Zoom with scroll wheel
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
  STATE.camera.zoom = Math.max(0.1, Math.min(3, STATE.camera.zoom * zoomDelta));
}, { passive: false });

// ============================================================
// INIT
// ============================================================
function init() {
  resizeCanvas();
  initPhysics();
  renderPipeline();

  const genomes = Array.from({ length: CONFIG.popSize }, randomGenome);
  startGeneration(genomes);

  requestAnimationFrame(gameLoop);
}

init();
