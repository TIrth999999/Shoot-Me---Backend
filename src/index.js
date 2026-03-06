import express from "express";
import http from "http";
import { SERVER_CONFIG } from "./config/constants.js";
import { GameLoop } from "./core/gameLoop.js";
import { RoomStore } from "./core/roomStore.js";
import { registerSocketHandlers } from "./network/socketHandlers.js";
import { WsManager } from "./network/wsManager.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ts: Date.now() });
});

const server = http.createServer(app);
const wsManager = new WsManager({ server });
const roomStore = new RoomStore();
const gameLoop = new GameLoop({ roomStore, wsManager });

registerSocketHandlers({ wsManager, roomStore, gameLoop });
gameLoop.start();

server.listen(SERVER_CONFIG.port, () => {
  console.log(`[server] running on :${SERVER_CONFIG.port}`);
});