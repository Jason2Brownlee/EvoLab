/**
 * EvoLab — Evolutionary Creature Sandbox
 * All game logic in one file: physics, creatures, evolution, rendering, UI.
 */

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  popSize: 30,
  evalTime: 15,
  bodyType: 'roller',
  genomeSize: null,     // computed per body type
  groundY: 400,
  startX: 80,
  finishX: 3000,
  gravity: { x: 0, y: 1.2 },
  speedMultiplier: 1,
  paused: false,
  displayMode: 'all',
};

// ============================================================
// BODY TYPE DEFINITIONS
// ============================================================
const BODY_TYPES = {
  roller: {
    name: 'Roller',
    segments: 3,
    // genome: 3 sizes + 2 joints × 3 params = 9
    genomeSize: 9,
    build(decoded, startX, startY, index) {
      const bodies = [];
      const constraints = [];
      for (let i = 0; i < decoded.sizes.length; i++) {
        const r = decoded.sizes[i];
        const body = Bodies.circle(startX + i * 28, startY, r, {
          friction: 0.6, restitution: 0.3, density: 0.002,
          collisionFilter: { category: 0x0002, mask: 0x0001 },
        });
        body._creatureIdx = index;
        bodies.push(body);
      }
      for (let i = 0; i < bodies.length - 1; i++) {
        constraints.push(Constraint.create({
          bodyA: bodies[i], bodyB: bodies[i + 1],
          stiffness: 0.6, damping: 0.1, length: 24,
        }));
      }
      return { bodies, constraints };
    },
    decode(genome) {
      const sizes = [];
      const joints = [];
      for (let i = 0; i < 3; i++) sizes.push(8 + Math.abs(genome[i]) * 12);
      for (let i = 0; i < 2; i++) {
        const base = 3 + i * 3;
        joints.push({
          phase: genome[base] * Math.PI,
          freq: 1 + Math.abs(genome[base + 1]) * 6,
          amplitude: Math.abs(genome[base + 2]) * 0.012,
        });
      }
      return { sizes, joints };
    },
  },

  hopper: {
    name: 'Hopper',
    segments: 2,
    // genome: 2 sizes + 1 joint × 3 params + 1 leg length + 1 leg stiffness = 8
    genomeSize: 8,
    build(decoded, startX, startY, index) {
      const bodies = [];
      const constraints = [];
      // Heavy body
      const bodyR = decoded.sizes[0];
      const mainBody = Bodies.circle(startX, startY, bodyR, {
        friction: 0.5, restitution: 0.4, density: 0.004,
        collisionFilter: { category: 0x0002, mask: 0x0001 },
      });
      mainBody._creatureIdx = index;
      bodies.push(mainBody);
      // Foot
      const footR = decoded.sizes[1];
      const foot = Bodies.circle(startX, startY + decoded.legLength, footR, {
        friction: 0.9, restitution: 0.2, density: 0.001,
        collisionFilter: { category: 0x0002, mask: 0x0001 },
      });
      foot._creatureIdx = index;
      bodies.push(foot);
      // Spring leg
      constraints.push(Constraint.create({
        bodyA: mainBody, bodyB: foot,
        stiffness: decoded.legStiffness, damping: 0.05,
        length: decoded.legLength,
      }));
      return { bodies, constraints };
    },
    decode(genome) {
      const sizes = [10 + Math.abs(genome[0]) * 10, 5 + Math.abs(genome[1]) * 8];
      const joints = [{
        phase: genome[2] * Math.PI,
        freq: 1 + Math.abs(genome[3]) * 8,
        amplitude: Math.abs(genome[4]) * 0.018,
      }];
      const legLength = 20 + Math.abs(genome[5]) * 30;
      const legStiffness = 0.2 + Math.abs(genome[6]) * 0.7;
      return { sizes, joints, legLength, legStiffness };
    },
  },

  snake: {
    name: 'Snake',
    segments: 5,
    // genome: 5 sizes + 4 joints × 3 params = 17
    genomeSize: 17,
    build(decoded, startX, startY, index) {
      const bodies = [];
      const constraints = [];
      for (let i = 0; i < decoded.sizes.length; i++) {
        const r = decoded.sizes[i];
        const body = Bodies.circle(startX + i * 18, startY, r, {
          friction: 0.7, restitution: 0.2, density: 0.0015,
          collisionFilter: { category: 0x0002, mask: 0x0001 },
        });
        body._creatureIdx = index;
        bodies.push(body);
      }
      for (let i = 0; i < bodies.length - 1; i++) {
        constraints.push(Constraint.create({
          bodyA: bodies[i], bodyB: bodies[i + 1],
          stiffness: 0.4, damping: 0.15, length: 16,
        }));
      }
      return { bodies, constraints };
    },
    decode(genome) {
      const sizes = [];
      const joints = [];
      for (let i = 0; i < 5; i++) sizes.push(5 + Math.abs(genome[i]) * 8);
      for (let i = 0; i < 4; i++) {
        const base = 5 + i * 3;
        joints.push({
          phase: genome[base] * Math.PI,
          freq: 1 + Math.abs(genome[base + 1]) * 5,
          amplitude: Math.abs(genome[base + 2]) * 0.008,
        });
      }
      return { sizes, joints };
    },
  },

  bipod: {
    name: 'Bipod',
    segments: 3, // body + 2 feet
    // genome: 3 sizes + 2 joints × 3 + 2 leg lengths = 13
    genomeSize: 13,
    build(decoded, startX, startY, index) {
      const bodies = [];
      const constraints = [];
      // Main body (rectangle-ish, but we use circle for simplicity)
      const mainR = decoded.sizes[0];
      const main = Bodies.circle(startX, startY, mainR, {
        friction: 0.4, restitution: 0.3, density: 0.003,
        collisionFilter: { category: 0x0002, mask: 0x0001 },
      });
      main._creatureIdx = index;
      bodies.push(main);
      // Left foot
      const lFoot = Bodies.circle(startX - decoded.legLengths[0] * 0.5, startY + decoded.legLengths[0], decoded.sizes[1], {
        friction: 0.8, restitution: 0.2, density: 0.001,
        collisionFilter: { category: 0x0002, mask: 0x0001 },
      });
      lFoot._creatureIdx = index;
      bodies.push(lFoot);
      // Right foot
      const rFoot = Bodies.circle(startX + decoded.legLengths[1] * 0.5, startY + decoded.legLengths[1], decoded.sizes[2], {
        friction: 0.8, restitution: 0.2, density: 0.001,
        collisionFilter: { category: 0x0002, mask: 0x0001 },
      });
      rFoot._creatureIdx = index;
      bodies.push(rFoot);
      // Leg constraints
      constraints.push(Constraint.create({
        bodyA: main, bodyB: lFoot,
        stiffness: 0.5, damping: 0.1, length: decoded.legLengths[0],
      }));
      constraints.push(Constraint.create({
        bodyA: main, bodyB: rFoot,
        stiffness: 0.5, damping: 0.1, length: decoded.legLengths[1],
      }));
      return { bodies, constraints };
    },
    decode(genome) {
      const sizes = [10 + Math.abs(genome[0]) * 10, 4 + Math.abs(genome[1]) * 6, 4 + Math.abs(genome[2]) * 6];
      const joints = [];
      for (let i = 0; i < 2; i++) {
        const base = 3 + i * 3;
        joints.push({
          phase: genome[base] * Math.PI,
          freq: 1 + Math.abs(genome[base + 1]) * 6,
          amplitude: Math.abs(genome[base + 2]) * 0.015,
        });
      }
      const legLengths = [20 + Math.abs(genome[9]) * 25, 20 + Math.abs(genome[10]) * 25];
      return { sizes, joints, legLengths };
    },
  },

  triball: {
    name: 'Triball',
    segments: 3,
    // genome: 3 sizes + 3 joints × 3 params + 3 link lengths = 15
    genomeSize: 15,
    build(decoded, startX, startY, index) {
      const bodies = [];
      const constraints = [];
      // Three balls in a triangle
      const offsets = [
        { x: 0, y: -decoded.linkLengths[0] * 0.5 },
        { x: -decoded.linkLengths[1] * 0.4, y: decoded.linkLengths[1] * 0.3 },
        { x: decoded.linkLengths[2] * 0.4, y: decoded.linkLengths[2] * 0.3 },
      ];
      for (let i = 0; i < 3; i++) {
        const r = decoded.sizes[i];
        const body = Bodies.circle(startX + offsets[i].x, startY + offsets[i].y, r, {
          friction: 0.6, restitution: 0.3, density: 0.002,
          collisionFilter: { category: 0x0002, mask: 0x0001 },
        });
        body._creatureIdx = index;
        bodies.push(body);
      }
      // Connect all pairs (triangle)
      const pairs = [[0,1],[1,2],[2,0]];
      pairs.forEach(([a,b], i) => {
        constraints.push(Constraint.create({
          bodyA: bodies[a], bodyB: bodies[b],
          stiffness: 0.5, damping: 0.1, length: decoded.linkLengths[i],
        }));
      });
      return { bodies, constraints };
    },
    decode(genome) {
      const sizes = [];
      const joints = [];
      for (let i = 0; i < 3; i++) sizes.push(6 + Math.abs(genome[i]) * 12);
      for (let i = 0; i < 3; i++) {
        const base = 3 + i * 3;
        joints.push({
          phase: genome[base] * Math.PI,
          freq: 1 + Math.abs(genome[base + 1]) * 6,
          amplitude: Math.abs(genome[base + 2]) * 0.012,
        });
      }
      const linkLengths = [20 + Math.abs(genome[12]) * 25, 20 + Math.abs(genome[13]) * 25, 20 + Math.abs(genome[14]) * 25];
      return { sizes, joints, linkLengths };
    },
  },
};

function getBodyType() {
  return BODY_TYPES[CONFIG.bodyType] || BODY_TYPES.roller;
}

function updateGenomeSize() {
  CONFIG.genomeSize = getBodyType().genomeSize;
}

// ============================================================
// INFO TOOLTIPS for pipeline steps
// ============================================================
const STEP_INFO = {
  evaluate: {
    desc: 'Runs each creature in the physics simulation and measures how far it travels. Fitness = distance from start. If finish bonus is on, creatures that reach the finish line get extra fitness for speed.',
    params: {
      timeLimit: 'Seconds each generation runs before stopping. Longer = more time for creatures to travel, but slower generations.',
      earlyStop: 'If enabled, ends the generation early when all creatures have stopped moving (velocity near zero). Saves time on stuck populations.',
      finishBonus: 'If enabled, creatures that cross the finish line get bonus fitness based on how quickly they arrived. Rewards speed, not just distance.',
    },
  },
  elitism: {
    desc: 'Copies the top performers directly into the next generation unchanged. Guarantees the best solutions are never lost.',
    params: {
      count: 'Number of top creatures to preserve. Higher = more stability but less exploration.',
    },
  },
  select: {
    desc: 'Chooses parents from the current generation for breeding. Better-performing creatures get a higher chance of being selected.',
    params: {
      method: 'Tournament: picks the best from a random subset. Roulette: selection probability proportional to fitness.',
      tournamentSize: 'How many creatures compete in each tournament. Larger = stronger selection pressure toward the fittest.',
    },
  },
  crossover: {
    desc: 'Combines the genomes of two parents to create a child. Mixes traits from both parents to explore new combinations.',
    params: {
      rate: 'Probability (0–1) that crossover happens. Otherwise the child is a clone of one parent.',
      method: 'Uniform: each gene randomly from either parent. Single-point: genome split at one point, halves swapped.',
    },
  },
  mutate: {
    desc: 'Randomly alters genes in offspring. Introduces new variation so the population can explore beyond what parents had.',
    params: {
      rate: 'Probability (0–1) that each individual gene is mutated. Higher = more variation per creature.',
      strength: 'How much a mutated gene changes (0–1). Higher = bigger jumps, more exploration but less stability.',
    },
  },
};

// ============================================================
// STATE
// ============================================================
const STATE = {
  generation: 0,
  population: [],
  bestAllTime: null,
  bestGenFitness: 0,
  fitnessHistory: [],
  simTime: 0,
  phase: 'evaluating',
  camera: { zoom: 1, panX: 0, panY: 0 },
  ghostReplay: null,
};

// ============================================================
// PIPELINE (default)
// ============================================================
let pipeline = [
  { type: 'evaluate', removable: false, config: { timeLimit: 15, earlyStop: true, finishBonus: true } },
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
    positionIterations: 12,
    velocityIterations: 8,
  });
  world = engine.world;
  buildGround();
}

function buildGround() {
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
    const body = Bodies.rectangle(cx, cy, len, 30, {
      isStatic: true,
      angle: angle,
      friction: 0.8,
      restitution: 0.2,
      collisionFilter: { category: 0x0001 },
    });
    body._groundSeg = true;
    groundBodies.push(body);
    Composite.add(world, body);
  });

  // Safety floor far below
  const safetyFloor = Bodies.rectangle(CONFIG.finishX / 2, CONFIG.groundY + 500, CONFIG.finishX + 2000, 60, {
    isStatic: true,
    friction: 0.8,
    collisionFilter: { category: 0x0001 },
  });
  safetyFloor._safety = true;
  groundBodies.push(safetyFloor);
  Composite.add(world, safetyFloor);
}

function generateTerrain() {
  const segs = [];
  const baseY = CONFIG.groundY;
  let x = -200;
  const endX = CONFIG.finishX + 400;

  while (x < endX) {
    const segLen = 80 + ((Math.sin(x * 0.0073) + 1) * 0.5) * 100;
    const nextX = x + segLen;
    const y1 = baseY + Math.sin(x * 0.003) * 25 + Math.sin(x * 0.0008) * 40;
    const y2 = baseY + Math.sin(nextX * 0.003) * 25 + Math.sin(nextX * 0.0008) * 40;
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
    g.push(Math.random() * 2 - 1);
  }
  return g;
}

function spawnCreature(genome, index) {
  const bt = getBodyType();
  const decoded = bt.decode(genome);
  const startX = CONFIG.startX;
  const startY = CONFIG.groundY - 60;

  const { bodies, constraints } = bt.build(decoded, startX, startY, index);
  bodies.forEach(b => Composite.add(world, b));
  constraints.forEach(c => Composite.add(world, c));

  return {
    genome, decoded, bodies, constraints,
    fitness: 0, finished: false, dead: false,
    maxX: startX, replayPositions: [],
  };
}

function removeCreature(creature) {
  creature.bodies.forEach(b => Composite.remove(world, b));
  creature.constraints.forEach(c => Composite.remove(world, c));
}

function applyOscillation(creature, time) {
  if (creature.dead || creature.finished) return;
  const { decoded, bodies } = creature;
  const joints = decoded.joints || [];
  // Apply oscillation between consecutive body pairs (or all pairs for triball)
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    const force = Math.sin(time * j.freq * Math.PI * 2 + j.phase) * j.amplitude;

    const bodyA = bodies[Math.min(i, bodies.length - 1)];
    const bodyB = bodies[Math.min(i + 1, bodies.length - 1)];
    if (bodyA === bodyB) continue;

    const dx = bodyB.position.x - bodyA.position.x;
    const dy = bodyB.position.y - bodyA.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    const px = -ny * force;
    const py = nx * force;

    Body.applyForce(bodyA, bodyA.position, { x: -px, y: -py });
    Body.applyForce(bodyB, bodyB.position, { x: px, y: py });

    const axialForce = force * 0.5;
    Body.applyForce(bodyA, bodyA.position, { x: -nx * axialForce, y: -ny * axialForce });
    Body.applyForce(bodyB, bodyB.position, { x: nx * axialForce, y: ny * axialForce });
  }
}

function freezeCreature(creature) {
  creature.bodies.forEach(b => {
    Body.setStatic(b, true);
  });
}

function checkBounds(creature) {
  if (creature.dead || creature.finished) return;
  // Check if any body part went past left boundary (behind start)
  const leftBound = CONFIG.startX - 50;
  let wentLeft = creature.bodies.some(b => b.position.x < leftBound);
  if (wentLeft) {
    creature.dead = true;
    freezeCreature(creature);
    return;
  }
  // Check if crossed finish line
  let crossedFinish = creature.bodies.some(b => b.position.x >= CONFIG.finishX);
  if (crossedFinish && !creature.finished) {
    creature.finished = true;
    creature.finishTime = STATE.simTime;
    freezeCreature(creature);
  }
  // Check if fell way below ground
  let fellOff = creature.bodies.every(b => b.position.y > CONFIG.groundY + 400);
  if (fellOff) {
    creature.dead = true;
    freezeCreature(creature);
  }
}

function evaluateFitness(creature) {
  if (creature.dead) {
    // Dead creatures keep whatever fitness they had (or 0)
    return creature.fitness;
  }
  let maxX = 0;
  creature.bodies.forEach(b => {
    if (b.position.x > maxX) maxX = b.position.x;
  });
  creature.maxX = Math.max(creature.maxX, maxX);
  creature.fitness = Math.max(0, creature.maxX - CONFIG.startX);

  // Finish line bonus (if crossed finish via checkBounds)
  if (creature.finished && creature.finishTime != null) {
    const evalStep = pipeline.find(s => s.type === 'evaluate');
    if (evalStep?.config?.finishBonus) {
      const timeLimit = evalStep.config.timeLimit || CONFIG.evalTime;
      const timeBonus = Math.max(0, timeLimit - creature.finishTime) * 100;
      creature.fitness = Math.max(creature.fitness, CONFIG.finishX - CONFIG.startX + timeBonus);
    }
  }

  return creature.fitness;
}

function isCreatureStalled(creature) {
  let totalSpeed = 0;
  creature.bodies.forEach(b => {
    totalSpeed += Math.abs(b.velocity.x) + Math.abs(b.velocity.y);
  });
  return totalSpeed < 0.3;
}

// ============================================================
// EVOLUTION OPERATORS
// ============================================================
function selectTournament(pop, size) {
  let best = null;
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * pop.length);
    if (!best || pop[idx].fitness > best.fitness) best = pop[idx];
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

function mutateGenome(genome, rate, strength) {
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

  for (const step of pipeline) {
    switch (step.type) {
      case 'evaluate': break;

      case 'elitism': {
        const count = Math.min(step.config.count, sorted.length);
        for (let i = 0; i < count; i++) newGenomes.push([...sorted[i].genome]);
        break;
      }

      case 'select': break;

      case 'crossover': {
        const selStep = pipeline.find(s => s.type === 'select');
        const selMethod = selStep?.config?.method || 'tournament';
        const tournSize = selStep?.config?.tournamentSize || 3;
        const needed = popSize - newGenomes.length;
        for (let i = 0; i < needed; i++) {
          const sel = selMethod === 'tournament'
            ? (p) => selectTournament(p, tournSize)
            : selectRoulette;
          const p1 = sel(sorted);
          const p2 = sel(sorted);
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
        const eliteCount = pipeline.find(s => s.type === 'elitism')?.config?.count || 0;
        newGenomes = newGenomes.map((g, i) => {
          if (i < eliteCount) return g;
          return mutateGenome(g, step.config.rate, step.config.strength);
        });
        break;
      }
    }
  }

  while (newGenomes.length < popSize) {
    const parent = selectTournament(sorted, 3);
    newGenomes.push(mutateGenome([...parent.genome], 0.2, 0.3));
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

window.addEventListener('resize', resizeCanvas);

function worldToScreen(wx, wy) {
  const cw = canvas.width / devicePixelRatio;
  const ch = canvas.height / devicePixelRatio;
  // Base transform: fit startX..finishX across viewport width with some padding
  const worldWidth = CONFIG.finishX - CONFIG.startX;
  const padding = 60;
  const baseScale = (cw - padding * 2) / worldWidth;
  const scale = baseScale * STATE.camera.zoom;
  // Center of the world range
  const worldCenterX = (CONFIG.startX + CONFIG.finishX) / 2;
  const worldCenterY = CONFIG.groundY;
  const sx = (wx - worldCenterX - STATE.camera.panX) * scale + cw / 2;
  const sy = (wy - worldCenterY - STATE.camera.panY) * scale + ch * 0.55;
  return { x: sx, y: sy };
}

function drawScene() {
  const cw = canvas.width / devicePixelRatio;
  const ch = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, cw, ch);

  // Background
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#0a0a14');
  grad.addColorStop(1, '#0d0d1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  // Grid
  ctx.strokeStyle = '#15152020';
  ctx.lineWidth = 1;
  const gridSize = 100 * STATE.camera.zoom;
  if (gridSize > 5) {
    const offsetX = (-STATE.camera.x * STATE.camera.zoom + cw * 0.15) % gridSize;
    const offsetY = (-STATE.camera.y * STATE.camera.zoom + ch * 0.55) % gridSize;
    for (let x = offsetX; x < cw; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = offsetY; y < ch; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }
  }

  // Start line
  const startScreen = worldToScreen(CONFIG.startX, 0);
  ctx.strokeStyle = '#00e4a040';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(startScreen.x, 0); ctx.lineTo(startScreen.x, ch); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#00e4a060';
  ctx.font = '10px "IBM Plex Mono"';
  ctx.fillText('START', startScreen.x + 4, 20);

  // Finish line
  const finishScreen = worldToScreen(CONFIG.finishX, 0);
  ctx.strokeStyle = '#ff6b4a40';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(finishScreen.x, 0); ctx.lineTo(finishScreen.x, ch); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff6b4a60';
  ctx.fillText('FINISH', finishScreen.x + 4, 20);

  // Ground bodies
  groundBodies.forEach(body => {
    if (body._safety) return; // don't draw safety floor
    const verts = body.vertices;
    const screenVerts = verts.map(v => worldToScreen(v.x, v.y));
    ctx.fillStyle = '#141420';
    ctx.strokeStyle = '#2a3545';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenVerts[0].x, screenVerts[0].y);
    for (let i = 1; i < screenVerts.length; i++) ctx.lineTo(screenVerts[i].x, screenVerts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // Bright top edge on ground
  ctx.strokeStyle = '#3a4a60';
  ctx.lineWidth = 1.5;
  groundBodies.forEach(body => {
    if (body._safety) return;
    const verts = body.vertices;
    const s0 = worldToScreen(verts[0].x, verts[0].y);
    const s1 = worldToScreen(verts[1].x, verts[1].y);
    ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  });

  // Ghost replay
  if (STATE.ghostReplay && STATE.ghostReplay.length > 0) {
    const frameIdx = Math.min(
      Math.floor((STATE.simTime / CONFIG.evalTime) * STATE.ghostReplay.length),
      STATE.ghostReplay.length - 1
    );
    const frame = STATE.ghostReplay[frameIdx];
    if (frame) {
      ctx.globalAlpha = 0.12;
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
  let drawCreatures = creatures;
  if (CONFIG.displayMode === 'best' && creatures.length > 0) {
    let bestCreature = creatures[0];
    creatures.forEach(c => { if (c.fitness > bestCreature.fitness) bestCreature = c; });
    drawCreatures = [bestCreature];
  }

  drawCreatures.forEach((creature, ci) => {
    const isBest = CONFIG.displayMode === 'best';
    const isDead = creature.dead;
    const isFinished = creature.finished;
    const hue = isBest ? 40 : isDead ? 0 : isFinished ? 60 : (ci / creatures.length) * 60 + 140;
    const alpha = isDead ? 0.15 : isBest ? 0.95 : 0.7;
    const sat = isDead ? 0 : 70;
    creature.bodies.forEach((body, bi) => {
      const sp = worldToScreen(body.position.x, body.position.y);
      const r = creature.decoded.sizes[bi] * STATE.camera.zoom;
      ctx.fillStyle = `hsla(${hue}, ${sat}%, 55%, ${alpha})`;
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 65%, ${Math.min(alpha + 0.2, 1)})`;
      ctx.lineWidth = isBest ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    creature.constraints.forEach(c => {
      const a = worldToScreen(c.bodyA.position.x, c.bodyA.position.y);
      const b = worldToScreen(c.bodyB.position.x, c.bodyB.position.y);
      ctx.strokeStyle = `hsla(${hue}, ${sat * 0.7}%, 50%, ${alpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
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

  gctx.strokeStyle = '#ff6b4a';
  gctx.lineWidth = 1.5;
  gctx.beginPath();
  data.forEach((d, i) => {
    const x = i * xStep;
    const y = h - (d.best / maxFit) * (h - 4);
    i === 0 ? gctx.moveTo(x, y) : gctx.lineTo(x, y);
  });
  gctx.stroke();

  gctx.strokeStyle = '#5b8aff80';
  gctx.lineWidth = 1;
  gctx.beginPath();
  data.forEach((d, i) => {
    const x = i * xStep;
    const y = h - (d.avg / maxFit) * (h - 4);
    i === 0 ? gctx.moveTo(x, y) : gctx.lineTo(x, y);
  });
  gctx.stroke();

  gctx.fillStyle = '#ff6b4a80';
  gctx.font = '8px "IBM Plex Mono"';
  gctx.fillText(`best: ${maxFit.toFixed(0)}`, 4, 10);
  gctx.fillStyle = '#5b8aff60';
  gctx.fillText('avg', 4, 20);
}

// ============================================================
// SIMULATION LOOP
// ============================================================
function spawnPopulation(genomes) {
  creatures.forEach(c => removeCreature(c));
  creatures = [];
  genomes.forEach((g, i) => creatures.push(spawnCreature(g, i)));
}

function startGeneration(genomes) {
  STATE.simTime = 0;
  STATE.phase = 'evaluating';
  STATE.bestGenFitness = 0;
  spawnPopulation(genomes);
}

function endGeneration() {
  creatures.forEach(c => evaluateFitness(c));

  const sorted = [...creatures].sort((a, b) => b.fitness - a.fitness);
  const bestFit = sorted[0]?.fitness || 0;
  const avgFit = creatures.reduce((s, c) => s + c.fitness, 0) / creatures.length;

  STATE.bestGenFitness = bestFit;
  STATE.fitnessHistory.push({ gen: STATE.generation, best: bestFit, avg: avgFit });

  if (!STATE.bestAllTime || bestFit > STATE.bestAllTime.fitness) {
    STATE.bestAllTime = { fitness: bestFit, genome: [...sorted[0].genome] };
    STATE.ghostReplay = sorted[0].replayPositions;
  }

  const newGenomes = runPipeline(creatures);
  STATE.generation++;
  startGeneration(newGenomes);
}

let lastTime = 0;
const PHYSICS_DT = 1000 / 60;

function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  if (CONFIG.paused) {
    drawScene();
    requestAnimationFrame(gameLoop);
    return;
  }

  dt = Math.min(dt, 0.05);
  dt *= CONFIG.speedMultiplier;

  const steps = Math.max(1, Math.round(dt / (PHYSICS_DT / 1000)));
  const subDt = dt / steps;

  for (let s = 0; s < steps; s++) {
    STATE.simTime += subDt;

    creatures.forEach(c => {
      applyOscillation(c, STATE.simTime);
      checkBounds(c);
      if (Math.random() < 0.08 && !c.dead) {
        c.replayPositions.push(
          c.bodies.map(b => ({
            x: b.position.x, y: b.position.y,
            r: c.decoded.sizes[c.bodies.indexOf(b)] || 8,
          }))
        );
      }
    });

    Engine.update(engine, PHYSICS_DT);
  }

  creatures.forEach(c => evaluateFitness(c));

  // Get eval config from pipeline
  const evalStep = pipeline.find(s => s.type === 'evaluate');
  const timeLimit = evalStep?.config?.timeLimit || CONFIG.evalTime;
  const earlyStop = evalStep?.config?.earlyStop ?? false;

  let shouldEnd = STATE.simTime >= timeLimit;

  // Early stop: if all creatures stalled, finished, or dead
  if (!shouldEnd && earlyStop && STATE.simTime > 2) {
    const allDone = creatures.every(c => c.finished || c.dead || isCreatureStalled(c));
    if (allDone) shouldEnd = true;
  }

  // All finished or dead
  if (!shouldEnd) {
    const allDone = creatures.every(c => c.finished || c.dead);
    if (allDone) shouldEnd = true;
  }

  if (shouldEnd) endGeneration();

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

  const alive = creatures.filter(c => !c.finished && !c.dead).length;
  document.getElementById('hud-alive').textContent = alive;
  document.getElementById('hud-time').textContent = STATE.simTime.toFixed(1) + 's';
}

// ============================================================
// PIPELINE UI
// ============================================================
let activeTooltip = null;

function closeTooltip() {
  if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
}

function showTooltip(stepType, anchorEl) {
  closeTooltip();
  const info = STEP_INFO[stepType];
  if (!info) return;

  const tip = document.createElement('div');
  tip.className = 'info-tooltip';

  let html = `<div class="info-tooltip-title">${stepType}</div>`;
  html += `<div class="info-tooltip-desc">${info.desc}</div>`;

  const paramKeys = Object.keys(info.params);
  if (paramKeys.length > 0) {
    html += '<div class="info-tooltip-params">';
    paramKeys.forEach(k => {
      html += `<div class="info-tooltip-param"><span class="info-tooltip-param-name">${k}:</span> ${info.params[k]}</div>`;
    });
    html += '</div>';
  }

  html += '<div class="info-tooltip-hint">click anywhere to close</div>';
  tip.innerHTML = html;

  document.getElementById('pipeline-panel').appendChild(tip);
  activeTooltip = tip;

  const panelRect = document.getElementById('pipeline-panel').getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  tip.style.top = (anchorRect.top - panelRect.top + anchorRect.height + 4) + 'px';
  tip.style.left = '12px';
  tip.style.right = '12px';

  setTimeout(() => {
    const closer = (e) => {
      closeTooltip();
      document.removeEventListener('click', closer);
    };
    document.addEventListener('click', closer);
  }, 10);
}

function renderPipeline() {
  const container = document.getElementById('pipeline-nodes');
  container.innerHTML = '';

  pipeline.forEach((step, idx) => {
    if (idx > 0) {
      const conn = document.createElement('div');
      conn.className = 'pipe-connector';
      conn.textContent = '↓';
      container.appendChild(conn);
    }

    const node = document.createElement('div');
    node.className = 'pipe-node';
    node.dataset.index = idx;

    const header = document.createElement('div');
    header.className = 'pipe-node-header';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;align-items:center;gap:6px';

    const typeLabel = document.createElement('span');
    typeLabel.className = `pipe-node-type ${step.type}`;
    typeLabel.textContent = step.type;
    leftGroup.appendChild(typeLabel);

    const infoBtn = document.createElement('span');
    infoBtn.className = 'pipe-node-info';
    infoBtn.textContent = '?';
    infoBtn.onclick = (e) => { e.stopPropagation(); showTooltip(step.type, infoBtn); };
    leftGroup.appendChild(infoBtn);

    header.appendChild(leftGroup);
    node.appendChild(header);

    const configDiv = document.createElement('div');
    configDiv.className = 'pipe-node-config';

    switch (step.type) {
      case 'evaluate':
        configDiv.appendChild(makeNumberInput('Time Limit (s)', step.config, 'timeLimit', 3, 120, 1));
        configDiv.appendChild(makeCheckboxInput('Early Stop', step.config, 'earlyStop'));
        configDiv.appendChild(makeCheckboxInput('Finish Bonus', step.config, 'finishBonus'));
        break;
      case 'elitism':
        configDiv.appendChild(makeNumberInput('Count', step.config, 'count', 0, 20, 1));
        break;
      case 'select':
        configDiv.appendChild(makeSelectInput('Method', step.config, 'method', ['tournament', 'roulette']));
        if (step.config.method === 'tournament')
          configDiv.appendChild(makeNumberInput('Tourn. Size', step.config, 'tournamentSize', 2, 10, 1));
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
  input.type = 'number'; input.min = min; input.max = max; input.step = step;
  input.value = configObj[key];
  input.addEventListener('change', () => { configObj[key] = parseFloat(input.value); });
  row.appendChild(lbl); row.appendChild(input);
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
    o.value = opt; o.textContent = opt;
    if (opt === configObj[key]) o.selected = true;
    select.appendChild(o);
  });
  select.addEventListener('change', () => { configObj[key] = select.value; renderPipeline(); });
  row.appendChild(lbl); row.appendChild(select);
  return row;
}

function makeCheckboxInput(label, configObj, key) {
  const row = document.createElement('div');
  row.className = 'config-row';
  const lbl = document.createElement('span');
  lbl.className = 'config-label';
  lbl.textContent = label;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'config-checkbox';
  cb.checked = !!configObj[key];
  cb.addEventListener('change', () => { configObj[key] = cb.checked; });
  row.appendChild(lbl); row.appendChild(cb);
  return row;
}

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
  updateGenomeSize();
  STATE.generation = 0;
  STATE.bestAllTime = null;
  STATE.fitnessHistory = [];
  STATE.ghostReplay = null;
  STATE.camera = { zoom: 1, panX: 0, panY: 0 };

  creatures.forEach(c => removeCreature(c));
  creatures = [];

  Composite.clear(world, false, true);
  buildGround();

  const genomes = Array.from({ length: parseInt(document.getElementById('pop-size').value) || CONFIG.popSize }, randomGenome);
  startGeneration(genomes);
});

document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    CONFIG.speedMultiplier = parseInt(btn.dataset.speed);
  });
});

document.getElementById('btn-display').addEventListener('click', () => {
  const btn = document.getElementById('btn-display');
  if (CONFIG.displayMode === 'all') {
    CONFIG.displayMode = 'best';
    btn.textContent = '👁 Best';
    btn.classList.add('active');
  } else {
    CONFIG.displayMode = 'all';
    btn.textContent = '👁 All';
    btn.classList.remove('active');
  }
});

document.getElementById('pop-size').addEventListener('change', (e) => { CONFIG.popSize = parseInt(e.target.value) || 30; });

document.getElementById('body-type').addEventListener('change', (e) => {
  CONFIG.bodyType = e.target.value;
  updateGenomeSize();
  // Full reset
  STATE.generation = 0;
  STATE.bestAllTime = null;
  STATE.fitnessHistory = [];
  STATE.ghostReplay = null;
  STATE.camera = { zoom: 1, panX: 0, panY: 0 };
  creatures.forEach(c => removeCreature(c));
  creatures = [];
  Composite.clear(world, false, true);
  buildGround();
  const genomes = Array.from({ length: CONFIG.popSize }, randomGenome);
  startGeneration(genomes);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
  STATE.camera.zoom = Math.max(0.2, Math.min(20, STATE.camera.zoom * zoomDelta));
}, { passive: false });

// Pan with middle-click drag or left-click drag
let isPanning = false;
let panStartX = 0, panStartY = 0;
let panStartCamX = 0, panStartCamY = 0;

canvas.addEventListener('mousedown', (e) => {
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartCamX = STATE.camera.panX;
  panStartCamY = STATE.camera.panY;
  canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  const cw = canvas.width / devicePixelRatio;
  const worldWidth = CONFIG.finishX - CONFIG.startX;
  const padding = 60;
  const baseScale = (cw - padding * 2) / worldWidth;
  const scale = baseScale * STATE.camera.zoom;
  const dx = (e.clientX - panStartX) / scale;
  const dy = (e.clientY - panStartY) / scale;
  STATE.camera.panX = panStartCamX - dx;
  STATE.camera.panY = panStartCamY - dy;
});

window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = 'grab';
  }
});

canvas.style.cursor = 'grab';

// ============================================================
// INIT
// ============================================================
function init() {
  updateGenomeSize();
  resizeCanvas();
  initPhysics();
  renderPipeline();
  const genomes = Array.from({ length: CONFIG.popSize }, randomGenome);
  startGeneration(genomes);
  requestAnimationFrame(gameLoop);
}

init();
