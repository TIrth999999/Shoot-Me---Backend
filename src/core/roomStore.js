import { nanoid } from "nanoid";
import { DIFFICULTIES, SERVER_CONFIG } from "../config/constants.js";
import { nowMs, randomSpawnPoint, vec3 } from "../util/math.js";

const createInitialPlayerState = () => ({
  position: vec3(),
  rotation: { yaw: 0 },
  hp: SERVER_CONFIG.world.playerHP,
  score: 0,
  isDead: false,
  lastMoveAt: nowMs(),
  lastShootAt: 0,
  lastDamagedAt: 0,
  seq: 0,
  ping: 0
});

const createRoomState = (ownerSocketId) => ({
  id: nanoid(8),
  ownerSocketId,
  players: {},
  zombies: {},
  difficulty: DIFFICULTIES.NORMAL,
  spawnRateSec: SERVER_CONFIG.world.spawnBaseRateSec,
  gameTime: 0,
  zombieCounter: 0,
  zombieSpawnAccumulator: 0,
  snapshotAccumulator: 0,
  maxZombies: SERVER_CONFIG.world.maxZombiesBase,
  lastBroadcastState: {
    players: {},
    zombies: {}
  },
  dirtyPlayers: new Set(),
  dirtyZombies: new Set(),
  removedZombieIds: [],
  gameOver: false,
  gameOverAnnounced: false
});

export class RoomStore {
  constructor() {
    this.rooms = new Map();
    this.socketToRoom = new Map();
  }

  createRoom(ownerSocketId) {
    const room = createRoomState(ownerSocketId);
    this.rooms.set(room.id, room);
    return room;
  }

  listRooms() {
    const output = [];
    for (const room of this.rooms.values()) {
      output.push({
        roomId: room.id,
        players: Object.keys(room.players).length,
        maxPlayers: SERVER_CONFIG.maxPlayersPerRoom,
        difficulty: room.difficulty,
        gameTime: Math.floor(room.gameTime)
      });
    }
    return output;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomBySocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  addPlayerToRoom(room, socketId) {
    if (Object.keys(room.players).length >= SERVER_CONFIG.maxPlayersPerRoom) {
      return { ok: false, reason: "ROOM_FULL" };
    }

    room.players[socketId] = createInitialPlayerState();
    room.dirtyPlayers.add(socketId);
    this.socketToRoom.set(socketId, room.id);
    return { ok: true };
  }

  removePlayer(socketId) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;

    delete room.players[socketId];
    room.dirtyPlayers.add(socketId);
    this.socketToRoom.delete(socketId);

    const remaining = Object.keys(room.players).length;
    if (remaining === 0) {
      this.rooms.delete(room.id);
      return { roomDeleted: true, roomId: room.id };
    }

    if (room.ownerSocketId === socketId) {
      room.ownerSocketId = Object.keys(room.players)[0] || null;
    }

    return { roomDeleted: false, roomId: room.id };
  }

  markZombieRemoved(room, zombieId) {
    room.removedZombieIds.push(zombieId);
    room.dirtyZombies.delete(zombieId);
    delete room.zombies[zombieId];
  }

  spawnZombie(room) {
    const id = `z_${room.zombieCounter++}`;
    const spawn = randomSpawnPoint(SERVER_CONFIG.world.width, SERVER_CONFIG.world.depth);
    spawn.y =
      SERVER_CONFIG.world.zombieSpawnHeightMin +
      Math.random() * (SERVER_CONFIG.world.zombieSpawnHeightMax - SERVER_CONFIG.world.zombieSpawnHeightMin);
    room.zombies[id] = {
      id,
      position: spawn,
      velocityY: 0,
      hp: SERVER_CONFIG.world.zombieHP,
      targetPlayerId: null
    };
    room.dirtyZombies.add(id);
  }
}
