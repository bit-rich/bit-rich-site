'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

// Custom shader material that reveals lines from multiple seed points
const drawInVertexShader = `
  varying vec3 vPosition;

  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const drawInFragmentShader = `
  uniform float uProgress;
  uniform vec3 uColor;
  uniform vec3 uSeedPoints[14];

  varying vec3 vPosition;

  void main() {
    // Find minimum distance to any seed point
    float minDist = 1000.0;
    for (int i = 0; i < 14; i++) {
      float d = distance(vPosition, uSeedPoints[i]);
      minDist = min(minDist, d);
    }

    // Reveal based on distance from seed points - lines "draw" outward
    float revealRadius = uProgress * 3.0;

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

    // First pass: collect all positions and find bounds
    const allPositions: THREE.Vector3[] = []
    let minX = Infinity, maxX = -Infinity
    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        const geometry = child.geometry as THREE.BufferGeometry
        const posAttr = geometry.getAttribute('position')
        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.getX(i)
          const y = posAttr.getY(i)
          const z = posAttr.getZ(i)
          allPositions.push(new THREE.Vector3(x, y, z))
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
        }
      }
    })

    // 7 letters in "BITRICH" - place 2 seed points per letter (14 total)
    const numLetters = 7
    const letterWidth = (maxX - minX) / numLetters
    const seedPoints: THREE.Vector3[] = []

    // For each letter region, find vertices in that region and pick 2 evenly spaced
    for (let letter = 0; letter < numLetters; letter++) {
      const letterMinX = minX + letter * letterWidth
      const letterMaxX = letterMinX + letterWidth

      // Get vertices in this letter's X range
      const letterVerts = allPositions.filter(p => p.x >= letterMinX && p.x < letterMaxX)

      if (letterVerts.length >= 2) {
        // Sort by Y to get good vertical distribution
        letterVerts.sort((a, b) => a.y - b.y)
        // Pick one from bottom third, one from top third
        const idx1 = Math.floor(letterVerts.length * 0.25)
        const idx2 = Math.floor(letterVerts.length * 0.75)
        seedPoints.push(letterVerts[idx1])
        seedPoints.push(letterVerts[idx2])
      } else if (letterVerts.length === 1) {
        seedPoints.push(letterVerts[0])
        seedPoints.push(letterVerts[0])
      } else {
        // Fallback
        seedPoints.push(new THREE.Vector3(letterMinX + letterWidth / 2, 0, 0))
        seedPoints.push(new THREE.Vector3(letterMinX + letterWidth / 2, 0, 0))
      }
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        const geometry = child.geometry as THREE.BufferGeometry

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
