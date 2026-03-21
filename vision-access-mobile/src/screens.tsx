import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, useSkiaFrameProcessor } from "react-native-vision-camera";
import { Skia } from "@shopify/react-native-skia";
import { loadTensorflowModel } from "react-native-fast-tflite";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { Worklets } from "react-native-worklets-core";
import * as Speech from "expo-speech";

import modelManifest from "../assets/models/roadsign_model.json";
import {
  FeatureCards,
  FloatingPanel,
  PermissionCard,
  ScreenId,
  ScreenShell,
  StateCard,
  StepperRow,
  ToggleRow
} from "./components";
import { colorAssistShader, glareReducerShader } from "./shaders";
import { palette } from "./theme";
import {
  decodeYoloOutput,
  ModelManifest,
  RoadSignDetection
} from "./utils/yolo";

const bundledRoadSignModel = require("../assets/models/roadsign.tflite");
const roadSignManifest = modelManifest as ModelManifest;
const overlayColors = [palette.amber, palette.cyan, palette.aqua, palette.sand];

function LiveCamera({
  frameProcessor
}: {
  frameProcessor?: any;
}) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();

  if (!hasPermission) {
    return (
      <PermissionCard
        title="Camera access is required"
        body="Luma Lane needs the rear camera so the live accessibility tools can work in real time."
        actionLabel="Enable camera"
        onAction={requestPermission}
      />
    );
  }

  if (device == null) {
    return (
      <StateCard
        title="No rear camera found"
        body="This device did not report a usable back camera to VisionCamera."
      />
    );
  }

  return (
    <View style={styles.cameraFrame}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo={false}
        video={false}
        audio={false}
        frameProcessor={frameProcessor}
      />
    </View>
  );
}

function buildShaderPaint(shaderSource: string) {
  const effect = Skia.RuntimeEffect.Make(shaderSource);
  if (!effect) {
    return null;
  }
  const paint = Skia.Paint();
  const builder = Skia.RuntimeShaderBuilder(effect);
  return { paint, builder };
}

function DetectionOverlay({ detections }: { detections: RoadSignDetection[] }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {detections.map((detection, index) => {
        const color = overlayColors[detection.classIndex % overlayColors.length];
        return (
          <View
            key={`${detection.label}-${index}`}
            style={[
              styles.detectionBox,
              {
                borderColor: color,
                left: `${detection.left * 100}%`,
                top: `${detection.top * 100}%`,
                width: `${detection.width * 100}%`,
                height: `${detection.height * 100}%`
              }
            ]}
          >
            <View style={[styles.detectionTag, { backgroundColor: color }]}>
              <Text style={styles.detectionTagText}>
                {detection.label} {Math.round(detection.score * 100)}%
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function HomeScreen({ onSelect }: { onSelect: (screen: ScreenId) => void }) {
  return (
    <ScreenShell
      screen="home"
      title="Driving vision support that stays live"
      description="Use color assistance for difficult hues, a night shield for harsh glare, and spoken sign guidance for the road ahead."
    >
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Built for iOS and Android</Text>
        <Text style={styles.heroBody}>
          This mobile app keeps the laptop features together in one camera-first
          experience with large controls and accessible contrast.
        </Text>
      </View>
      <FeatureCards onSelect={onSelect} />
    </ScreenShell>
  );
}

export function ColorAssistScreen() {
  const [swapRedBlue, setSwapRedBlue] = useState(true);
  const [yellowToCyan, setYellowToCyan] = useState(true);
  const [strength, setStrength] = useState(0.85);

  const shaderKitRef = useRef(buildShaderPaint(colorAssistShader));
  const colorPaint = shaderKitRef.current?.paint ?? null;

  useEffect(() => {
    const shaderKit = shaderKitRef.current;
    if (!shaderKit) {
      return;
    }

    shaderKit.builder.setUniform("swapRedBlue", swapRedBlue ? 1 : 0);
    shaderKit.builder.setUniform("yellowToCyan", yellowToCyan ? 1 : 0);
    shaderKit.builder.setUniform("strength", strength);
    shaderKit.paint.setImageFilter(
      Skia.ImageFilter.MakeRuntimeShader(shaderKit.builder, null, null)
    );
  }, [strength, swapRedBlue, yellowToCyan]);

  const frameProcessor = useSkiaFrameProcessor((frame) => {
    "worklet";
    if (colorPaint == null) {
      frame.render();
      return;
    }
    frame.render(colorPaint);
  }, [colorPaint]);

  return (
    <ScreenShell
      screen="color"
      title="Color Assist"
      description="Shift the most difficult live colors into easier-to-read hues without changing the rest of the scene too aggressively."
    >
      <LiveCamera frameProcessor={frameProcessor} />
      <FloatingPanel>
        <ToggleRow label="Swap red and blue" value={swapRedBlue} onChange={setSwapRedBlue} />
        <ToggleRow label="Shift yellow toward cyan" value={yellowToCyan} onChange={setYellowToCyan} />
        <StepperRow
          label="Filter strength"
          value={`${Math.round(strength * 100)}%`}
          onIncrement={() => setStrength((value) => Math.min(1, value + 0.05))}
          onDecrement={() => setStrength((value) => Math.max(0.3, value - 0.05))}
        />
      </FloatingPanel>
    </ScreenShell>
  );
}

export function GlareReducerScreen() {
  const [threshold, setThreshold] = useState(0.84);
  const [lowSatMax, setLowSatMax] = useState(0.34);
  const [suppression, setSuppression] = useState(0.72);
  const [highlightClamp, setHighlightClamp] = useState(0.76);
  const [gamma, setGamma] = useState(1.16);
  const [bloom, setBloom] = useState(0.6);

  const shaderKitRef = useRef(buildShaderPaint(glareReducerShader));
  const glarePaint = shaderKitRef.current?.paint ?? null;

  useEffect(() => {
    const shaderKit = shaderKitRef.current;
    if (!shaderKit) {
      return;
    }

    shaderKit.builder.setUniform("threshold", threshold);
    shaderKit.builder.setUniform("lowSatMax", lowSatMax);
    shaderKit.builder.setUniform("suppression", suppression);
    shaderKit.builder.setUniform("highlightClamp", highlightClamp);
    shaderKit.builder.setUniform("gamma", gamma);
    shaderKit.builder.setUniform("bloom", bloom);
    shaderKit.paint.setImageFilter(
      Skia.ImageFilter.MakeRuntimeShader(shaderKit.builder, null, null)
    );
  }, [bloom, gamma, highlightClamp, lowSatMax, suppression, threshold]);

  const frameProcessor = useSkiaFrameProcessor((frame) => {
    "worklet";
    if (glarePaint == null) {
      frame.render();
      return;
    }
    frame.render(glarePaint);
  }, [glarePaint]);

  return (
    <ScreenShell
      screen="glare"
      title="Night Shield"
      description="Reduce harsh bloom from headlights and street glare while keeping the rest of the road view readable."
    >
      <LiveCamera frameProcessor={frameProcessor} />
      <FloatingPanel>
        <StepperRow
          label="Bright threshold"
          value={`${Math.round(threshold * 100)}%`}
          onIncrement={() => setThreshold((value) => Math.min(0.98, value + 0.02))}
          onDecrement={() => setThreshold((value) => Math.max(0.5, value - 0.02))}
        />
        <StepperRow
          label="Suppression"
          value={`${Math.round(suppression * 100)}%`}
          onIncrement={() => setSuppression((value) => Math.min(0.95, value + 0.03))}
          onDecrement={() => setSuppression((value) => Math.max(0.2, value - 0.03))}
        />
        <StepperRow
          label="Low-saturation bias"
          value={`${Math.round(lowSatMax * 100)}%`}
          onIncrement={() => setLowSatMax((value) => Math.min(0.75, value + 0.03))}
          onDecrement={() => setLowSatMax((value) => Math.max(0.05, value - 0.03))}
        />
        <StepperRow
          label="Highlight clamp"
          value={`${Math.round(highlightClamp * 100)}%`}
          onIncrement={() => setHighlightClamp((value) => Math.min(0.95, value + 0.03))}
          onDecrement={() => setHighlightClamp((value) => Math.max(0.45, value - 0.03))}
        />
        <StepperRow
          label="Bloom sampling"
          value={`${Math.round(bloom * 100)}%`}
          onIncrement={() => setBloom((value) => Math.min(1, value + 0.05))}
          onDecrement={() => setBloom((value) => Math.max(0.1, value - 0.05))}
        />
        <StepperRow
          label="Gamma"
          value={gamma.toFixed(2)}
          onIncrement={() => setGamma((value) => Math.min(1.5, value + 0.04))}
          onDecrement={() => setGamma((value) => Math.max(0.7, value - 0.04))}
        />
      </FloatingPanel>
    </ScreenShell>
  );
}

export function RoadSignAssistantScreen() {
  const [model, setModel] = useState<any>(null);
  const [modelStatus, setModelStatus] = useState<"missing" | "loading" | "ready" | "error">(
    roadSignManifest.modelBundled ? "loading" : "missing"
  );
  const [detections, setDetections] = useState<RoadSignDetection[]>([]);
  const { resize } = useResizePlugin();
  const activeLabelTimesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadModel() {
      if (!roadSignManifest.modelBundled) {
        return;
      }

      try {
        const delegate =
          roadSignManifest.delegate === "auto"
            ? undefined
            : roadSignManifest.delegate;

        const nextModel = await loadTensorflowModel(bundledRoadSignModel, delegate as any);
        if (!cancelled) {
          setModel(nextModel);
          setModelStatus("ready");
        }
      } catch (_error) {
        if (!cancelled) {
          setModelStatus("error");
        }
      }
    }

    loadModel();
    return () => {
      cancelled = true;
      Speech.stop();
    };
  }, []);

  const handleDetections = (nextDetections: RoadSignDetection[]) => {
    setDetections(nextDetections);

    const now = Date.now();
    const presentLabels = new Set(nextDetections.map((item) => item.label));
    let announced = false;

    Object.keys(activeLabelTimesRef.current).forEach((label) => {
      if (!presentLabels.has(label) && now - activeLabelTimesRef.current[label] > 900) {
        delete activeLabelTimesRef.current[label];
      }
    });

    nextDetections.forEach((detection) => {
      const previousSeenAt = activeLabelTimesRef.current[detection.label];
      if (!previousSeenAt && !announced) {
        Speech.stop();
        Speech.speak(`There may be a potential ${detection.label} ahead`, {
          pitch: 1.0,
          rate: 0.98
        });
        announced = true;
      }
      activeLabelTimesRef.current[detection.label] = now;
    });
  };

  const pushDetectionsToJs = Worklets.createRunOnJS(handleDetections);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      if (model == null) {
        return;
      }

      const resized = resize(frame, {
        scale: {
          width: roadSignManifest.inputWidth,
          height: roadSignManifest.inputHeight
        },
        pixelFormat: "rgb",
        dataType: roadSignManifest.inputType
      });

      const outputs = model.runSync([resized]);
      const primaryOutput = Array.isArray(outputs) ? outputs[0] : outputs;
      const nextDetections = decodeYoloOutput(primaryOutput, roadSignManifest);
      pushDetectionsToJs(nextDetections);
    },
    [model, pushDetectionsToJs, resize]
  );

  return (
    <ScreenShell
      screen="roadsign"
      title="Sign Guide"
      description="Run the road-sign model on-device and announce each sign when it enters view."
    >
      {modelStatus === "missing" ? (
        <StateCard
          title="Road-sign model not bundled yet"
          body="Run the export script in the mobile app README to convert best.pt into assets/models/roadsign.tflite and update the manifest automatically."
        />
      ) : (
        <>
          <View style={styles.cameraStack}>
            <LiveCamera frameProcessor={modelStatus === "ready" ? frameProcessor : undefined} />
            <DetectionOverlay detections={detections} />
          </View>
          <FloatingPanel>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Model status</Text>
              <Text style={styles.summaryValue}>
                {modelStatus === "ready"
                  ? "Ready"
                  : modelStatus === "loading"
                    ? "Loading"
                    : "Unavailable"}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Threshold</Text>
              <Text style={styles.summaryValue}>
                {Math.round(roadSignManifest.scoreThreshold * 100)}%
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Visible detections</Text>
              <Text style={styles.summaryValue}>{detections.length}</Text>
            </View>
            {detections.length > 0 ? (
              <View style={styles.labelWrap}>
                {detections.map((detection, index) => (
                  <View
                    key={`${detection.label}-${index}`}
                    style={[
                      styles.labelPill,
                      {
                        backgroundColor:
                          overlayColors[detection.classIndex % overlayColors.length]
                      }
                    ]}
                  >
                    <Text style={styles.labelPillText}>{detection.label}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.helperText}>
                Live sign labels will appear here once the model sees the road ahead.
              </Text>
            )}
          </FloatingPanel>
        </>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: "rgba(19, 42, 64, 0.86)",
    borderRadius: 34,
    padding: 24,
    borderWidth: 1,
    borderColor: palette.outline
  },
  heroTitle: {
    color: palette.cloud,
    fontSize: 24,
    fontWeight: "800"
  },
  heroBody: {
    color: palette.mist,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10
  },
  cameraFrame: {
    marginHorizontal: 20,
    marginTop: 8,
    flex: 1,
    minHeight: 320,
    borderRadius: 34,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: "#02070D"
  },
  cameraStack: {
    flex: 1
  },
  detectionBox: {
    position: "absolute",
    borderWidth: 3,
    borderRadius: 18
  },
  detectionTag: {
    alignSelf: "flex-start",
    borderBottomRightRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  detectionTagText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "800"
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  summaryLabel: {
    color: palette.mist,
    fontSize: 14,
    fontWeight: "600"
  },
  summaryValue: {
    color: palette.cloud,
    fontSize: 15,
    fontWeight: "800"
  },
  helperText: {
    color: palette.mist,
    fontSize: 13,
    lineHeight: 20
  },
  labelWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  labelPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  labelPillText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800"
  }
});
