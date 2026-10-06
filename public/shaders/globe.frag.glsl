// ORI globe — fragment shader
// A stylized "nervous system" planet: a latitude/longitude dot grid that
// fades toward the limb, lit by a travelling terminator sweep, wrapped in a
// fresnel rim in the brand gradient.

precision highp float;

varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;

uniform float uTime;
uniform vec3  uColorA;   // cyan
uniform vec3  uColorB;   // violet

#define PI 3.14159265359

void main() {
  // spherical coordinates from the unit position
  float lat = asin(clamp(vPos.y, -1.0, 1.0));      // -PI/2..PI/2
  float lon = atan(vPos.z, vPos.x);                // -PI..PI

  // dot grid: bright dots at grid intersections
  float gridLat = abs(fract(lat * (18.0 / PI)) - 0.5);
  float gridLon = abs(fract(lon * (36.0 / (2.0 * PI))) - 0.5);
  float dots = smoothstep(0.46, 0.5, gridLat) * smoothstep(0.46, 0.5, gridLon);

  // faint longitude/latitude lines
  float lines = max(
    smoothstep(0.48, 0.5, gridLat),
    smoothstep(0.49, 0.5, gridLon)
  ) * 0.12;

  // fresnel rim
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);

  // travelling terminator sweep (day/night feel)
  float sweep = 0.5 + 0.5 * sin(lon + uTime * 0.25);
  sweep = smoothstep(0.1, 1.0, sweep);

  vec3 grad = mix(uColorA, uColorB, 0.5 + 0.5 * vPos.y);
  vec3 col  = grad * (dots * (0.5 + sweep) + lines);
  col += grad * fres * 1.3;

  float alpha = clamp(dots + lines + fres * 0.8, 0.0, 1.0);
  // keep the back hemisphere faint rather than solid
  alpha *= 0.35 + 0.65 * sweep;

  gl_FragColor = vec4(col, alpha);
}
