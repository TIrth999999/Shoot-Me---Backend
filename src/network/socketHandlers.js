import { nanoid } from "nanoid";
import { MESSAGE_TYPES, SERVER_CONFIG } from "../config/constants.js";
import { dist2D } from "../util/math.js";
import { parseJson, sanitizeDirection, sanitizePosition, sanitizeRotation, sanitizeString } from "./validators.js";

const sendError = (wsManager, socket, code, message) => {
  wsManager.send(socket, {
    type: MESSAGE_TYPES.ERROR,
    code,
    message
  });
};

const emitRoomList = (wsManager, roomStore, socket) => {
  wsManager.send(socket, {
    type: MESSAGE_TYPES.ROOM_LIST,
    rooms: roomStore.listRooms()
  });
};

const joinRoom = ({ wsManager, roomStore, socket, room }) => {
  if (!room) {
    sendError(wsManager, socket, "ROOM_NOT_FOUND", "Room not found");
    return;
  }

  const joined = roomStore.addPlayerToRoom(room, socket.id);
  if (!joined.ok) {
    sendError(wsManager, socket, joined.reason, "Unable to join room");
    return;
  }

  socket.roomId = room.id;
  const playerSnapshots = {};
  for (const [id, p] of Object.entries(room.players)) {
    playerSnapshots[id] = {
      id,
      position: p.position,
      rotation: p.rotation,
      hp: p.hp,
      score: p.score,
      isDead: p.isDead,
      ping: p.ping,
      seq: p.seq
    };
  }

  wsManager.send(socket, {
    type: MESSAGE_TYPES.ROOM_JOINED,
    roomId: room.id,
    selfId: socket.id,
    difficulty: room.difficulty,
    players: playerSnapshots,
    zombies: room.zombies,
    gameTime: room.gameTime,
    spawnRateSec: room.spawnRateSec
  });

  wsManager.broadcastToRoom(room.id, {
    type: MESSAGE_TYPES.STATE_UPDATE,
    players: {
      [socket.id]: playerSnapshots[socket.id]
    },
    zombies: {},
    removedZombieIds: [],
    gameTime: room.gameTime,
    spawnRateSec: room.spawnRateSec,
    gameOver: room.gameOver,
    serverTs: Date.now()
  });
};

export const registerSocketHandlers = ({ wsManager, roomStore, gameLoop }) => {
  wsManager.onConnection((socket) => {
    const socketId = nanoid(10);
    wsManager.attachId(socket, socketId);
    emitRoomList(wsManager, roomStore, socket);

    socket.on("message", (raw) => {
      const msg = parseJson(raw);
      if (!msg?.type) return;

      switch (msg.type) {
        case MESSAGE_TYPES.CREATE_ROOM: {
          const existing = roomStore.getRoomBySocket(socket.id);
          if (existing) {
            sendError(wsManager, socket, "ALREADY_IN_ROOM", "Leave current room first");
            break;
          }
          const room = roomStore.createRoom(socket.id);
          joinRoom({ wsManager, roomStore, socket, room });
          break;
        }

        case MESSAGE_TYPES.JOIN_ROOM: {
          const existing = roomStore.getRoomBySocket(socket.id);
          if (existing) {
            sendError(wsManager, socket, "ALREADY_IN_ROOM", "Leave current room first");
            break;
          }
          const roomId = sanitizeString(msg.roomId, 16);
          joinRoom({ wsManager, roomStore, socket, room: roomStore.getRoom(roomId) });
          break;
        }

        case MESSAGE_TYPES.LEAVE_ROOM: {
          const result = roomStore.removePlayer(socket.id);
          socket.roomId = null;
          if (result && !result.roomDeleted) {
            wsManager.broadcastToRoom(result.roomId, {
              type: MESSAGE_TYPES.PLAYER_LEFT,
              playerId: socket.id
            });
          }
          emitRoomList(wsManager, roomStore, socket);
          break;
        }

        case MESSAGE_TYPES.PLAYER_MOVE: {
          const room = roomStore.getRoomBySocket(socket.id);
          if (!room) break;

          const player = room.players[socket.id];
          if (!player || player.isDead) break;

          const sanitizedPosition = sanitizePosition(msg.position, SERVER_CONFIG.world);
          if (!sanitizedPosition) break;

          const sanitizedRotation = sanitizeRotation(msg.rotation);
          const delta = dist2D(player.position, sanitizedPosition);
          const yawDelta = Math.abs((player.rotation?.yaw || 0) - (sanitizedRotation?.yaw || 0));
          if (delta < SERVER_CONFIG.world.minMoveDelta && yawDelta < SERVER_CONFIG.world.minYawDelta) {
            break;
          }
          if (delta > SERVER_CONFIG.world.antiCheatMaxMovePerTick) {
            break;
          }

          player.position = sanitizedPosition;
          player.rotation = sanitizedRotation;
          player.seq = typeof msg.seq === "number" ? msg.seq : player.seq;
          player.lastMoveAt = Date.now();
          room.dirtyPlayers.add(socket.id);
          break;
        }

        case MESSAGE_TYPES.SHOOT: {
          const room = roomStore.getRoomBySocket(socket.id);
          if (!room) break;

          const direction = sanitizeDirection(msg.direction);
          if (!direction) break;

          gameLoop.handleShoot({
            room,
            shooterId: socket.id,
            direction
          });
          break;
        }

        case MESSAGE_TYPES.RESTART: {
          const room = roomStore.getRoomBySocket(socket.id);
          if (!room) break;
          gameLoop.restartRoom(room);
          break;
        }

        case MESSAGE_TYPES.PING: {
          const room = roomStore.getRoomBySocket(socket.id);
          if (room?.players[socket.id] && typeof msg.clientTs === "number") {
            const latency = Math.max(0, Date.now() - msg.clientTs);
            room.players[socket.id].ping = latency;
            room.dirtyPlayers.add(socket.id);
          }

          wsManager.send(socket, {
            type: MESSAGE_TYPES.PONG,
            clientTs: msg.clientTs,
            serverTs: Date.now()
          });
          break;
        }

        default:
          break;
      }
    });

    socket.on("close", () => {
      const result = roomStore.removePlayer(socket.id);
      wsManager.remove(socket.id);
      if (result && !result.roomDeleted) {
        wsManager.broadcastToRoom(result.roomId, {
          type: MESSAGE_TYPES.PLAYER_LEFT,
          playerId: socket.id
        });
      }
    });

    socket.on("error", () => {
      const result = roomStore.removePlayer(socket.id);
      wsManager.remove(socket.id);
      if (result && !result.roomDeleted) {
        wsManager.broadcastToRoom(result.roomId, {
          type: MESSAGE_TYPES.PLAYER_LEFT,
          playerId: socket.id
        });
      }
    });
  });
};
