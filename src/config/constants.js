export const SERVER_CONFIG = {
  port: Number(process.env.PORT || 8080),
  tickRate: 60,
  snapshotRate: 15,
  maxPlayersPerRoom: 4,
  world: {
    width: 140,
    depth: 140,
    zombieContactRadius: 1.4,
    zombieBaseSpeed: 1.8,
    zombieSpeedRampPerMin: 0.45,
    zombieFallGravity: 24,
    zombieSpawnHeightMin: 14,
    zombieSpawnHeightMax: 26,
    spawnBaseRateSec: 2.5,
    spawnMinRateSec: 0.25,
    spawnRampPerMin: 0.35,
    maxZombiesBase: 35,
    maxZombieGrowthPerMin: 10,
    playerRadius: 0.7,
    bulletRange: 95,
    bulletRadius: 1.4,
    zombieHitBaseY: 0.05,
    zombieHitHeight: 1.85,
    zombieHitRadius: 0.48,
    playerEyeHeight: 1.55,
    shootCooldownMs: 180,
    zombieDamagePerTick: 10,
    zombieDamageIntervalMs: 700,
    zombieHP: 45,
    playerHP: 100,
    playerMoveSpeed: 7,
    sprintMultiplier: 1.6,
    antiCheatMaxMovePerTick: 2.2,
    minMoveDelta: 0.035,
    minYawDelta: 0.015
  }
};

export const MESSAGE_TYPES = {
  CREATE_ROOM: "CREATE_ROOM",
  JOIN_ROOM: "JOIN_ROOM",
  LEAVE_ROOM: "LEAVE_ROOM",
  PLAYER_MOVE: "PLAYER_MOVE",
  SHOOT: "SHOOT",
  RESTART: "RESTART",
  PING: "PING",
  PONG: "PONG",
  ERROR: "ERROR",
  ROOM_JOINED: "ROOM_JOINED",
  PLAYER_LEFT: "PLAYER_LEFT",
  STATE_UPDATE: "STATE_UPDATE",
  GAME_OVER: "GAME_OVER",
  ROOM_LIST: "ROOM_LIST"
};

export const DIFFICULTIES = {
  NORMAL: "NORMAL"
};
