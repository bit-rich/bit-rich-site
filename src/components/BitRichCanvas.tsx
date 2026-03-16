'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo, useState } from 'react'
import * as THREE from 'three'

const INITIAL_ROTATION_X = Math.PI * 0.08
const INITIAL_ROTATION_Y = Math.PI * 0.15
const DEFAULT_SPEED = 0.0008

const vertexShader = `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uProgress;
  uniform vec3 uSeed;
  uniform float uMaxDist;
  varying vec3 vPosition;
  void main() {
    if (distance(vPosition, uSeed) / uMaxDist > uProgress) discard;
    gl_FragColor = vec4(1.0);
  }
`

// Union-Find to group vertices into connected components (one per letter)
function buildComponents(obj: THREE.Object3D) {
  const parent = new Map<string, string>()

  const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`

  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k)
    if (parent.get(k) !== k) parent.set(k, find(parent.get(k)!))
    return parent.get(k)!
  }

  const union = (a: string, b: string) => parent.set(find(a), find(b))

  const positions = new Map<string, THREE.Vector3>()

  obj.traverse((child) => {
    if (!(child instanceof THREE.Line) && !(child instanceof THREE.LineSegments)) return
    const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')

    for (let i = 0; i < posAttr.count; i++) {
      const k = key(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      positions.set(k, new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)))
    }

    // Line = polyline (edges between consecutive vertices)
    // LineSegments = discrete pairs
    const step = child instanceof THREE.LineSegments ? 2 : 1
    for (let i = 0; i < posAttr.count - 1; i += step) {
      union(
        key(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)),
        key(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1)),
      )
    }
  })

  // Group vertices by component root
  const components = new Map<string, THREE.Vector3[]>()
  for (const [k, v] of positions) {
    const root = find(k)
    if (!components.has(root)) components.set(root, [])
    components.get(root)!.push(v)
  }

  // Sort components left-to-right by min X so sliders match letter order
  return [...components.values()].sort((a, b) => {
    const minX = (verts: THREE.Vector3[]) => Math.min(...verts.map(v => v.x))
    return minX(a) - minX(b)
  })
}

function BitRichModel({ speedsRef }: { speedsRef: React.MutableRefObject<number[]> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const initialized = useRef(false)
  const letterProgress = useRef<number[]>([])

  const { materials, numLetters } = useMemo(() => {
    const components = buildComponents(obj)

    // One material per connected component (letter/dash)
    const materials = components.map((verts) => {
      const seed = verts[0]
      const maxDist = verts.reduce((m, v) => Math.max(m, v.distanceTo(seed)), 0) || 1
      return new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uSeed: { value: seed.clone() },
          uMaxDist: { value: maxDist },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      })
    })

    letterProgress.current = new Array(materials.length).fill(0)

    // Build lookup: vertex key → material index
    const keyToMat = new Map<string, THREE.ShaderMaterial>()
    const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    components.forEach((verts, i) => {
      for (const v of verts) keyToMat.set(key(v.x, v.y, v.z), materials[i])
    })

    // Assign each geometry's material by its first vertex
    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
        const k = key(posAttr.getX(0), posAttr.getY(0), posAttr.getZ(0))
        child.material = keyToMat.get(k) ?? materials[0]
      }
    })

    return { materials, numLetters: materials.length }
  }, [obj])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    materials.forEach((mat, i) => {
      const speed = speedsRef.current[i] ?? DEFAULT_SPEED
      letterProgress.current[i] = Math.min(letterProgress.current[i] + speed, 1)
      mat.uniforms.uProgress.value = letterProgress.current[i]
    })
  })

  return (
    <group ref={groupRef}>
      <Center>
        <primitive object={obj} />
      </Center>
    </group>
  )
}

export default function BitRichCanvas() {
  const [speeds, setSpeeds] = useState<number[]>(new Array(10).fill(DEFAULT_SPEED))
  const speedsRef = useRef(speeds)
  speedsRef.current = speeds

  return (
    <div className="w-screen h-screen relative">
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.6} />
        <BitRichModel speedsRef={speedsRef} />
        <OrbitControls enableZoom={false} enablePan={false} />
      </Canvas>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-1.5 bg-black/70 px-4 py-3 rounded text-white text-xs font-mono">
        {speeds.map((spd, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-4 text-center">{i + 1}</span>
            <input
              type="range" min={0} max={0.005} step={0.0001}
              value={spd}
              onChange={e => {
                const next = [...speeds]
                next[i] = parseFloat(e.target.value)
                setSpeeds(next)
              }}
              className="w-40"
            />
            <span className="w-14 text-right tabular-nums">{spd.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
