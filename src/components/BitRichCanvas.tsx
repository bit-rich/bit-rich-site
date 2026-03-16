'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

const INITIAL_ROTATION_X = Math.PI * 0.08
const INITIAL_ROTATION_Y = Math.PI * 0.15
const DEFAULT_SPEED = 0.0025
const DEPTH_START = 0.985

const vertexShader = `
  attribute float aRevealStart;
  attribute float aEdgeSlot;
  attribute float aLocalT;
  varying float vRevealStart;
  varying float vEdgeSlot;
  varying float vLocalT;
  uniform float uDepthProgress;
  void main() {
    vRevealStart = aRevealStart;
    vEdgeSlot = aEdgeSlot;
    vLocalT = aLocalT;
    vec3 pos = vec3(position.xy, position.z * uDepthProgress);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const fragmentShader = `
  uniform float uProgress;
  varying float vRevealStart;
  varying float vEdgeSlot;
  varying float vLocalT;
  void main() {
    float edgeProgress = (uProgress - vRevealStart) / vEdgeSlot;
    if (edgeProgress <= 0.0) discard;
    if (vLocalT > min(edgeProgress, 1.0)) discard;
    gl_FragColor = vec4(1.0);
  }
`

const pkey = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`

// Smooth ease in-out
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

// Glow texture for the tip point
function makeGlowTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255, 255, 220, 1)')
  g.addColorStop(0.3, 'rgba(255, 220, 120, 0.6)')
  g.addColorStop(1, 'rgba(255, 180, 60, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

type EdgeTip = { near: THREE.Vector3; far: THREE.Vector3; revealStart: number; slot: number }

function buildLetterObjects(obj: THREE.Object3D) {
  const parent = new Map<string, string>()
  const posMap = new Map<string, THREE.Vector3>()
  const allEdges: [string, string][] = []

  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k)
    if (parent.get(k) !== k) parent.set(k, find(parent.get(k)!))
    return parent.get(k)!
  }
  const union = (a: string, b: string) => parent.set(find(a), find(b))

  obj.traverse((child) => {
    if (!(child instanceof THREE.Line) && !(child instanceof THREE.LineSegments)) return
    const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
    const keys: string[] = []
    for (let i = 0; i < posAttr.count; i++) {
      const k = pkey(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      keys.push(k)
      posMap.set(k, new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)))
    }
    const step = keys.length === 2 ? 1 : (child instanceof THREE.LineSegments ? 2 : 1)
    for (let i = 0; i < keys.length - 1; i += step) {
      allEdges.push([keys[i], keys[i + 1]])
      union(keys[i], keys[i + 1])
    }
  })

  const compEdges = new Map<string, [string, string][]>()
  for (const [a, b] of allEdges) {
    const root = find(a)
    if (!compEdges.has(root)) compEdges.set(root, [])
    compEdges.get(root)!.push([a, b])
  }

  const sorted = [...compEdges.values()].sort((a, b) => {
    const minX = (edges: [string, string][]) => Math.min(...edges.map(([k]) => posMap.get(k)!.x))
    return minX(a) - minX(b)
  })

  return sorted.map((edges) => {
    const adj = new Map<string, [string, string][]>()
    for (const [a, b] of edges) {
      if (!adj.has(a)) adj.set(a, [])
      if (!adj.has(b)) adj.set(b, [])
      adj.get(a)!.push([a, b])
      adj.get(b)!.push([b, a])
    }

    const seedKey = edges[0][0]
    const visitedVerts = new Set<string>([seedKey])
    const visitedEdges = new Set<string>()
    const edgeKey = (a: string, b: string) => [a, b].sort().join('|')
    const sortedEdges: [string, string][] = []
    const stack = [seedKey]
    while (stack.length) {
      const cur = stack[stack.length - 1]
      const unvisited = adj.get(cur)?.find(([, nb]) => !visitedVerts.has(nb))
      if (unvisited) {
        const [, nb] = unvisited
        visitedVerts.add(nb)
        visitedEdges.add(edgeKey(cur, nb))
        sortedEdges.push([cur, nb])
        stack.push(nb)
      } else {
        stack.pop()
      }
    }
    for (const [a, b] of edges) {
      if (!visitedEdges.has(edgeKey(a, b))) sortedEdges.push([a, b])
    }

    const seed = posMap.get(seedKey)!
    const zOf = (k: string) => posMap.get(k)!.z
    const isFront = ([a, b]: [string, string]) => zOf(a) < 0.1 && zOf(b) < 0.1
    const isBack  = ([a, b]: [string, string]) => zOf(a) > 0.1 && zOf(b) > 0.1
    const isDepth = ([a, b]: [string, string]) => !isFront([a,b]) && !isBack([a,b])

    const frontEdges = sortedEdges.filter(isFront)
    const backEdges  = sortedEdges.filter(isBack)
    const depthEdges = sortedEdges.filter(isDepth)

    // Front edges animate 0→DEPTH_START, back+depth pop in together at DEPTH_START
    const faceTotal = frontEdges.reduce((s, [a, b]) => s + posMap.get(a)!.distanceTo(posMap.get(b)!), 0)
    const depthTotal = [...backEdges, ...depthEdges].reduce((s, [a, b]) => s + posMap.get(a)!.distanceTo(posMap.get(b)!), 0)

    const positions: number[] = []
    const revealStarts: number[] = []
    const edgeSlots: number[] = []
    const localTs: number[] = []
    const tipData: EdgeTip[] = []
    let cursor = 0

    const addEdge = (a: string, b: string, revealStart: number, slot: number) => {
      const va = posMap.get(a)!, vb = posMap.get(b)!
      const aIsNear = va.distanceTo(seed) <= vb.distanceTo(seed)
      const [near, far] = aIsNear ? [va, vb] : [vb, va]
      positions.push(near.x, near.y, near.z, far.x, far.y, far.z)
      revealStarts.push(revealStart, revealStart)
      edgeSlots.push(slot, slot)
      localTs.push(0, 1)
      tipData.push({ near, far, revealStart, slot })
    }

    frontEdges.forEach(([a, b]) => {
      const slot = (posMap.get(a)!.distanceTo(posMap.get(b)!) / faceTotal) * DEPTH_START
      addEdge(a, b, cursor, slot)
      cursor += slot
    })

    // back face + depth edges all pop in together at DEPTH_START
    ;[...backEdges, ...depthEdges].forEach(([a, b]) => addEdge(a, b, DEPTH_START, 1 - DEPTH_START))

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    geo.setAttribute('aRevealStart', new THREE.BufferAttribute(new Float32Array(revealStarts), 1))
    geo.setAttribute('aEdgeSlot', new THREE.BufferAttribute(new Float32Array(edgeSlots), 1))
    geo.setAttribute('aLocalT', new THREE.BufferAttribute(new Float32Array(localTs), 1))

    const mat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uDepthProgress: { value: 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })

    // Given raw progress (0-1), return the 3D tip position
    const getTip = (progress: number): THREE.Vector3 => {
      for (const { near, far, revealStart, slot } of tipData) {
        if (progress <= revealStart + slot) {
          const t = Math.min((progress - revealStart) / slot, 1)
          return near.clone().lerp(far, t)
        }
      }
      return tipData[tipData.length - 1]?.far.clone() ?? new THREE.Vector3()
    }

    return { lineSegs: new THREE.LineSegments(geo, mat), mat, getTip }
  })
}

function BitRichModel({ speedsRef }: { speedsRef: React.MutableRefObject<number[]> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const initialized = useRef(false)
  const rawProgress = useRef<number[]>([])

  const { letters, tipPoints, tipPositions } = useMemo(() => {
    const letters = buildLetterObjects(obj)
    rawProgress.current = new Array(letters.length).fill(0)

    // One point per letter for the glowing tip
    const tipPositions = new Float32Array(letters.length * 3)
    const tipGeo = new THREE.BufferGeometry()
    tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPositions, 3))

    const tipMat = new THREE.PointsMaterial({
      size: 0.03,
      map: makeGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    return { letters, tipPoints: new THREE.Points(tipGeo, tipMat), tipPositions }
  }, [obj])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    letters.forEach(({ mat, getTip }, i) => {
      const speed = speedsRef.current[i] ?? DEFAULT_SPEED
      rawProgress.current[i] = Math.min(rawProgress.current[i] + speed, 1)
      const eased = easeInOut(rawProgress.current[i])
      mat.uniforms.uProgress.value = eased
      mat.uniforms.uDepthProgress.value = Math.min(Math.max((eased - DEPTH_START) / (1 - DEPTH_START), 0), 1)

      // Update tip position
      const tip = getTip(eased)
      tipPositions[i * 3] = tip.x
      tipPositions[i * 3 + 1] = tip.y
      tipPositions[i * 3 + 2] = tip.z
    })

    ;(tipPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      <Center>
        <group>
          {letters.map(({ lineSegs }, i) => <primitive key={i} object={lineSegs} />)}
          <primitive object={tipPoints} />
        </group>
      </Center>
    </group>
  )
}

export default function BitRichCanvas() {
  const speedsRef = useRef(new Array(10).fill(DEFAULT_SPEED))

  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.6} />
        <BitRichModel speedsRef={speedsRef} />
        <OrbitControls enableZoom={false} enablePan={false} />
      </Canvas>
    </div>
  )
}
