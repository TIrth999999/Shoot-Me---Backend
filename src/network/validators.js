import { clamp } from "../util/math.js";

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

export const sanitizeRotation = (rotation) => {
  if (!rotation || !isFiniteNumber(rotation.yaw)) {
    return { yaw: 0 };
  }
  return { yaw: clamp(rotation.yaw, -Math.PI * 2, Math.PI * 2) };
};

export const sanitizePosition = (position, world) => {
  if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.z)) {
    return null;
  }

  return {
    x: clamp(position.x, -world.width * 0.5, world.width * 0.5),
    y: 0,
    z: clamp(position.z, -world.depth * 0.5, world.depth * 0.5)
  };
};

export const sanitizeDirection = (direction) => {
  if (!direction || !isFiniteNumber(direction.x) || !isFiniteNumber(direction.z)) {
    return null;
  }

  const y = isFiniteNumber(direction.y) ? direction.y : 0;
  const length = Math.hypot(direction.x, y, direction.z);
  if (length < 0.01 || length > 2) {
    return null;
  }

  return {
    x: direction.x / length,
    y: y / length,
    z: direction.z / length
  };
};

export const sanitizeShootOrigin = (origin, world) => {
  if (!origin || !isFiniteNumber(origin.x) || !isFiniteNumber(origin.y) || !isFiniteNumber(origin.z)) {
    return null;
  }

  return {
    x: clamp(origin.x, -world.width * 0.5, world.width * 0.5),
    y: clamp(origin.y, -2, 8),
    z: clamp(origin.z, -world.depth * 0.5, world.depth * 0.5)
  };
};

export const sanitizeString = (value, max = 32) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
};

export const parseJson = (raw) => {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
};
