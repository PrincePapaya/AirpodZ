import React, { useState } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BottomTabs, ScreenId } from "./src/components";
import {
  ColorAssistScreen,
  GlareReducerScreen,
  HomeScreen,
  RoadSignAssistantScreen
} from "./src/screens";
import { palette } from "./src/theme";

function AmbientBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.orbOne} />
      <View style={styles.orbTwo} />
      <View style={styles.orbThree} />
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <AmbientBackground />
        {screen === "home" && <HomeScreen onSelect={setScreen} />}
        {screen === "color" && <ColorAssistScreen />}
        {screen === "glare" && <GlareReducerScreen />}
        {screen === "roadsign" && <RoadSignAssistantScreen />}
        <BottomTabs current={screen} onSelect={setScreen} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.ink
  },
  orbOne: {
    position: "absolute",
    top: -90,
    right: -40,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(87, 198, 217, 0.12)"
  },
  orbTwo: {
    position: "absolute",
    top: 220,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(244, 197, 110, 0.10)"
  },
  orbThree: {
    position: "absolute",
    bottom: 140,
    right: 30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(155, 231, 242, 0.08)"
  }
});
