/**
 * THE MODELS: where the body and the face are.
 *
 * MediaPipe's pose landmarker (33 points and a person mask) and face
 * landmarker (478 points with the irises), from the copies in /pose, so the
 * page makes no request to anyone else once loaded. Version 1.0.1 of
 * tasks-vision, the one the wasm in /pose/wasm was built from (same bytes).
 *
 * The GPU is tried first and the CPU second: the August page tried only the
 * GPU, and on a device where that failed it went quietly to subtracting the
 * empty room instead.
 */
const BASE = new URL('../pose/', import.meta.url).href;

let visionModule = null;
let fileset = null;

async function load() {
  if (!visionModule) visionModule = await import(`${BASE}vision_bundle.mjs`);
  if (!fileset) fileset = await visionModule.FilesetResolver.forVisionTasks(`${BASE}wasm`);
  return { vision: visionModule, fileset };
}

async function create(make) {
  const { vision, fileset: fs } = await load();
  try {
    return await make(vision, fs, 'GPU');
  } catch (e) {
    console.warn('GPU delegate failed, trying the CPU', e);
    return make(vision, fs, 'CPU');
  }
}

/**
 * The pose landmarker. `hasMasks` on the result says whether it gives the
 * person's outline: on the CPU, MediaPipe 1.0.1 aborts the whole wasm module
 * the first time it is asked for a mask ("Check failed: 1 == ChannelSize()"),
 * so there it is loaded without one, and the page says it cannot measure
 * widths rather than dying on the first picture.
 */
export async function createPose({ masks = true } = {}) {
  return create(async (vision, fs, delegate) => {
    const withMasks = masks && delegate === 'GPU';
    const pose = await vision.PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${BASE}pose_landmarker_lite.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      outputSegmentationMasks: withMasks,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    pose.hasMasks = withMasks;
    pose.delegate = delegate;
    return pose;
  });
}

export async function createFace() {
  return create((vision, fs, delegate) =>
    vision.FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${BASE}face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    }),
  );
}

/**
 * One pose reading: { landmarks, mask, mw, mh } or null. The mask is copied
 * out and the model's own released, because MediaPipe reuses it on the next
 * call.
 */
export function readPose(pose, video, timestampMs, { wantMask = true } = {}) {
  let r;
  try {
    r = pose.detectForVideo(video, timestampMs);
  } catch (e) {
    console.warn('pose failed', e);
    return null;
  }
  const landmarks = r.landmarks && r.landmarks[0];
  let mask = null;
  let mw = 0;
  let mh = 0;
  if (r.segmentationMasks && r.segmentationMasks[0]) {
    const m = r.segmentationMasks[0];
    if (wantMask) {
      mask = new Float32Array(m.getAsFloat32Array());
      mw = m.width;
      mh = m.height;
    }
    for (const x of r.segmentationMasks) x.close();
  }
  if (!landmarks) return null;
  return { landmarks, mask, mw, mh };
}

export function readFace(face, video, timestampMs) {
  try {
    const r = face.detectForVideo(video, timestampMs);
    return (r.faceLandmarks && r.faceLandmarks[0]) || null;
  } catch (e) {
    console.warn('face failed', e);
    return null;
  }
}
