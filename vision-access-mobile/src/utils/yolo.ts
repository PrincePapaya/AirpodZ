export type ModelManifest = {
  modelBundled: boolean;
  modelFile: string;
  inputWidth: number;
  inputHeight: number;
  inputType: "float32" | "uint8";
  labels: string[];
  scoreThreshold: number;
  iouThreshold: number;
  postprocess: "yolov8_raw";
  delegate: "auto" | "core-ml" | "android-gpu" | "nnapi";
};

export type RoadSignDetection = {
  label: string;
  score: number;
  left: number;
  top: number;
  width: number;
  height: number;
  classIndex: number;
};

function intersectionOverUnion(a: RoadSignDetection, b: RoadSignDetection) {
  "worklet";

  const ax2 = a.left + a.width;
  const ay2 = a.top + a.height;
  const bx2 = b.left + b.width;
  const by2 = b.top + b.height;

  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function clipUnit(value: number) {
  "worklet";
  return Math.max(0, Math.min(1, value));
}

export function decodeYoloOutput(
  output: ArrayLike<number>,
  manifest: ModelManifest
): RoadSignDetection[] {
  "worklet";

  const labels = manifest.labels.length > 0 ? manifest.labels : ["Road sign"];
  const stride = 4 + labels.length;
  if (output.length < stride || output.length % stride !== 0) {
    return [];
  }

  const anchorCount = Math.floor(output.length / stride);
  const raw: RoadSignDetection[] = [];

  for (let anchor = 0; anchor < anchorCount; anchor += 1) {
    let bestClass = 0;
    let bestScore = 0;

    for (let classIndex = 0; classIndex < labels.length; classIndex += 1) {
      const score = Number(output[(4 + classIndex) * anchorCount + anchor]);
      if (score > bestScore) {
        bestScore = score;
        bestClass = classIndex;
      }
    }

    if (bestScore < manifest.scoreThreshold) {
      continue;
    }

    const x = Number(output[anchor]);
    const y = Number(output[anchorCount + anchor]);
    const w = Number(output[anchorCount * 2 + anchor]);
    const h = Number(output[anchorCount * 3 + anchor]);

    const left = clipUnit((x - w / 2) / manifest.inputWidth);
    const top = clipUnit((y - h / 2) / manifest.inputHeight);
    const width = clipUnit(w / manifest.inputWidth);
    const height = clipUnit(h / manifest.inputHeight);

    raw.push({
      label: labels[bestClass] ?? `Class ${bestClass + 1}`,
      score: bestScore,
      left,
      top,
      width,
      height,
      classIndex: bestClass
    });
  }

  raw.sort((a, b) => b.score - a.score);

  const picked: RoadSignDetection[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const candidate = raw[i];
    let suppressed = false;

    for (let j = 0; j < picked.length; j += 1) {
      if (
        picked[j].classIndex === candidate.classIndex &&
        intersectionOverUnion(picked[j], candidate) > manifest.iouThreshold
      ) {
        suppressed = true;
        break;
      }
    }

    if (!suppressed) {
      picked.push(candidate);
    }
  }

  return picked.slice(0, 8);
}
