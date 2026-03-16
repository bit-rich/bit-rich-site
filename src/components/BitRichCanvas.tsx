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
  uniform vec3 uColor;
  varying vec3 vPosition;
  void main() {
    if (distance(vPosition, uSeed) / uMaxDist > uProgress) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`

function BitRichModel({ speedsRef }: { speedsRef: React.MutableRefObject<number[]> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const letterProgress = useRef<number[]>(new Array(NUM_LETTERS).fill(0))
  const initialized = useRef(false)

  // One material per letter, shared across all meshes in that letter
  const letterMaterials = useMemo(() => {
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

    // One material per letter with seed + maxDist uniforms
    const materials = Array.from({ length: NUM_LETTERS }, (_, i) => {
      const rMinX = minX + i * letterWidth
      const rMaxX = rMinX + letterWidth
      const isLast = i === NUM_LETTERS - 1
      const verts = allPositions.filter(p => p.x >= rMinX && (isLast ? p.x <= rMaxX : p.x < rMaxX))

      let seed = new THREE.Vector3(rMinX + letterWidth / 2, 0, 0)
      if (verts.length > 0) {
        const sum = verts.reduce((acc, v) => acc.add(v.clone()), new THREE.Vector3())
        seed = sum.divideScalar(verts.length)
      }

      const maxDist = verts.reduce((m, v) => Math.max(m, v.distanceTo(seed)), 0) || 1

      return new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uSeed: { value: seed },
          uMaxDist: { value: maxDist },
          uColor: { value: new THREE.Color(0xffffff) },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      })
    })

    // Assign each mesh to a letter by its centroid X
    const getLetterIdx = (centroidX: number) => {
      const i = Math.floor((centroidX - minX) / letterWidth)
      return Math.max(0, Math.min(NUM_LETTERS - 1, i))
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
        let cx = 0
        for (let i = 0; i < posAttr.count; i++) cx += posAttr.getX(i)
        child.material = materials[getLetterIdx(cx / posAttr.count)]
      } else if (child instanceof THREE.Mesh) {
        const edges = new THREE.EdgesGeometry(child.geometry)
        const posAttr = edges.getAttribute('position')
        let cx = 0
        for (let i = 0; i < posAttr.count; i++) cx += posAttr.getX(i)
        const lineSegs = new THREE.LineSegments(edges, materials[getLetterIdx(cx / posAttr.count)])
        child.parent?.add(lineSegs)
        child.visible = false
      }
    })

    return materials
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
      letterMaterials[i].uniforms.uProgress.value = eased
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
