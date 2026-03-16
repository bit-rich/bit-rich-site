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

function BitRichModel({ speedRef }: { speedRef: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const progress = useRef(0)
  const initialized = useRef(false)

  const material = useMemo(() => {
    let seed: THREE.Vector3 | null = null
    let maxDist = 0

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        const posAttr = (child.geometry as THREE.BufferGeometry).getAttribute('position')
        for (let i = 0; i < posAttr.count; i++) {
          const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
          if (!seed) seed = v.clone()
          maxDist = Math.max(maxDist, v.distanceTo(seed))
        }
      }
    })

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uSeed: { value: seed ?? new THREE.Vector3() },
        uMaxDist: { value: maxDist || 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        child.material = mat
      } else if (child instanceof THREE.Mesh) {
        const lineSegs = new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry), mat)
        child.parent?.add(lineSegs)
        child.visible = false
      }
    })

    return mat
  }, [obj])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    progress.current = Math.min(progress.current + speedRef.current, 1)
    material.uniforms.uProgress.value = progress.current
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
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const speedRef = useRef(speed)
  speedRef.current = speed

  return (
    <div className="w-screen h-screen relative">
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.6} />
        <BitRichModel speedRef={speedRef} />
        <OrbitControls enableZoom={false} enablePan={false} />
      </Canvas>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/70 px-4 py-3 rounded text-white text-xs font-mono">
        <span>speed</span>
        <input
          type="range"
          min={0}
          max={0.005}
          step={0.0001}
          value={speed}
          onChange={e => setSpeed(parseFloat(e.target.value))}
          className="w-40"
        />
        <span className="w-14 text-right tabular-nums">{speed.toFixed(4)}</span>
      </div>
    </div>
  )
}
