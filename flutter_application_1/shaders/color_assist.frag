#version 460 core
#include <flutter/runtime_effect.glsl>

uniform vec2 uSize;
uniform float uSwapRedBlue;
uniform float uYellowToCyan;
uniform sampler2D uTexture;

vec3 rgbToHsv(vec3 color) {
    vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(color.bg, k.wz), vec4(color.gb, k.xy), step(color.b, color.g));
    vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsvToRgb(vec3 color) {
    vec3 p = abs(fract(color.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return color.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), color.y);
}

bool isBetween(float value, float start, float end) {
    return value >= start && value <= end;
}

bool isLikelySkin(vec3 rgb, vec3 hsv) {
    float r = rgb.r * 255.0;
    float g = rgb.g * 255.0;
    float b = rgb.b * 255.0;
    float maxChannel = max(r, max(g, b));
    float minChannel = min(r, min(g, b));
    float hueDegrees = hsv.x * 360.0;

    bool rgbRule = r > 95.0 &&
        g > 40.0 &&
        b > 20.0 &&
        (maxChannel - minChannel) > 15.0 &&
        abs(r - g) > 15.0 &&
        r > g &&
        r > b;

    bool hsvRule = hueDegrees >= 0.0 &&
        hueDegrees <= 50.0 &&
        hsv.y >= 0.15 &&
        hsv.y <= 0.75 &&
        hsv.z >= 0.2;

    return rgbRule && hsvRule;
}

out vec4 fragColor;

void main() {
    vec2 uv = FlutterFragCoord().xy / uSize;
    uv.y = 1.0 - uv.y;
    vec4 color = texture(uTexture, uv);
    vec3 hsv = rgbToHsv(color.rgb);
    float hueDegrees = hsv.x * 360.0;
    bool brightEnough = hsv.y * 255.0 >= 70.0 && hsv.z * 255.0 >= 50.0;

    if (brightEnough && !isLikelySkin(color.rgb, hsv)) {
        if (uYellowToCyan > 0.5 && isBetween(hueDegrees, 40.0, 70.0)) {
            hsv.x = 180.0 / 360.0;
        } else if (uSwapRedBlue > 0.5 && isBetween(hueDegrees, 200.0, 260.0)) {
            hsv.x = 0.0;
        } else if (uSwapRedBlue > 0.5 && (hueDegrees <= 20.0 || hueDegrees >= 340.0)) {
            hsv.x = 240.0 / 360.0;
        }
    }

    fragColor = vec4(hsvToRgb(hsv), color.a);
}
