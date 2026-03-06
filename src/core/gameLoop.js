import { MESSAGE_TYPES, SERVER_CONFIG } from "../config/constants.js";
import { clamp, dist2D, normalize2D } from "../util/math.js";

const TICK_MS = Math.floor(1000 / SERVER_CONFIG.tickRate);

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
          position: p.position,
          rotation: p.rotation,
          hp: p.hp,
          score: p.score,
          isDead: p.isDead,
          ping: p.ping
        }
      : { id: playerId, removed: true };
  }

  const zombies = {};
  for (const zombieId of room.dirtyZombies) {
    const z = room.zombies[zombieId];
    if (!z) continue;
    zombies[zombieId] = {
      id: zombieId,
      position: z.position,
      hp: z.hp,
      targetPlayerId: z.targetPlayerId
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
    gameOver: room.gameOver
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

  handleShoot({ room, shooterId, direction }) {
    const shooter = room.players[shooterId];
    if (!shooter || shooter.isDead) return;

    const now = Date.now();
    if (now - shooter.lastShootAt < SERVER_CONFIG.world.shootCooldownMs) return;
    shooter.lastShootAt = now;

    let nearestHit = null;
    let nearestDist = Number.POSITIVE_INFINITY;

    for (const zombie of Object.values(room.zombies)) {
      const toZombieX = zombie.position.x - shooter.position.x;
      const toZombieZ = zombie.position.z - shooter.position.z;
      const projected = toZombieX * direction.x + toZombieZ * direction.z;

      if (projected < 0 || projected > SERVER_CONFIG.world.bulletRange) continue;

      const closestX = shooter.position.x + direction.x * projected;
      const closestZ = shooter.position.z + direction.z * projected;
      const missDist = Math.hypot(zombie.position.x - closestX, zombie.position.z - closestZ);

      if (missDist <= SERVER_CONFIG.world.bulletRadius && projected < nearestDist) {
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
      updateDifficulty(room);
      spawnZombies(room, dtSec, this.roomStore);
      updateZombies(room, dtSec);

      if (!room.gameOver && isEveryoneDead(room)) {
        room.gameOver = true;
      }

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
