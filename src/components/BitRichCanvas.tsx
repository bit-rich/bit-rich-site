'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

const INITIAL_ROTATION_X = Math.PI * 0.08
const INITIAL_ROTATION_Y = Math.PI * 0.15
const DEFAULT_SPEED = 0.005

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

function buildLetterObjects(obj: THREE.Object3D) {
  // Step 1: collect all vertices and edges from the loaded geometry
  const allVerts: THREE.Vector3[] = []
  const allEdges: [number, number][] = []

  obj.traverse((child) => {
    if (!(child instanceof THREE.Line) && !(child instanceof THREE.LineSegments)) return
    const geo = child.geometry as THREE.BufferGeometry
    const posAttr = geo.getAttribute('position')
    const base = allVerts.length

    for (let i = 0; i < posAttr.count; i++) {
      allVerts.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)))
    }

    const index = geo.getIndex()
    if (index) {
      for (let i = 0; i < index.count; i += 2) {
        allEdges.push([base + index.getX(i), base + index.getX(i + 1)])
      }
    } else if (child instanceof THREE.LineSegments) {
      for (let i = 0; i < posAttr.count - 1; i += 2) allEdges.push([base + i, base + i + 1])
    } else {
      for (let i = 0; i < posAttr.count - 1; i++) allEdges.push([base + i, base + i + 1])
    }
  })

  console.log(`Loaded ${allVerts.length} verts, ${allEdges.length} edges`)

  // Step 2: union-find on vertex indices
  const parent = allVerts.map((_, i) => i)
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]))
  for (const [a, b] of allEdges) parent[find(a)] = find(b)

  // Step 3: group edges by component root
  const compEdges = new Map<number, [number, number][]>()
  for (const [a, b] of allEdges) {
    const root = find(a)
    if (!compEdges.has(root)) compEdges.set(root, [])
    compEdges.get(root)!.push([a, b])
  }

  console.log(`Found ${compEdges.size} connected components`)

  // Step 4: sort components left-to-right, build geometry + material per component
  const sorted = [...compEdges.values()].sort((a, b) => {
    const minX = (edges: [number, number][]) => Math.min(...edges.map(([i]) => allVerts[i].x))
    return minX(a) - minX(b)
  })

  return sorted.map((edges) => {
    // Remap global vertex indices to local ones
    const globalToLocal = new Map<number, number>()
    const localVerts: THREE.Vector3[] = []
    for (const [a, b] of edges) {
      if (!globalToLocal.has(a)) { globalToLocal.set(a, localVerts.length); localVerts.push(allVerts[a]) }
      if (!globalToLocal.has(b)) { globalToLocal.set(b, localVerts.length); localVerts.push(allVerts[b]) }
    }

    const positions = new Float32Array(localVerts.length * 3)
    localVerts.forEach((v, i) => { positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z })

    const indices = new Uint16Array(edges.length * 2)
    edges.forEach(([a, b], i) => { indices[i * 2] = globalToLocal.get(a)!; indices[i * 2 + 1] = globalToLocal.get(b)! })

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))

    const seed = localVerts[0]
    const maxDist = localVerts.reduce((m, v) => Math.max(m, v.distanceTo(seed)), 0) || 1

    const mat = new THREE.ShaderMaterial({
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

    return { lineSegs: new THREE.LineSegments(geo, mat), mat }
  })
}

function BitRichModel({ speedsRef }: { speedsRef: React.MutableRefObject<number[]> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const initialized = useRef(false)
  const letterProgress = useRef<number[]>([])

  const letters = useMemo(() => {
    const letters = buildLetterObjects(obj)
    letterProgress.current = new Array(letters.length).fill(0)
    return letters
  }, [obj])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    letters.forEach(({ mat }, i) => {
      const speed = speedsRef.current[i] ?? DEFAULT_SPEED
      letterProgress.current[i] = Math.min(letterProgress.current[i] + speed, 1)
      mat.uniforms.uProgress.value = letterProgress.current[i]
    })
  })

  return (
    <group ref={groupRef}>
      <Center>
        <group>
          {letters.map(({ lineSegs }, i) => <primitive key={i} object={lineSegs} />)}
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
