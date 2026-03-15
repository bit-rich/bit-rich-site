'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

// Custom shader material that reveals lines from multiple seed points
const drawInVertexShader = `
  attribute float revealTime;
  varying float vRevealTime;
  varying vec3 vPosition;

  void main() {
    vRevealTime = revealTime;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const drawInFragmentShader = `
  uniform float uProgress;
  uniform vec3 uColor;

  varying float vRevealTime;
  varying vec3 vPosition;

  void main() {
    // Each vertex has a deterministic reveal time - show if progress >= that time
    if (uProgress < vRevealTime) discard;

    gl_FragColor = vec4(uColor, 1.0);
  }
`

// Initial rotation to show 3D depth
const INITIAL_ROTATION_X = Math.PI * 0.08
const INITIAL_ROTATION_Y = Math.PI * 0.15

function BitRichModel() {
  const groupRef = useRef<THREE.Group>(null)
  const obj = useLoader(OBJLoader, '/bitrich_wireframe.obj') as THREE.Object3D
  const drawProgress = useRef(0)
  const animationComplete = useRef(false)
  const initialized = useRef(false)

  // Create shader materials for the draw-in effect
  const shaderMaterials = useMemo(() => {
    const materials: THREE.ShaderMaterial[] = []

    // Deterministic hash function for consistent reveal times based on position
    const hash = (x: number, y: number, z: number): number => {
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
      return h - Math.floor(h)
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const geometry = child.geometry as THREE.BufferGeometry
        const positionAttr = geometry.getAttribute('position')

        // Create deterministic reveal times based on vertex position
        const revealTimes = new Float32Array(positionAttr.count)
        for (let i = 0; i < positionAttr.count; i++) {
          const x = positionAttr.getX(i)
          const y = positionAttr.getY(i)
          const z = positionAttr.getZ(i)
          revealTimes[i] = hash(x, y, z)
        }
        geometry.setAttribute('revealTime', new THREE.BufferAttribute(revealTimes, 1))

        const material = new THREE.ShaderMaterial({
          uniforms: {
            uProgress: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) },
          },
          vertexShader: drawInVertexShader,
          fragmentShader: drawInFragmentShader,
          transparent: true,
          depthWrite: false,
        })

        child.material = material
        materials.push(material)
      } else if (child instanceof THREE.Mesh) {
        // Convert meshes to wireframe
        const edges = new THREE.EdgesGeometry(child.geometry)
        const positionAttr = edges.getAttribute('position')

        // Create deterministic reveal times based on vertex position
        const revealTimes = new Float32Array(positionAttr.count)
        for (let i = 0; i < positionAttr.count; i++) {
          const x = positionAttr.getX(i)
          const y = positionAttr.getY(i)
          const z = positionAttr.getZ(i)
          revealTimes[i] = hash(x, y, z)
        }
        edges.setAttribute('revealTime', new THREE.BufferAttribute(revealTimes, 1))

        const material = new THREE.ShaderMaterial({
          uniforms: {
            uProgress: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) },
          },
          vertexShader: drawInVertexShader,
          fragmentShader: drawInFragmentShader,
          transparent: true,
          depthWrite: false,
        })

        const lineSegments = new THREE.LineSegments(edges, material)
        child.parent?.add(lineSegments)
        child.visible = false
        materials.push(material)
      }
    })

    return materials
  }, [obj])

  useFrame(({ mouse }) => {
    const g = groupRef.current
    if (!g) return

    // Set initial rotation on first frame
    if (!initialized.current) {
      g.rotation.x = INITIAL_ROTATION_X
      g.rotation.y = INITIAL_ROTATION_Y
      initialized.current = true
    }

    // Animate the draw-in effect - much slower (~8 seconds)
    if (!animationComplete.current) {
      drawProgress.current = Math.min(drawProgress.current + 0.0008, 1)

      // Ease out for smooth deceleration
      const eased = 1 - Math.pow(1 - drawProgress.current, 2)

      shaderMaterials.forEach((mat) => {
        mat.uniforms.uProgress.value = eased
      })

      if (drawProgress.current >= 1) {
        animationComplete.current = true
      }
    }

    // Mouse offset from initial rotation
    const targetX = INITIAL_ROTATION_X + mouse.y * Math.PI * 0.1
    const targetY = INITIAL_ROTATION_Y - mouse.x * Math.PI * 0.1

    // Lerp to target
    g.rotation.x += (targetX - g.rotation.x) * 0.05
    g.rotation.y += (targetY - g.rotation.y) * 0.05

    // Clamp rotations around the initial angle
    g.rotation.x = Math.max(INITIAL_ROTATION_X - Math.PI / 6, Math.min(INITIAL_ROTATION_X + Math.PI / 6, g.rotation.x))
    g.rotation.y = Math.max(INITIAL_ROTATION_Y - Math.PI / 4, Math.min(INITIAL_ROTATION_Y + Math.PI / 4, g.rotation.y))
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
