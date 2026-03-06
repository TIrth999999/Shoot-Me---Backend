import { WebSocketServer } from "ws";

export class WsManager {
  constructor({ server }) {
    this.wss = new WebSocketServer({ server });
    this.clients = new Map();
  }

  onConnection(handler) {
    this.wss.on("connection", (socket) => {
      handler(socket);
    });
  }

  attachId(socket, id) {
    socket.id = id;
    this.clients.set(id, socket);
  }

  remove(socketId) {
    this.clients.delete(socketId);
  }

  send(socket, payload) {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  broadcastToRoom(roomId, payload) {
    const encoded = JSON.stringify(payload);
    for (const socket of this.clients.values()) {
      if (socket.roomId !== roomId || socket.readyState !== socket.OPEN) continue;
      socket.send(encoded);
    }
  }
}
