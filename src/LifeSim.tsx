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

export function LifeSim(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const agentsRef = useRef<Agent[]>([])
  const foodRef = useRef<Food[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [herbivoreSpeed, setHerbivoreSpeed] = useState(1)
  const [carnivoreSpeed, setCarnivoreSpeed] = useState(1)
  const [foodSpawnRate, setFoodSpawnRate] = useState(0.02)
  const [timeScale, setTimeScale] = useState(0.7)

  useEffect(() => {
    const initialAgents: Agent[] = []
    for (let i = 0; i < INITIAL_AGENTS; i++) {
      const typeRand = Math.random()
      // Favor herbivores and neutrals; reduce carnivores to ~10%
      const type: Agent['type'] = typeRand < 0.55 ? 'herbivore' : typeRand < 0.9 ? 'neutral' : 'carnivore'
      initialAgents.push({
        id: i,
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        energy: 100,
        age: 0,
        speed: 0.5 + Math.random() * 1.2,
        vision: 40 + Math.random() * 20,
        size: 5,
        type,
      })
    }
    agentsRef.current = initialAgents

    const initialFood: Food[] = []
    for (let i = 0; i < INITIAL_FOOD; i++) {
      initialFood.push({ id: i, x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT })
    }
    foodRef.current = initialFood
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const update = () => {
      ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

      if (Math.random() < foodSpawnRate) {
        foodRef.current.push({ id: Date.now(), x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT })
      }

      foodRef.current.forEach((f) => {
        ctx.beginPath()
        ctx.arc(f.x, f.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#84cc16'
        ctx.fill()
      })

      const updatedAgents: Agent[] = []
      for (const agent of agentsRef.current) {
        let { x, y, dx, dy, energy, age, speed, type, size } = agent

        const adjustedSpeed =
          type === 'herbivore' ? speed * herbivoreSpeed : type === 'carnivore' ? speed * carnivoreSpeed : speed * 0.8

        if (type === 'herbivore' && foodRef.current.length > 0) {
          const nearestFood = foodRef.current.reduce((closest, f) => {
            const d = Math.hypot(f.x - x, f.y - y)
            return d < Math.hypot(closest.x - x, closest.y - y) ? f : closest
          })
          const dist = Math.hypot(nearestFood.x - x, nearestFood.y - y)
          if (dist < agent.vision) {
            dx += ((nearestFood.x - x) / dist) * 0.25
            dy += ((nearestFood.y - y) / dist) * 0.25
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
              dx += ((nearest.x - x) / dist) * 0.25
              dy += ((nearest.y - y) / dist) * 0.25
            }
          }
        }

        if (type === 'neutral') {
          dx += (Math.random() - 0.5) * 0.1
          dy += (Math.random() - 0.5) * 0.1
          if (Math.random() < 0.002) {
            energy += 10
          }
        }

        // Apply movement with global time scale
        x += dx * adjustedSpeed * timeScale
        y += dy * adjustedSpeed * timeScale
        dx *= 0.95
        dy *= 0.95

        // Cap velocity to avoid runaway speeds
        const maxVel = 2.5
        const spd = Math.hypot(dx, dy)
        if (spd > maxVel) {
          dx = (dx / spd) * maxVel
          dy = (dy / spd) * maxVel
        }

        if (x < 0 || x > WORLD_WIDTH) dx = -dx
        if (y < 0 || y > WORLD_HEIGHT) dy = -dy

        if (type === 'herbivore') {
          for (let i = 0; i < foodRef.current.length; i++) {
            const f = foodRef.current[i]
            const dist = Math.hypot(f.x - x, f.y - y)
            if (dist < 6) {
              energy += 30
              size = Math.min(size + 0.25, 10)
              foodRef.current.splice(i, 1)
              break
            }
          }
        }

        if (type === 'carnivore') {
          for (let i = 0; i < agentsRef.current.length; i++) {
            const prey = agentsRef.current[i]
            if (prey.type === 'herbivore') {
              const dist = Math.hypot(prey.x - x, prey.y - y)
              if (dist < 4) {
                energy += 45
                size = Math.min(size + 0.4, 12)
                agentsRef.current.splice(i, 1)
                break
              }
            }
          }
        }

        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fillStyle = type === 'carnivore' ? '#ef4444' : type === 'herbivore' ? '#22c55e' : '#3b82f6'
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()

        // Slower, more gradual energy decay
        energy -= (type === 'carnivore' ? 0.15 : type === 'herbivore' ? 0.08 : 0.06) * timeScale
        age += 0.05
        size = Math.max(4, size - 0.008 * timeScale)

        if (energy > 0 && age < 800) updatedAgents.push({ ...agent, x, y, dx, dy, energy, age, size })
      }

      agentsRef.current = updatedAgents

      if (isRunning) animationRef.current = requestAnimationFrame(update)
    }

    if (isRunning) animationRef.current = requestAnimationFrame(update)
    else if (animationRef.current) cancelAnimationFrame(animationRef.current)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [isRunning, herbivoreSpeed, carnivoreSpeed, foodSpawnRate])

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
        <button className="btn" onClick={() => (window.location.href = window.location.href)}>Reset</button>
      </div>

      <div className="controls">
        <label className="label">Tijd-schaal: {timeScale.toFixed(2)}x</label>
        <input className="slider" type="range" min={0.25} max={2} step={0.05} value={timeScale} onChange={(e) => setTimeScale(parseFloat(e.target.value))} />

        <label className="label">Herbivoor snelheid: {herbivoreSpeed.toFixed(1)}x</label>
        <input className="slider" type="range" min={0.5} max={3} step={0.1} value={herbivoreSpeed} onChange={(e) => setHerbivoreSpeed(parseFloat(e.target.value))} />

        <label className="label">Carnivoor snelheid: {carnivoreSpeed.toFixed(1)}x</label>
        <input className="slider" type="range" min={0.5} max={3} step={0.1} value={carnivoreSpeed} onChange={(e) => setCarnivoreSpeed(parseFloat(e.target.value))} />

        <label className="label">Voedsel spawn rate: {(foodSpawnRate * 100).toFixed(1)}%</label>
        <input className="slider" type="range" min={0.005} max={0.05} step={0.005} value={foodSpawnRate} onChange={(e) => setFoodSpawnRate(parseFloat(e.target.value))} />
      </div>
    </div>
  )
}


