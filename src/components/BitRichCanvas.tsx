'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

// Custom shader material that reveals lines from multiple seed points
const drawInVertexShader = `
  attribute float randomSeed;
  varying float vRandomSeed;
  varying vec3 vPosition;

  void main() {
    vRandomSeed = randomSeed;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const drawInFragmentShader = `
  uniform float uProgress;
  uniform vec3 uColor;
  uniform vec3 uSeedPoints[14];

  varying float vRandomSeed;
  varying vec3 vPosition;

  void main() {
    // Find minimum distance to any seed point
    float minDist = 1000.0;
    for (int i = 0; i < 14; i++) {
      float d = distance(vPosition, uSeedPoints[i]);
      minDist = min(minDist, d);
    }

    // Reveal based on distance from seed points
    float revealRadius = uProgress * 3.0;

    // Hard cutoff - no smoothness, just on/off based on distance
    if (minDist > revealRadius) discard;

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

    // Sample seed points directly from the model's geometry - deterministic, evenly spaced
    const allPositions: THREE.Vector3[] = []
    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        const geometry = child.geometry as THREE.BufferGeometry
        const posAttr = geometry.getAttribute('position')
        for (let i = 0; i < posAttr.count; i++) {
          allPositions.push(new THREE.Vector3(
            posAttr.getX(i),
            posAttr.getY(i),
            posAttr.getZ(i)
          ))
        }
      }
    })

    // Sort by X position to distribute evenly left-to-right across letters
    allPositions.sort((a, b) => a.x - b.x)

    // Pick 14 evenly spaced points (2 per letter in "BITRICH") - deterministic
    const seedPoints: THREE.Vector3[] = []
    const numSeeds = 14
    if (allPositions.length > 0) {
      const step = allPositions.length / numSeeds
      for (let i = 0; i < numSeeds; i++) {
        const idx = Math.floor(i * step)
        seedPoints.push(allPositions[idx])
      }
    }
    // Pad to 14 if needed
    while (seedPoints.length < 14) {
      seedPoints.push(new THREE.Vector3(0, 0, 0))
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const geometry = child.geometry as THREE.BufferGeometry

        // Add random seed attribute for per-vertex variation
        const positionAttr = geometry.getAttribute('position')
        const randomSeeds = new Float32Array(positionAttr.count)
        for (let i = 0; i < positionAttr.count; i++) {
          randomSeeds[i] = Math.random()
        }
        geometry.setAttribute('randomSeed', new THREE.BufferAttribute(randomSeeds, 1))

        const material = new THREE.ShaderMaterial({
          uniforms: {
            uProgress: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) },
            uSeedPoints: { value: seedPoints },
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

        // Add random seed attribute
        const positionAttr = edges.getAttribute('position')
        const randomSeeds = new Float32Array(positionAttr.count)
        for (let i = 0; i < positionAttr.count; i++) {
          randomSeeds[i] = Math.random()
        }
        edges.setAttribute('randomSeed', new THREE.BufferAttribute(randomSeeds, 1))

        const material = new THREE.ShaderMaterial({
          uniforms: {
            uProgress: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) },
            uSeedPoints: { value: seedPoints },
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
