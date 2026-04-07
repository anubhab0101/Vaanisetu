import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const PORT = process.env.PORT || 3000;

  // In-memory state
  const rooms = new Map();
  const connections = new Map();

  wss.on("connection", (ws, req) => {
    let currentRoomId = null;
    let currentUserId = null;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case "join": {
            currentRoomId = message.roomId;
            currentUserId = message.userId;
            
            if (!rooms.has(currentRoomId)) {
              rooms.set(currentRoomId, {
                id: currentRoomId,
                name: message.roomName || 'Guest Room',
                ownerId: message.userId,
                videoState: { currentTime: 0, isPlaying: false, lastUpdated: Date.now(), videoUrl: message.videoUrl || '' },
                messages: [],
                users: {}
              });
            }
            if (!connections.has(currentRoomId)) {
              connections.set(currentRoomId, new Set());
            }
            connections.get(currentRoomId).add(ws);
            
            const roomData = rooms.get(currentRoomId);
            roomData.users[currentUserId] = { displayName: message.userName || 'Guest' };

            // Send current room state back to the joiner
            ws.send(JSON.stringify({
              type: "room-state",
              room: roomData
            }));
            
            // Notify others
            connections.get(currentRoomId).forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "user-joined", userId: currentUserId, userName: message.userName || 'Guest' }));
              }
            });
            break;
          }

          case "sync": {
            if (currentRoomId && rooms.has(currentRoomId)) {
              const r = rooms.get(currentRoomId);
              if (message.action === "update-url") {
                r.videoState.videoUrl = message.videoUrl;
                r.videoState.currentTime = 0;
                r.videoState.isPlaying = false;
              } else if (message.action === "play" || message.action === "pause" || message.action === "seek") {
                r.videoState.currentTime = message.time;
                r.videoState.isPlaying = message.action === "play";
                r.videoState.lastUpdated = message.timestamp;
              }

              connections.get(currentRoomId).forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ 
                    type: "sync", 
                    action: message.action, 
                    time: message.time,
                    timestamp: message.timestamp,
                    videoUrl: message.videoUrl
                  }));
                }
              });
            }
            break;
          }

          case "request-sync": {
            if (currentRoomId && rooms.has(currentRoomId)) {
               const state = rooms.get(currentRoomId).videoState;
               ws.send(JSON.stringify({
                 type: "sync",
                 action: state.isPlaying ? "play" : "pause",
                 time: state.currentTime,
                 timestamp: state.lastUpdated,
                 videoUrl: state.videoUrl
               }));
            }
            break;
          }

          case "chat": {
            if (currentRoomId && rooms.has(currentRoomId)) {
              const newMsg = {
                id: Math.random().toString(36).substring(7),
                text: message.text,
                senderId: currentUserId,
                senderName: message.userName || 'Guest',
                timestamp: Date.now()
              };
              rooms.get(currentRoomId).messages.push(newMsg);

              connections.get(currentRoomId).forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ 
                    type: "chat", 
                    message: newMsg
                  }));
                }
              });
            }
            break;
          }

          case "update-settings": {
            if (currentRoomId && rooms.has(currentRoomId)) {
              if (message.roomName) {
                rooms.get(currentRoomId).name = message.roomName;
              }
              connections.get(currentRoomId).forEach(client => {
                 if (client.readyState === WebSocket.OPEN) {
                   client.send(JSON.stringify({ type: "room-updated", name: message.roomName }));
                 }
              });
            }
            break;
          }
        }
      } catch (e) {
        console.error("WS error:", e);
      }
    });

    ws.on("close", () => {
      if (currentRoomId && connections.has(currentRoomId)) {
         connections.get(currentRoomId).delete(ws);
        
        if (connections.get(currentRoomId).size === 0) {
          connections.delete(currentRoomId);
        } else {
          connections.get(currentRoomId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "user-left", userId: currentUserId }));
            }
          });
        }
      }
    });
  });

  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Vanilla JS Server running on http://localhost:${PORT}`);
  });
}

startServer();
