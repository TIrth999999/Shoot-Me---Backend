import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS_PER_ROOM = 4;

const MESSAGE_TYPES = {
  HELLO: "HELLO",
  CREATE_ROOM: "CREATE_ROOM",
  JOIN_ROOM: "JOIN_ROOM",
  LEAVE_ROOM: "LEAVE_ROOM",
  ROOM_LIST: "ROOM_LIST",
  ROOM_JOINED: "ROOM_JOINED",
  SIGNAL: "SIGNAL",
  PEER_JOINED: "PEER_JOINED",
  PEER_LEFT: "PEER_LEFT",
  PING: "PING",
  PONG: "PONG",
  ERROR: "ERROR"
};

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "signaling", uptime: process.uptime(), ts: Date.now() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const roomHosts = new Map();
const roomMembers = new Map();
const clientRoom = new Map();

const parseJson = (raw) => {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
};

const send = (socket, payload) => {
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
};

const sendById = (clientId, payload) => {
  const socket = clients.get(clientId);
  send(socket, payload);
};

const listRooms = () => {
  const rooms = [];
  for (const [roomId, members] of roomMembers.entries()) {
    const hostId = roomHosts.get(roomId);
    if (!hostId || !members?.size || !members.has(hostId)) continue;
    rooms.push({
      roomId,
      players: members.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM
    });
  }
  return rooms;
};

const broadcastRoomList = () => {
  const payload = { type: MESSAGE_TYPES.ROOM_LIST, rooms: listRooms() };
  for (const socket of clients.values()) {
    send(socket, payload);
  }
};

const leaveRoom = (clientId) => {
  const roomId = clientRoom.get(clientId);
  if (!roomId) return;

  const members = roomMembers.get(roomId);
  const hostId = roomHosts.get(roomId);
  clientRoom.delete(clientId);

  if (members) {
    members.delete(clientId);
  }

  if (!members || members.size === 0 || clientId === hostId) {
    if (members) {
      for (const memberId of members) {
        sendById(memberId, { type: MESSAGE_TYPES.PEER_LEFT, peerId: clientId, roomId });
        clientRoom.delete(memberId);
      }
    }
    roomMembers.delete(roomId);
    roomHosts.delete(roomId);
    broadcastRoomList();
    return;
  }

  sendById(hostId, { type: MESSAGE_TYPES.PEER_LEFT, peerId: clientId, roomId });
  for (const memberId of members) {
    if (memberId === clientId) continue;
    sendById(memberId, { type: MESSAGE_TYPES.PEER_LEFT, peerId: clientId, roomId });
  }
  broadcastRoomList();
};

wss.on("connection", (socket) => {
  const selfId = nanoid(10);
  clients.set(selfId, socket);
  send(socket, { type: MESSAGE_TYPES.HELLO, selfId });
  send(socket, { type: MESSAGE_TYPES.ROOM_LIST, rooms: listRooms() });

  socket.on("message", (raw) => {
    const msg = parseJson(raw);
    if (!msg?.type) return;

    if (msg.type === MESSAGE_TYPES.CREATE_ROOM) {
      if (clientRoom.has(selfId)) {
        send(socket, { type: MESSAGE_TYPES.ERROR, code: "ALREADY_IN_ROOM", message: "Already in room" });
        return;
      }
      const roomId = nanoid(8);
      roomHosts.set(roomId, selfId);
      roomMembers.set(roomId, new Set([selfId]));
      clientRoom.set(selfId, roomId);
      send(socket, { type: MESSAGE_TYPES.ROOM_JOINED, roomId, selfId, hostId: selfId, isHost: true });
      broadcastRoomList();
      return;
    }

    if (msg.type === MESSAGE_TYPES.JOIN_ROOM) {
      if (clientRoom.has(selfId)) {
        send(socket, { type: MESSAGE_TYPES.ERROR, code: "ALREADY_IN_ROOM", message: "Already in room" });
        return;
      }
      const roomId = typeof msg.roomId === "string" ? msg.roomId.trim().slice(0, 32) : "";
      if (!roomId || !roomMembers.has(roomId)) {
        send(socket, { type: MESSAGE_TYPES.ERROR, code: "ROOM_NOT_FOUND", message: "Room not found" });
        return;
      }
      const members = roomMembers.get(roomId);
      if (!members) {
        send(socket, { type: MESSAGE_TYPES.ERROR, code: "ROOM_NOT_FOUND", message: "Room not found" });
        return;
      }
      if (members.size >= MAX_PLAYERS_PER_ROOM) {
        send(socket, { type: MESSAGE_TYPES.ERROR, code: "ROOM_FULL", message: "Room is full" });
        return;
      }

      const hostId = roomHosts.get(roomId);
      if (!hostId || !members.has(hostId)) {
        send(socket, { type: MESSAGE_TYPES.ERROR, code: "ROOM_CLOSED", message: "Host is offline" });
        return;
      }

      members.add(selfId);
      clientRoom.set(selfId, roomId);

      send(socket, { type: MESSAGE_TYPES.ROOM_JOINED, roomId, selfId, hostId, isHost: false });
      sendById(hostId, { type: MESSAGE_TYPES.PEER_JOINED, roomId, peerId: selfId });
      broadcastRoomList();
      return;
    }

    if (msg.type === MESSAGE_TYPES.LEAVE_ROOM) {
      leaveRoom(selfId);
      send(socket, { type: MESSAGE_TYPES.ROOM_LIST, rooms: listRooms() });
      return;
    }

    if (msg.type === MESSAGE_TYPES.SIGNAL) {
      const roomId = clientRoom.get(selfId);
      const to = typeof msg.to === "string" ? msg.to.trim() : "";
      if (!roomId || !to) return;
      const members = roomMembers.get(roomId);
      if (!members || !members.has(to)) return;

      sendById(to, {
        type: MESSAGE_TYPES.SIGNAL,
        roomId,
        from: selfId,
        data: msg.data || null
      });
      return;
    }

    if (msg.type === MESSAGE_TYPES.PING) {
      send(socket, { type: MESSAGE_TYPES.PONG, clientTs: msg.clientTs, serverTs: Date.now() });
    }
  });

  socket.on("close", () => {
    leaveRoom(selfId);
    clients.delete(selfId);
  });

  socket.on("error", () => {
    leaveRoom(selfId);
    clients.delete(selfId);
  });
});

server.listen(PORT, () => {
  console.log(`[signaling] running on :${PORT}`);
});
