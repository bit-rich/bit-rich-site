'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

function BitRichModel() {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const drawProgress = useRef(0)
  const animationComplete = useRef(false)

  // Create line materials with dash animation for the "draw in" effect
  const lineMaterials = useMemo(() => {
    const materials: THREE.LineDashedMaterial[] = []

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        // Compute line distances for dashing
        child.computeLineDistances()

        // Get total length of the line
        const geometry = child.geometry as THREE.BufferGeometry
        const lineDistances = geometry.getAttribute('lineDistance')
        const totalLength = lineDistances ? lineDistances.array[lineDistances.count - 1] as number : 100

        // Create dashed material
        const material = new THREE.LineDashedMaterial({
          color: 0xffffff,
          dashSize: totalLength,
          gapSize: totalLength,
          scale: 1,
        })

        // Store original material info and total length
        ;(material as THREE.LineDashedMaterial & { totalLength: number }).totalLength = totalLength

        child.material = material
        materials.push(material)
      } else if (child instanceof THREE.Mesh) {
        // Convert meshes to wireframe with dashed lines
        const edges = new THREE.EdgesGeometry(child.geometry)
        const lineMat = new THREE.LineDashedMaterial({
          color: 0xffffff,
          dashSize: 0,
          gapSize: 1000,
          scale: 1,
        })
        const lineSegments = new THREE.LineSegments(edges, lineMat)
        lineSegments.computeLineDistances()

        // Get total length
        const lineDistances = lineSegments.geometry.getAttribute('lineDistance')
        const totalLength = lineDistances ? lineDistances.array[lineDistances.count - 1] as number : 100
        ;(lineMat as THREE.LineDashedMaterial & { totalLength: number }).totalLength = totalLength
        lineMat.dashSize = totalLength
        lineMat.gapSize = totalLength

        child.parent?.add(lineSegments)
        child.visible = false
        materials.push(lineMat)
      }
    })

    return materials
  }, [obj])

  useFrame(({ mouse }) => {
    const g = groupRef.current
    if (!g) return

    // Animate the draw-in effect over 2 seconds
    if (!animationComplete.current) {
      drawProgress.current = Math.min(drawProgress.current + 0.008, 1)

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - drawProgress.current, 3)

      lineMaterials.forEach((mat) => {
        const totalLength = (mat as THREE.LineDashedMaterial & { totalLength: number }).totalLength || 100
        mat.dashSize = totalLength * eased
        mat.gapSize = totalLength * (1 - eased)
      })

      if (drawProgress.current >= 1) {
        animationComplete.current = true
      }
    }

    const targetX = mouse.y * Math.PI * 0.1
    const targetY = -mouse.x * Math.PI * 0.1

    // Lerp to target
    g.rotation.x += (targetX - g.rotation.x) * 0.05
    g.rotation.y += (targetY - g.rotation.y) * 0.05

    // Clamp rotations
    g.rotation.x = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, g.rotation.x))
    g.rotation.y = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, g.rotation.y))
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

