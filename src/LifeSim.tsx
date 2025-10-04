import { useEffect, useRef, useState } from 'react'

interface Agent {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  energy: number
  age: number
  speed: number
  vision: number
  size: number
  type: 'carnivore' | 'herbivore' | 'neutral'
  reproCooldown?: number
  metabolism: number
  lastAteTicks?: number
  seedCooldown?: number
  stuckTicks?: number
}

interface Food {
  id: number
  x: number
  y: number
}

const WORLD_WIDTH = 800
const WORLD_HEIGHT = 500
const INITIAL_AGENTS = 100
const INITIAL_FOOD = 60
const MAX_HERBIVORES_DEFAULT = 220
const MAX_CARNIVORES_DEFAULT = 80

export function LifeSim(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const popCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const agentsRef = useRef<Agent[]>([])
  const foodRef = useRef<Food[]>([])
  const historyRef = useRef<Array<{ herb: number; carn: number; neutral: number }>>([])
  const nextIdRef = useRef<number>(INITIAL_AGENTS)
  const [isRunning, setIsRunning] = useState(false)
  const [herbivoreSpeed, setHerbivoreSpeed] = useState(1)
  const [carnivoreSpeed, setCarnivoreSpeed] = useState(1)
  const [foodSpawnRate, setFoodSpawnRate] = useState(0.02)
  const [timeScale, setTimeScale] = useState(0.7)
  const [carnivoreMetabolismScale, setCarnivoreMetabolismScale] = useState(1)
  const [carnivoreCatchRadius, setCarnivoreCatchRadius] = useState(8)
  const [carnivoreReproThreshold, setCarnivoreReproThreshold] = useState(180)
  const [maxCarnivores, setMaxCarnivores] = useState(MAX_CARNIVORES_DEFAULT)
  const [herbivoreReproThreshold, setHerbivoreReproThreshold] = useState(150)
  const [maxHerbivores, setMaxHerbivores] = useState(MAX_HERBIVORES_DEFAULT)

  function initializeWorld() {
    const initialAgents: Agent[] = []
    for (let i = 0; i < INITIAL_AGENTS; i++) {
      const typeRand = Math.random()
      const type: Agent['type'] = typeRand < 0.55 ? 'herbivore' : typeRand < 0.9 ? 'neutral' : 'carnivore'
      const baseEnergy = type === 'herbivore' ? 50 : type === 'carnivore' ? 55 : 40
      const baseMetabolism = type === 'carnivore' ? 0.14 : type === 'herbivore' ? 0.07 : 0.055
      const metabolism = Math.max(0.02, baseMetabolism + (Math.random() - 0.5) * 0.03)
      initialAgents.push({
        id: i,
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        energy: baseEnergy,
        age: 0,
        speed: 0.5 + Math.random() * 1.2,
        vision: 40 + Math.random() * 20,
        size: 5,
        type,
        reproCooldown: Math.floor(Math.random() * 300),
        metabolism,
        lastAteTicks: Math.floor(Math.random() * 200),
        seedCooldown: type === 'neutral' ? 150 + Math.floor(Math.random() * 200) : undefined,
        stuckTicks: 0,
      })
    }
    agentsRef.current = initialAgents

    const initialFood: Food[] = []
    for (let i = 0; i < INITIAL_FOOD; i++) {
      initialFood.push({ id: i, x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT })
    }
    foodRef.current = initialFood

    historyRef.current = []
  }

  useEffect(() => {
    initializeWorld()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const update = () => {
      ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

      // Dynamic food spawn: when herbivores are scarce, spawn more to avoid early collapse
      const herbCount = agentsRef.current.filter((a) => a.type === 'herbivore').length
      const scarcityBoost = herbCount < 40 ? 3 : herbCount < 70 ? 1.8 : 1
      if (Math.random() < foodSpawnRate * scarcityBoost) {
        foodRef.current.push({ id: Date.now(), x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT })
      }

      foodRef.current.forEach((f) => {
        // draw food as yellow squares for clear distinction
        ctx.fillStyle = '#facc15'
        ctx.fillRect(f.x - 3, f.y - 3, 6, 6)
      })

      const updatedAgents: Agent[] = []
      const eatenHerbivores = new Set<number>()
      const currentHerbivores = agentsRef.current.filter((a) => a.type === 'herbivore').length
      const currentCarnivores = agentsRef.current.filter((a) => a.type === 'carnivore').length
      let spawnedHerbivores = 0
      for (const agent of agentsRef.current) {
        let { x, y, dx, dy, energy, age, speed, type, size, reproCooldown = 0, metabolism, lastAteTicks = 0, stuckTicks = 0 } = agent
        if (metabolism === undefined) {
          const baseMetabolism = type === 'carnivore' ? 0.14 : type === 'herbivore' ? 0.07 : 0.055
          metabolism = Math.max(0.02, baseMetabolism + (Math.random() - 0.5) * 0.03)
        }

        const adjustedSpeed =
          type === 'herbivore' ? speed * herbivoreSpeed : type === 'carnivore' ? speed * carnivoreSpeed : speed * 0.8

        let pursuing = false
        if (type === 'herbivore' && foodRef.current.length > 0) {
          const nearestFood = foodRef.current.reduce((closest, f) => {
            const d = Math.hypot(f.x - x, f.y - y)
            return d < Math.hypot(closest.x - x, closest.y - y) ? f : closest
          })
          const dist = Math.hypot(nearestFood.x - x, nearestFood.y - y)
          if (dist < agent.vision) {
            dx += ((nearestFood.x - x) / dist) * 0.45
            dy += ((nearestFood.y - y) / dist) * 0.45
            pursuing = true
          }
        }

        // Herbivores flee from nearby carnivores
        if (type === 'herbivore') {
          const hunters = agentsRef.current.filter((a) => a.type === 'carnivore')
          if (hunters.length > 0) {
            const nearestHunter = hunters.reduce((closest, p) => {
              const d = Math.hypot(p.x - x, p.y - y)
              return d < Math.hypot(closest.x - x, closest.y - y) ? p : closest
            })
            const pd = Math.hypot(nearestHunter.x - x, nearestHunter.y - y)
            if (pd < agent.vision * 0.9) {
              // Accelerate away a bit stronger than food attraction
              dx -= ((nearestHunter.x - x) / (pd || 1)) * 0.35
              dy -= ((nearestHunter.y - y) / (pd || 1)) * 0.35
            }
          }
        }

        if (type === 'carnivore') {
          const prey = agentsRef.current.filter((a) => a.type === 'herbivore')
          if (prey.length > 0) {
            const nearest = prey.reduce((closest, p) => {
              const d = Math.hypot(p.x - x, p.y - y)
              return d < Math.hypot(closest.x - x, closest.y - y) ? p : closest
            })
            const dist = Math.hypot(nearest.x - x, nearest.y - y)
            if (dist < agent.vision) {
              // steer toward prey using velocity blending for tighter pursuit
              const ux = (nearest.x - x) / (dist || 1)
              const uy = (nearest.y - y) / (dist || 1)
              dx = dx * 0.85 + ux * 0.7
              dy = dy * 0.85 + uy * 0.7
              pursuing = true
              // if moving too slowly while pursuing, give an extra push toward the target
              const sp = Math.hypot(dx, dy)
              if (sp < 0.25) {
                dx += ux * 0.6
                dy += uy * 0.6
              }
            } else {
              // wander if prey is far
              dx += (Math.random() - 0.5) * 0.06
              dy += (Math.random() - 0.5) * 0.06
            }
            // soft repulsion from nearby food so carnivores don't appear to eat it
            if (foodRef.current.length > 0) {
              const nearestFood = foodRef.current.reduce((closest, f) => {
                const d = Math.hypot(f.x - x, f.y - y)
                return d < Math.hypot(closest.x - x, closest.y - y) ? f : closest
              })
              const fd = Math.hypot(nearestFood.x - x, nearestFood.y - y)
              if (fd < 12) {
                const fx = (nearestFood.x - x) / (fd || 1)
                const fy = (nearestFood.y - y) / (fd || 1)
                dx -= fx * 0.5
                dy -= fy * 0.5
              }
            }
          } else {
            // wander if no prey exists
            dx += (Math.random() - 0.5) * 0.06
            dy += (Math.random() - 0.5) * 0.06
          }
        }

        if (type === 'neutral') {
          dx += (Math.random() - 0.5) * 0.1
          dy += (Math.random() - 0.5) * 0.1
          // neutrals scatter energy seeds that become food
          const sc = agent.seedCooldown ?? 0
          if (sc <= 0 && Math.random() < 0.02) {
            foodRef.current.push({ id: Date.now() + Math.random(), x, y })
            agent.seedCooldown = 250 + Math.floor(Math.random() * 200)
          } else if (agent.seedCooldown && agent.seedCooldown > 0) {
            agent.seedCooldown -= 1
          }
          // slow self-gain
          if (Math.random() < 0.002) energy += 5
        }

        // Baseline wandering for all to prevent stalling; reduce when pursuing.
        // Carnivores that are not pursuing search more aggressively.
        const baseWander = type === 'neutral' ? 0.12 : 0.06
        const searchBoost = type === 'carnivore' && !pursuing ? 2.0 : 1.0
        const wanderStrength = (pursuing ? baseWander * 0.15 : baseWander * searchBoost)
        dx += (Math.random() - 0.5) * wanderStrength
        dy += (Math.random() - 0.5) * wanderStrength

        // Apply movement with global time scale
        x += dx * adjustedSpeed * timeScale
        y += dy * adjustedSpeed * timeScale
        dx *= 0.97
        dy *= 0.97

        // Cap velocity to avoid runaway speeds
        const maxVel = type === 'carnivore' ? 3.2 : 2.5
        const spd = Math.hypot(dx, dy)
        if (spd > maxVel) {
          dx = (dx / spd) * maxVel
          dy = (dy / spd) * maxVel
        }
        // Minimum speed kick if nearly stopped
        if (spd < 0.08) {
          const angle = Math.random() * Math.PI * 2
          dx += Math.cos(angle) * 0.35
          dy += Math.sin(angle) * 0.35
        }

        // Stuck detection: if moving too slowly for many ticks, apply strong nudge
        if (spd < 0.12) stuckTicks += 1
        else if (stuckTicks > 0) stuckTicks -= 1
        if (stuckTicks > 60) {
          const angle = Math.random() * Math.PI * 2
          dx += Math.cos(angle) * 1.0
          dy += Math.sin(angle) * 1.0
          stuckTicks = 0
        }

        if (x < 0 || x > WORLD_WIDTH) dx = -dx
        if (y < 0 || y > WORLD_HEIGHT) dy = -dy
        // Clamp inside bounds and nudge inward to avoid boundary jitter
        if (x < 1) { x = 1; dx = Math.abs(dx) + 0.2 }
        if (x > WORLD_WIDTH - 1) { x = WORLD_WIDTH - 1; dx = -Math.abs(dx) - 0.2 }
        if (y < 1) { y = 1; dy = Math.abs(dy) + 0.2 }
        if (y > WORLD_HEIGHT - 1) { y = WORLD_HEIGHT - 1; dy = -Math.abs(dy) - 0.2 }

        if (type === 'herbivore') {
          for (let i = 0; i < foodRef.current.length; i++) {
            const f = foodRef.current[i]
            const dist = Math.hypot(f.x - x, f.y - y)
            if (dist < 8) {
              energy += 35
              foodRef.current.splice(i, 1)
              lastAteTicks = 0
              break
            }
          }

          // Reproduction: if energetic and not on cooldown, spawn a child with slight mutations
          if (
            energy > herbivoreReproThreshold &&
            reproCooldown <= 0 &&
            currentHerbivores + spawnedHerbivores < maxHerbivores
          ) {
            const childSpeed = Math.max(0.4, Math.min(2.0, speed * (0.95 + Math.random() * 0.1)))
            const childVision = Math.max(30, Math.min(70, agent.vision * (0.95 + Math.random() * 0.1)))
            const child: Agent = {
              id: nextIdRef.current++,
              x: x + (Math.random() - 0.5) * 10,
              y: y + (Math.random() - 0.5) * 10,
              dx: dx + (Math.random() - 0.5) * 0.5,
              dy: dy + (Math.random() - 0.5) * 0.5,
              energy: 35,
              age: 0,
              speed: childSpeed,
              vision: childVision,
              size: 5,
              type: 'herbivore',
              reproCooldown: 600,
              metabolism: Math.max(0.02, (0.07 + (Math.random() - 0.5) * 0.03)),
            }
            updatedAgents.push(child)
            spawnedHerbivores += 1
            energy = 45
            reproCooldown = 600
          }
        }

        if (type === 'carnivore') {
          for (let i = 0; i < agentsRef.current.length; i++) {
            const prey = agentsRef.current[i]
            if (prey.type === 'herbivore') {
              const dist = Math.hypot(prey.x - x, prey.y - y)
              if (dist < carnivoreCatchRadius) {
                energy += 45
                eatenHerbivores.add(prey.id)
                lastAteTicks = 0
                break
              }
            }
          }

          // Reproduction for carnivores: split when energy is high and cooldown elapsed
          if (
            energy > carnivoreReproThreshold &&
            reproCooldown <= 0 &&
            currentCarnivores < maxCarnivores
          ) {
            const childSpeed = Math.max(0.6, Math.min(2.2, speed * (0.95 + Math.random() * 0.1)))
            const childVision = Math.max(50, Math.min(90, agent.vision * (0.95 + Math.random() * 0.1)))
            const child: Agent = {
              id: nextIdRef.current++,
              x: x + (Math.random() - 0.5) * 10,
              y: y + (Math.random() - 0.5) * 10,
              dx: dx + (Math.random() - 0.5) * 0.5,
              dy: dy + (Math.random() - 0.5) * 0.5,
              energy: 70,
              age: 0,
              speed: childSpeed,
              vision: childVision,
              size: 5,
              type: 'carnivore',
              reproCooldown: 700,
              metabolism: Math.max(0.02, (0.14 + (Math.random() - 0.5) * 0.03)),
              lastAteTicks: 0,
              seedCooldown: undefined,
              stuckTicks: 0,
            }
            updatedAgents.push(child)
            energy = 90
            reproCooldown = 700
          }
        }

        // Size follows energy (grow when eating, shrink when starving)
        const sizeFromEnergy = Math.max(3, Math.min(10, 3 + energy * 0.03))
        size = sizeFromEnergy

        ctx.beginPath()
        ctx.arc(x, y, sizeFromEnergy, 0, Math.PI * 2)
        ctx.fillStyle = type === 'carnivore' ? '#ef4444' : type === 'herbivore' ? '#22c55e' : '#3b82f6'
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()

        // Per-agent metabolism; extra starvation if carnivore hasn't eaten recently or no prey exists
        lastAteTicks += 1
        let starvationFactor = 0
        if (type === 'carnivore') {
          if (currentHerbivores === 0) {
            starvationFactor += 1.2
          }
          if (lastAteTicks > 900) starvationFactor += 1.0
          else if (lastAteTicks > 600) starvationFactor += 0.6
          else if (lastAteTicks > 300) starvationFactor += 0.3
        }
        energy -= (type === 'carnivore' ? metabolism * carnivoreMetabolismScale : metabolism) * (1 + starvationFactor) * timeScale
        age += 0.05
        if (reproCooldown > 0) reproCooldown -= 1

        if (energy > 0 && age < 800) {
          if (type === 'herbivore' && eatenHerbivores.has(agent.id)) {
            // skip adding eaten herbivore
          } else {
            updatedAgents.push({ ...agent, x, y, dx, dy, energy, age, size, reproCooldown, metabolism, lastAteTicks, stuckTicks })
          }
        }
      }

      agentsRef.current = updatedAgents

      // Collect population counts and draw chart
      const herb = updatedAgents.filter((a) => a.type === 'herbivore').length
      const carn = updatedAgents.filter((a) => a.type === 'carnivore').length
      const neutral = updatedAgents.filter((a) => a.type === 'neutral').length
      const hist = historyRef.current
      hist.push({ herb, carn, neutral })
      if (hist.length > 300) hist.shift()

      const popCanvas = popCanvasRef.current
      if (popCanvas) {
        const pctx = popCanvas.getContext('2d')
        if (pctx) {
          const w = popCanvas.width
          const h = popCanvas.height
          pctx.clearRect(0, 0, w, h)
          // axes
          pctx.strokeStyle = '#334155'
          pctx.lineWidth = 1
          pctx.beginPath()
          pctx.moveTo(0, h - 0.5)
          pctx.lineTo(w, h - 0.5)
          pctx.stroke()

          const maxY = Math.max(10, ...hist.map((s) => s.herb + s.carn + s.neutral))
          const stepX = w / Math.max(1, hist.length - 1)

          const drawSeries = (key: 'herb' | 'carn' | 'neutral', color: string) => {
            pctx.beginPath()
            pctx.strokeStyle = color
            pctx.lineWidth = 2
            hist.forEach((s, i) => {
              const x = i * stepX
              const y = h - (s[key] / maxY) * (h - 6) - 3
              if (i === 0) pctx.moveTo(x, y)
              else pctx.lineTo(x, y)
            })
            pctx.stroke()
          }

          drawSeries('herb', '#22c55e')
          drawSeries('carn', '#ef4444')
          drawSeries('neutral', '#3b82f6')
        }
      }

      if (isRunning) animationRef.current = requestAnimationFrame(update)
    }

    if (isRunning) animationRef.current = requestAnimationFrame(update)
    else if (animationRef.current) cancelAnimationFrame(animationRef.current)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [isRunning, herbivoreSpeed, carnivoreSpeed, foodSpawnRate, timeScale, carnivoreMetabolismScale, carnivoreCatchRadius, carnivoreReproThreshold, maxCarnivores, herbivoreReproThreshold, maxHerbivores])

  function resetWorld() {
    initializeWorld()
  }

  return (
    <div className="container">
      <canvas ref={canvasRef} width={WORLD_WIDTH} height={WORLD_HEIGHT} />

      <div className="legend">
        <p><span style={{ color: '#f87171' }}>● Carnivoren</span> jagen op herbivoren en sterven zonder prooi</p>
        <p><span style={{ color: '#4ade80' }}>● Herbivoren</span> eten voedsel en sterven bij honger</p>
        <p><span style={{ color: '#60a5fa' }}>● Neutrale wezens</span> bewegen willekeurig en genereren langzaam energie</p>
      </div>

      <div className="row">
        <button className="btn" onClick={() => setIsRunning(true)}>Start</button>
        <button className="btn" onClick={() => setIsRunning(false)}>Pause</button>
        <button className="btn" onClick={resetWorld}>Reset wereld</button>
      </div>

      <canvas ref={popCanvasRef} width={WORLD_WIDTH} height={120} />

      <div className="controls">
        <label className="label">Tijd-schaal: {timeScale.toFixed(2)}x</label>
        <input className="slider" type="range" min={0.25} max={2} step={0.05} value={timeScale} onChange={(e) => setTimeScale(parseFloat(e.target.value))} />

        <label className="label">Herbivoor snelheid: {herbivoreSpeed.toFixed(1)}x</label>
        <input className="slider" type="range" min={0.5} max={3} step={0.1} value={herbivoreSpeed} onChange={(e) => setHerbivoreSpeed(parseFloat(e.target.value))} />

        <label className="label">Carnivoor snelheid: {carnivoreSpeed.toFixed(1)}x</label>
        <input className="slider" type="range" min={0.5} max={3} step={0.1} value={carnivoreSpeed} onChange={(e) => setCarnivoreSpeed(parseFloat(e.target.value))} />

        <label className="label">Carnivoor metabolisme: {carnivoreMetabolismScale.toFixed(2)}x</label>
        <input className="slider" type="range" min={0.5} max={2} step={0.05} value={carnivoreMetabolismScale} onChange={(e) => setCarnivoreMetabolismScale(parseFloat(e.target.value))} />

        <label className="label">Carnivoor vang-radius: {carnivoreCatchRadius.toFixed(0)} px</label>
        <input className="slider" type="range" min={4} max={16} step={1} value={carnivoreCatchRadius} onChange={(e) => setCarnivoreCatchRadius(parseFloat(e.target.value))} />

        <label className="label">Carnivoor reproduce-drempel: {carnivoreReproThreshold.toFixed(0)} energie</label>
        <input className="slider" type="range" min={120} max={260} step={5} value={carnivoreReproThreshold} onChange={(e) => setCarnivoreReproThreshold(parseFloat(e.target.value))} />

        <label className="label">Max carnivoren: {maxCarnivores}</label>
        <input className="slider" type="range" min={20} max={160} step={5} value={maxCarnivores} onChange={(e) => setMaxCarnivores(parseFloat(e.target.value))} />

        <label className="label">Herbivoor reproduce-drempel: {herbivoreReproThreshold.toFixed(0)} energie</label>
        <input className="slider" type="range" min={100} max={220} step={5} value={herbivoreReproThreshold} onChange={(e) => setHerbivoreReproThreshold(parseFloat(e.target.value))} />

        <label className="label">Max herbivoren: {maxHerbivores}</label>
        <input className="slider" type="range" min={80} max={360} step={10} value={maxHerbivores} onChange={(e) => setMaxHerbivores(parseFloat(e.target.value))} />
        <label className="label">Voedsel spawn rate: {(foodSpawnRate * 100).toFixed(1)}%</label>
        <input className="slider" type="range" min={0.005} max={0.05} step={0.005} value={foodSpawnRate} onChange={(e) => setFoodSpawnRate(parseFloat(e.target.value))} />
      </div>
    </div>
  )
}


