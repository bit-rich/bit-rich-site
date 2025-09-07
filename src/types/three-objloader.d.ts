declare module 'three/examples/jsm/loaders/OBJLoader' {
  import { Loader, Object3D } from 'three'
  export class OBJLoader extends Loader {
    load(
      url: string,
      onLoad: (object: Object3D) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (event: ErrorEvent) => void
    ): void
  }
}

