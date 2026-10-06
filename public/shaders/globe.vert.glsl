// ORI globe — vertex shader
// Passes world-space normal, view direction and spherical coords to the
// fragment stage for the fresnel rim + lat/long dot-grid effect.

varying vec3  vNormal;
varying vec3  vView;
varying vec3  vPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView   = normalize(cameraPosition - world.xyz);
  vPos    = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * world;
}
