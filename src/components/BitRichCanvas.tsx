'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef } from 'react'
import * as THREE from 'three'

function BitRichModel() {
  const spinRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj')

  useFrame(({ mouse }) => {
    if (spinRef.current) {
      spinRef.current.rotation.y = mouse.x * Math.PI * 0.2     // left/right = good
      spinRef.current.rotation.x = -mouse.y * Math.PI * 0.1    // up/down = FLIPPED ✔️
    }
  })

  return (
    <group ref={spinRef}>
      {/* Center auto-repositions *and* auto-scales to fit a 1-unit box */}
      <Center>
        <primitive object={obj} />
      </Center>
    </group>
  )
}

export default function BitRichCanvas() {
  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.6} />
        <BitRichModel />
        <OrbitControls enableZoom={false} />
      </Canvas>
    </div>
  )
}

