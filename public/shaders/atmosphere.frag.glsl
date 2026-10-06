// ORI globe — atmosphere glow (rendered on a slightly larger back-side sphere)
precision highp float;

varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;

uniform vec3 uColorA;
uniform vec3 uColorB;

void main() {
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.2);
  vec3 col = mix(uColorA, uColorB, 0.5 + 0.5 * vPos.y);
  gl_FragColor = vec4(col, fres * 0.9);
}
