import { MESSAGE_TYPES, SERVER_CONFIG } from "../config/constants.js";
import { clamp, dist2D, normalize2D } from "../util/math.js";

const TICK_MS = Math.floor(1000 / SERVER_CONFIG.tickRate);
const SNAPSHOT_INTERVAL_SEC = 1 / SERVER_CONFIG.snapshotRate;
const roundPos = (v) => Math.round(v * 100) / 100;
const roundYaw = (v) => Math.round(v * 1000) / 1000;

const pickNearestLivingPlayer = (room, zombie) => {
  let nearestId = null;
  let nearestDist = Number.POSITIVE_INFINITY;

  for (const [playerId, player] of Object.entries(room.players)) {
    if (player.isDead) continue;
    const d = dist2D(player.position, zombie.position);
    if (d < nearestDist) {
      nearestDist = d;
      nearestId = playerId;
    }
  }

  return { playerId: nearestId, distance: nearestDist };
};

const isEveryoneDead = (room) => {
  const players = Object.values(room.players);
  if (players.length === 0) return false;
  return players.every((p) => p.isDead);
};

const updateDifficulty = (room) => {
  const mins = room.gameTime / 60;
  const cfg = SERVER_CONFIG.world;
  room.spawnRateSec = Math.max(cfg.spawnMinRateSec, cfg.spawnBaseRateSec - mins * cfg.spawnRampPerMin);
  room.maxZombies = Math.floor(cfg.maxZombiesBase + mins * cfg.maxZombieGrowthPerMin);
};

const spawnZombies = (room, dtSec, roomStore) => {
  const zombieCount = Object.keys(room.zombies).length;
  if (zombieCount >= room.maxZombies) return;

  room.zombieSpawnAccumulator += dtSec;
  while (room.zombieSpawnAccumulator >= room.spawnRateSec && Object.keys(room.zombies).length < room.maxZombies) {
    room.zombieSpawnAccumulator -= room.spawnRateSec;
    roomStore.spawnZombie(room);
  }
};

const updateZombies = (room, dtSec) => {
  const cfg = SERVER_CONFIG.world;
  const speedMultiplier = 1 + (room.gameTime / 60) * cfg.zombieSpeedRampPerMin;
  const speed = cfg.zombieBaseSpeed * speedMultiplier;

  for (const zombie of Object.values(room.zombies)) {
    if (zombie.idle) {
      zombie.targetPlayerId = null;
      continue;
    }

    if (zombie.position.y > 0) {
      zombie.velocityY -= cfg.zombieFallGravity * dtSec;
      zombie.position.y = Math.max(0, zombie.position.y + zombie.velocityY * dtSec);
      room.dirtyZombies.add(zombie.id);
      if (zombie.position.y > 0) {
        continue;
      }
      zombie.velocityY = 0;
    }

    const nearest = pickNearestLivingPlayer(room, zombie);
    zombie.targetPlayerId = nearest.playerId;

    if (!nearest.playerId) continue;
    const targetPlayer = room.players[nearest.playerId];
    const dir = normalize2D(targetPlayer.position.x - zombie.position.x, targetPlayer.position.z - zombie.position.z);

    zombie.position.x += dir.x * speed * dtSec;
    zombie.position.z += dir.z * speed * dtSec;
    room.dirtyZombies.add(zombie.id);

    if (nearest.distance <= cfg.zombieContactRadius + cfg.playerRadius) {
      const now = Date.now();
      if (now - targetPlayer.lastDamagedAt >= cfg.zombieDamageIntervalMs && !targetPlayer.isDead) {
        targetPlayer.lastDamagedAt = now;
        targetPlayer.hp = clamp(targetPlayer.hp - cfg.zombieDamagePerTick, 0, cfg.playerHP);
        if (targetPlayer.hp <= 0) {
          targetPlayer.isDead = true;
        }
        room.dirtyPlayers.add(nearest.playerId);
      }
    }
  }
};

const removeDeadZombies = (room, killerId, zombieId, roomStore) => {
  roomStore.markZombieRemoved(room, zombieId);
  if (killerId && room.players[killerId]) {
    room.players[killerId].score += 10;
    room.dirtyPlayers.add(killerId);
  }
};

const createStateDiff = (room) => {
  const players = {};
  for (const playerId of room.dirtyPlayers) {
    const p = room.players[playerId];
    players[playerId] = p
      ? {
          id: playerId,
          position: {
            x: roundPos(p.position.x),
            y: roundPos(p.position.y || 0),
            z: roundPos(p.position.z)
          },
          rotation: { yaw: roundYaw(p.rotation.yaw || 0) },
          hp: p.hp,
          score: p.score,
          isDead: p.isDead,
          ping: p.ping,
          seq: p.seq
        }
      : { id: playerId, removed: true };
  }

  const zombies = {};
  for (const zombieId of room.dirtyZombies) {
    const z = room.zombies[zombieId];
    if (!z) continue;
    zombies[zombieId] = {
      id: zombieId,
      position: {
        x: roundPos(z.position.x),
        y: roundPos(z.position.y || 0),
        z: roundPos(z.position.z)
      },
      hp: z.hp,
      targetPlayerId: z.targetPlayerId,
      idle: !!z.idle
    };
  }

  const removedZombieIds = room.removedZombieIds.slice();

  room.dirtyPlayers.clear();
  room.dirtyZombies.clear();
  room.removedZombieIds.length = 0;

  return {
    players,
    zombies,
    removedZombieIds,
    gameTime: room.gameTime,
    spawnRateSec: room.spawnRateSec,
    gameOver: room.gameOver,
    serverTs: Date.now()
  };
};

export class GameLoop {
  constructor({ roomStore, wsManager }) {
    this.roomStore = roomStore;
    this.wsManager = wsManager;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  handleShoot({ room, shooterId, direction, origin }) {
    const shooter = room.players[shooterId];
    if (!shooter || shooter.isDead) return;

    const now = Date.now();
    if (now - shooter.lastShootAt < SERVER_CONFIG.world.shootCooldownMs) return;
    shooter.lastShootAt = now;

    let nearestHit = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    const shootOrigin = origin || {
      x: shooter.position.x,
      y: (shooter.position.y || 0) + SERVER_CONFIG.world.playerEyeHeight,
      z: shooter.position.z
    };

    for (const zombie of Object.values(room.zombies)) {
      const bodyBaseY = (zombie.position.y || 0) + SERVER_CONFIG.world.zombieHitBaseY;
      const bodyTopY = bodyBaseY + SERVER_CONFIG.world.zombieHitHeight;
      const bodyMidY = (bodyBaseY + bodyTopY) * 0.5;
      const toZombieX = zombie.position.x - shootOrigin.x;
      const toZombieY = bodyMidY - shootOrigin.y;
      const toZombieZ = zombie.position.z - shootOrigin.z;
      const projected = toZombieX * direction.x + toZombieY * direction.y + toZombieZ * direction.z;

      if (projected < 0 || projected > SERVER_CONFIG.world.bulletRange) continue;

      const closestX = shootOrigin.x + direction.x * projected;
      const closestY = shootOrigin.y + direction.y * projected;
      const closestZ = shootOrigin.z + direction.z * projected;
      const horizontalMiss = Math.hypot(zombie.position.x - closestX, zombie.position.z - closestZ);
      const withinBodyY = closestY >= bodyBaseY && closestY <= bodyTopY;

      if (horizontalMiss <= SERVER_CONFIG.world.zombieHitRadius && withinBodyY && projected < nearestDist) {
        nearestDist = projected;
        nearestHit = zombie;
      }
    }

    if (nearestHit) {
      nearestHit.hp -= 25;
      if (nearestHit.hp <= 0) {
        removeDeadZombies(room, shooterId, nearestHit.id, this.roomStore);
      } else {
        room.dirtyZombies.add(nearestHit.id);
      }
    }
  }

  restartRoom(room) {
    room.zombies = {};
    room.gameTime = 0;
    room.spawnRateSec = SERVER_CONFIG.world.spawnBaseRateSec;
    room.zombieSpawnAccumulator = 0;
    room.snapshotAccumulator = 0;
    room.maxZombies = SERVER_CONFIG.world.maxZombiesBase;
    room.gameOver = false;
    room.gameOverAnnounced = false;
    room.removedZombieIds.length = 0;

    for (const [playerId, player] of Object.entries(room.players)) {
      player.hp = SERVER_CONFIG.world.playerHP;
      player.score = 0;
      player.isDead = false;
      player.position = { x: 0, y: 0, z: 0 };
      room.dirtyPlayers.add(playerId);
    }
  }

  tick(dtSec) {
    for (const room of this.roomStore.rooms.values()) {
      room.gameTime += dtSec;
      room.snapshotAccumulator += dtSec;
      updateDifficulty(room);
      spawnZombies(room, dtSec, this.roomStore);
      updateZombies(room, dtSec);

      if (!room.gameOver && isEveryoneDead(room)) {
        room.gameOver = true;
      }

      if (room.snapshotAccumulator >= SNAPSHOT_INTERVAL_SEC) {
        room.snapshotAccumulator = 0;
        const diff = createStateDiff(room);
        if (
          Object.keys(diff.players).length > 0 ||
          Object.keys(diff.zombies).length > 0 ||
          diff.removedZombieIds.length > 0 ||
          room.gameOver
        ) {
          this.wsManager.broadcastToRoom(room.id, {
            type: MESSAGE_TYPES.STATE_UPDATE,
            ...diff
          });
        }
      }

      if (room.gameOver && !room.gameOverAnnounced) {
        room.gameOverAnnounced = true;
        this.wsManager.broadcastToRoom(room.id, {
          type: MESSAGE_TYPES.GAME_OVER,
          gameTime: room.gameTime
        });
      }
    }
  }
}
