import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { featureAccents, palette } from "./theme";

export type ScreenId = "home" | "color" | "glare" | "roadsign";

export const tabMeta: Record<
  ScreenId,
  { label: string; eyebrow: string; accent: string; description: string }
> = {
  home: {
    label: "Overview",
    eyebrow: "Luma Lane",
    accent: featureAccents.home,
    description: "Live visual assistance for color, glare, and road signs."
  },
  color: {
    label: "Color Assist",
    eyebrow: "Feature One",
    accent: featureAccents.color,
    description: "Shift difficult hues in the live camera feed."
  },
  glare: {
    label: "Night Shield",
    eyebrow: "Feature Two",
    accent: featureAccents.glare,
    description: "Tone down high-beam glare and bright bloom."
  },
  roadsign: {
    label: "Sign Guide",
    eyebrow: "Feature Three",
    accent: featureAccents.roadsign,
    description: "Detect road signs and announce them aloud."
  }
};

export function ScreenShell({
  screen,
  title,
  description,
  children
}: {
  screen: ScreenId;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{tabMeta[screen].eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

export function BottomTabs({
  current,
  onSelect
}: {
  current: ScreenId;
  onSelect: (screen: ScreenId) => void;
}) {
  const screens: ScreenId[] = ["home", "color", "glare", "roadsign"];
  return (
    <View style={styles.bottomDock}>
      {screens.map((screen) => {
        const active = current === screen;
        const meta = tabMeta[screen];
        return (
          <Pressable
            key={screen}
            onPress={() => onSelect(screen)}
            style={[
              styles.tabButton,
              active && { backgroundColor: meta.accent }
            ]}
          >
            <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FeatureCards({
  onSelect
}: {
  onSelect: (screen: ScreenId) => void;
}) {
  const features: ScreenId[] = ["color", "glare", "roadsign"];
  return (
    <ScrollView contentContainerStyle={styles.cardList} showsVerticalScrollIndicator={false}>
      {features.map((screen) => {
        const meta = tabMeta[screen];
        return (
          <Pressable
            key={screen}
            onPress={() => onSelect(screen)}
            style={[styles.card, { borderColor: `${meta.accent}66` }]}
          >
            <View style={[styles.cardAccent, { backgroundColor: meta.accent }]} />
            <Text style={styles.cardTitle}>{meta.label}</Text>
            <Text style={styles.cardDescription}>{meta.description}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function FloatingPanel({ children }: { children: React.ReactNode }) {
  return <View style={styles.floatingPanel}>{children}</View>;
}

export function ToggleRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.controlRow}>
      <Text style={styles.controlLabel}>{label}</Text>
      <Pressable
        onPress={() => onChange(!value)}
        style={[
          styles.pillButton,
          value ? styles.pillActive : styles.pillInactive
        ]}
      >
        <Text style={[styles.pillText, !value && styles.pillTextMuted]}>
          {value ? "On" : "Off"}
        </Text>
      </Pressable>
    </View>
  );
}

export function StepperRow({
  label,
  value,
  onIncrement,
  onDecrement
}: {
  label: string;
  value: string;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <View style={styles.controlRow}>
      <View>
        <Text style={styles.controlLabel}>{label}</Text>
        <Text style={styles.valueText}>{value}</Text>
      </View>
      <View style={styles.stepper}>
        <Pressable onPress={onDecrement} style={styles.stepperButton}>
          <Text style={styles.stepperText}>-</Text>
        </Pressable>
        <Pressable onPress={onIncrement} style={styles.stepperButton}>
          <Text style={styles.stepperText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PermissionCard({
  title,
  body,
  actionLabel,
  onAction
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      <Pressable onPress={onAction} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

export function StateCard({
  title,
  body
}: {
  title: string;
  body: string;
}) {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
    </View>
  );
}

export function clampStep(value: number, min: number, max: number, step: number) {
  const next = Math.max(min, Math.min(max, value));
  return Number(next.toFixed(step < 1 ? 2 : 0));
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10
  },
  eyebrow: {
    color: palette.mist,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  title: {
    color: palette.cloud,
    fontSize: 32,
    fontWeight: "800",
    marginTop: 6
  },
  description: {
    color: palette.mist,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 620
  },
  content: {
    flex: 1
  },
  cardList: {
    paddingHorizontal: 20,
    paddingBottom: 140,
    gap: 16
  },
  card: {
    backgroundColor: palette.panel,
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 132
  },
  cardAccent: {
    position: "absolute",
    right: -22,
    top: -22,
    width: 92,
    height: 92,
    borderRadius: 46,
    opacity: 0.18
  },
  cardTitle: {
    color: palette.cloud,
    fontSize: 22,
    fontWeight: "700"
  },
  cardDescription: {
    color: palette.mist,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10
  },
  floatingPanel: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 98,
    backgroundColor: palette.panel,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: 14
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16
  },
  controlLabel: {
    color: palette.cloud,
    fontSize: 16,
    fontWeight: "600"
  },
  valueText: {
    color: palette.mist,
    fontSize: 13,
    marginTop: 4
  },
  pillButton: {
    minWidth: 84,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  pillActive: {
    backgroundColor: palette.cyan
  },
  pillInactive: {
    backgroundColor: palette.slate
  },
  pillText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "700"
  },
  pillTextMuted: {
    color: palette.cloud
  },
  stepper: {
    flexDirection: "row",
    gap: 10
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.slate
  },
  stepperText: {
    color: palette.cloud,
    fontSize: 24,
    fontWeight: "600",
    marginTop: -2
  },
  stateCard: {
    marginHorizontal: 20,
    marginTop: 18,
    backgroundColor: palette.panelSoft,
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: 10
  },
  stateTitle: {
    color: palette.cloud,
    fontSize: 22,
    fontWeight: "700"
  },
  stateBody: {
    color: palette.mist,
    fontSize: 15,
    lineHeight: 22
  },
  primaryButton: {
    marginTop: 6,
    backgroundColor: palette.amber,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center"
  },
  primaryButtonText: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  bottomDock: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 22,
    flexDirection: "row",
    padding: 8,
    borderRadius: 999,
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.outline,
    gap: 8
  },
  tabButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  tabButtonText: {
    color: palette.mist,
    fontSize: 12,
    fontWeight: "700"
  },
  tabButtonTextActive: {
    color: palette.ink
  }
});
