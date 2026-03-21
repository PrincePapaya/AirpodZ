export const colorAssistShader = `
uniform shader image;
uniform float swapRedBlue;
uniform float yellowToCyan;
uniform float strength;

float hueDistance(float a, float b) {
  float raw = abs(a - b);
  return min(raw, 360.0 - raw);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

half4 main(vec2 pos) {
  vec4 base = image.eval(pos);
  vec3 hsv = rgb2hsv(base.rgb);
  float hue = hsv.x * 360.0;
  float sat = hsv.y;
  float val = hsv.z;

  float redMask = smoothstep(28.0, 0.0, hueDistance(hue, 0.0)) * smoothstep(0.18, 0.35, sat);
  float blueMask = smoothstep(26.0, 0.0, hueDistance(hue, 220.0)) * smoothstep(0.18, 0.35, sat);
  float yellowMask = smoothstep(24.0, 0.0, hueDistance(hue, 55.0)) * smoothstep(0.16, 0.30, sat);

  if (swapRedBlue > 0.5) {
    hue = mix(hue, 220.0, redMask * strength);
    hue = mix(hue, 0.0, blueMask * strength);
  }

  if (yellowToCyan > 0.5) {
    hue = mix(hue, 185.0, yellowMask * strength);
  }

  vec3 shifted = hsv2rgb(vec3(hue / 360.0, sat, val));
  return vec4(shifted, base.a);
}
`;

export const glareReducerShader = `
uniform shader image;
uniform float threshold;
uniform float lowSatMax;
uniform float suppression;
uniform float highlightClamp;
uniform float gamma;
uniform float bloom;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

half4 main(vec2 pos) {
  vec4 src = image.eval(pos);
  vec3 hsv = rgb2hsv(src.rgb);

  vec3 sampleA = image.eval(pos + vec2(6.0 + bloom * 10.0, 0.0)).rgb;
  vec3 sampleB = image.eval(pos + vec2(-6.0 - bloom * 10.0, 0.0)).rgb;
  vec3 sampleC = image.eval(pos + vec2(0.0, 6.0 + bloom * 10.0)).rgb;
  vec3 sampleD = image.eval(pos + vec2(0.0, -6.0 - bloom * 10.0)).rgb;
  float localGlow = (luminance(sampleA) + luminance(sampleB) + luminance(sampleC) + luminance(sampleD)) * 0.25;

  float brightMask = smoothstep(threshold - 0.08, threshold + 0.02, max(hsv.z, localGlow));
  float lowSatMask = 1.0 - smoothstep(lowSatMax, lowSatMax + 0.16, hsv.y);
  float glareMask = clamp(max(brightMask, brightMask * lowSatMask), 0.0, 1.0);
  glareMask = pow(glareMask, 1.15);

  vec3 reduced = src.rgb * (1.0 - suppression * glareMask);
  float peak = max(max(reduced.r, reduced.g), reduced.b);
  if (peak > highlightClamp) {
    reduced *= highlightClamp / max(peak, 0.001);
  }

  reduced = pow(reduced, vec3(gamma));
  vec3 outColor = mix(src.rgb, reduced, glareMask);
  return vec4(outColor, src.a);
}
`;
