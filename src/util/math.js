export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const dist2D = (a, b) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
};

export const normalize2D = (x, z) => {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
};

export const randomSpawnPoint = (worldWidth, worldDepth) => ({
  x: (Math.random() - 0.5) * worldWidth,
  y: 0,
  z: (Math.random() - 0.5) * worldDepth
});

export const nowMs = () => Date.now();