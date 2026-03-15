'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo, useState } from 'react'
import * as THREE from 'three'

const LETTERS = ['B', 'I', 'T', 'R', 'I', 'C', 'H']
const NUM_LETTERS = LETTERS.length
const INITIAL_ROTATION_X = Math.PI * 0.08
const INITIAL_ROTATION_Y = Math.PI * 0.15
const DEFAULT_SPEED = 0.0008

const drawInVertexShader = `
  attribute float normalizedDist;
  varying float vNormalizedDist;

  void main() {
    vNormalizedDist = normalizedDist;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const drawInFragmentShader = `
  uniform float uProgress;
  uniform vec3 uColor;

  varying float vNormalizedDist;

  void main() {
    if (vNormalizedDist > uProgress) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`

function BitRichModel({ speedsRef }: { speedsRef: React.MutableRefObject<number[]> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const letterProgress = useRef<number[]>(new Array(NUM_LETTERS).fill(0))
  const initialized = useRef(false)

  // letterMaterials[i] = all ShaderMaterials belonging to letter i
  const letterMaterials = useMemo(() => {
    const result: THREE.ShaderMaterial[][] = Array.from({ length: NUM_LETTERS }, () => [])

    // Collect all vertex positions and X bounds
    const allPositions: THREE.Vector3[] = []
    let minX = Infinity, maxX = -Infinity
    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.getX(i)
          allPositions.push(new THREE.Vector3(x, posAttr.getY(i), posAttr.getZ(i)))
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
        }
      }
    })

    const letterWidth = (maxX - minX) / NUM_LETTERS

    // Build per-letter regions with centroid seed
    const regions = Array.from({ length: NUM_LETTERS }, (_, i) => {
      const rMinX = minX + i * letterWidth
      const rMaxX = rMinX + letterWidth
      const isLast = i === NUM_LETTERS - 1
      const verts = allPositions.filter(p => p.x >= rMinX && (isLast ? p.x <= rMaxX : p.x < rMaxX))

      let seed: THREE.Vector3
      if (verts.length > 0) {
        const sum = verts.reduce((acc, v) => acc.add(v.clone()), new THREE.Vector3())
        seed = sum.divideScalar(verts.length)
      } else {
        seed = new THREE.Vector3(rMinX + letterWidth / 2, 0, 0)
      }

      const maxDist = verts.reduce((m, v) => Math.max(m, v.distanceTo(seed)), 0) || 1
      return { minX: rMinX, maxX: rMaxX, seed, maxDist, isLast }
    })

    // Assign vertex x to letter index
    const getLetterIdx = (x: number) => {
      for (let i = 0; i < NUM_LETTERS; i++) {
        const r = regions[i]
        if (x >= r.minX && (r.isLast ? x <= r.maxX : x < r.maxX)) return i
      }
      return NUM_LETTERS - 1
    }

    // Compute normalizedDist per vertex; assign geometry to letter by centroid
    const prepareGeometry = (geometry: THREE.BufferGeometry): number => {
      const posAttr = geometry.getAttribute('position')
      let centroidX = 0
      for (let i = 0; i < posAttr.count; i++) centroidX += posAttr.getX(i)
      centroidX /= posAttr.count
      const letterIdx = getLetterIdx(centroidX)
      const region = regions[letterIdx]

      const normalizedDists = new Float32Array(posAttr.count)
      for (let i = 0; i < posAttr.count; i++) {
        const pos = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
        normalizedDists[i] = pos.distanceTo(region.seed) / region.maxDist
      }
      geometry.setAttribute('normalizedDist', new THREE.BufferAttribute(normalizedDists, 1))
      return letterIdx
    }

    const makeMaterial = () => new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: drawInVertexShader,
      fragmentShader: drawInFragmentShader,
      transparent: true,
      depthWrite: false,
    })

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const idx = prepareGeometry(child.geometry as THREE.BufferGeometry)
        const mat = makeMaterial()
        child.material = mat
        result[idx].push(mat)
      } else if (child instanceof THREE.Mesh) {
        const edges = new THREE.EdgesGeometry(child.geometry)
        const idx = prepareGeometry(edges)
        const mat = makeMaterial()
        const lineSegs = new THREE.LineSegments(edges, mat)
        child.parent?.add(lineSegs)
        child.visible = false
        result[idx].push(mat)
      }
    })

    return result
  }, [obj])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    for (let i = 0; i < NUM_LETTERS; i++) {
      letterProgress.current[i] = Math.min(letterProgress.current[i] + speedsRef.current[i], 1)
      const eased = 1 - Math.pow(1 - letterProgress.current[i], 2)
      for (const mat of letterMaterials[i]) {
        mat.uniforms.uProgress.value = eased
      }
    }
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
  const [speeds, setSpeeds] = useState<number[]>(new Array(NUM_LETTERS).fill(DEFAULT_SPEED))
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
        {LETTERS.map((letter, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-3 text-center">{letter}</span>
            <input
              type="range"
              min={0}
              max={0.005}
              step={0.0001}
              value={speeds[i]}
              onChange={e => {
                const next = [...speeds]
                next[i] = parseFloat(e.target.value)
                setSpeeds(next)
              }}
              className="w-40"
            />
            <span className="w-14 text-right tabular-nums">{speeds[i].toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
