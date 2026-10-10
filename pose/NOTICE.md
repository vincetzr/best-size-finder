# Third-party files in this directory

Everything here is Google's MediaPipe, unmodified, so the pages load nothing
from anyone else once they are open.

| file | what | from |
|---|---|---|
| `vision_bundle.mjs` | MediaPipe Tasks Vision, the JavaScript | `@mediapipe/tasks-vision@1.0.1` on npm |
| `wasm/` | its WebAssembly, SIMD and non-SIMD | the same package (byte-identical to 1.0.1) |
| `pose_landmarker_lite.task` | pose landmarks and person mask | MediaPipe model card: Pose Landmarker (lite) |
| `face_landmarker.task` | 478 face landmarks with the irises | `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/` |

MediaPipe is licensed under the Apache License 2.0
(https://www.apache.org/licenses/LICENSE-2.0); the models under the terms of
their model cards. Privacy notice for the library: https://goo.gle/mediapipe-privacy
— on these pages everything runs on the device and no image leaves it.
