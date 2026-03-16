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

type LetterRegion = { minX: number; maxX: number; seed: THREE.Vector3; maxDist: number; mat: THREE.ShaderMaterial }

function buildLetterRegions(allPositions: THREE.Vector3[]): LetterRegion[] {
  // Sort all X values and find gaps between letters
  const sortedX = allPositions.map(p => p.x).sort((a, b) => a - b)

  const gaps: { pos: number; size: number }[] = []
  for (let i = 1; i < sortedX.length; i++) {
    const size = sortedX[i] - sortedX[i - 1]
    if (size > 0) gaps.push({ pos: (sortedX[i] + sortedX[i - 1]) / 2, size })
  }

  // Letter gaps are much larger than within-letter gaps
  const meanGap = gaps.reduce((s, g) => s + g.size, 0) / gaps.length
  const separators = gaps
    .filter(g => g.size > meanGap * 5)
    .map(g => g.pos)
    .sort((a, b) => a - b)

  // Build X ranges for each letter
  const bounds = [
    -Infinity,
    ...separators,
    Infinity,
  ]

  return bounds.slice(0, -1).map((minX, i) => {
    const maxX = bounds[i + 1]
    const verts = allPositions.filter(p => p.x > minX && p.x <= maxX)

    // First vertex as seed
    const seed = verts[0]?.clone() ?? new THREE.Vector3()
    const maxDist = verts.reduce((m, v) => Math.max(m, v.distanceTo(seed)), 0) || 1

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uSeed: { value: seed },
        uMaxDist: { value: maxDist },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })

    return { minX, maxX, seed, maxDist, mat }
  })
}

function BitRichModel({ speedsRef }: { speedsRef: React.MutableRefObject<number[]> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const initialized = useRef(false)
  const letterProgress = useRef<number[]>([])

  const regions = useMemo(() => {
    // Collect all vertex positions
    const allPositions: THREE.Vector3[] = []
    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
        for (let i = 0; i < posAttr.count; i++) {
          allPositions.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)))
        }
      }
    })

    const regions = buildLetterRegions(allPositions)
    letterProgress.current = new Array(regions.length).fill(0)

    const getMat = (centroidX: number) => {
      const r = regions.find(r => centroidX > r.minX && centroidX <= r.maxX)
      return r?.mat ?? regions[regions.length - 1].mat
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
        let cx = 0
        for (let i = 0; i < posAttr.count; i++) cx += posAttr.getX(i)
        child.material = getMat(cx / posAttr.count)
      } else if (child instanceof THREE.Mesh) {
        const edges = new THREE.EdgesGeometry(child.geometry)
        const posAttr = edges.getAttribute('position')
        let cx = 0
        for (let i = 0; i < posAttr.count; i++) cx += posAttr.getX(i)
        const lineSegs = new THREE.LineSegments(edges, getMat(cx / posAttr.count))
        child.parent?.add(lineSegs)
        child.visible = false
      }
    })

    return regions
  }, [obj])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    regions.forEach((r, i) => {
      const speed = speedsRef.current[i] ?? speedsRef.current[0]
      letterProgress.current[i] = Math.min(letterProgress.current[i] + speed, 1)
      r.mat.uniforms.uProgress.value = letterProgress.current[i]
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
  const [speeds, setSpeeds] = useState<number[]>(new Array(8).fill(DEFAULT_SPEED))
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
              type="range"
              min={0}
              max={0.005}
              step={0.0001}
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
