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
  const activeUsers = new Map(); // userId -> Set<ws>

  // Keep-alive ping interval to prevent Render WS drops
  setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.isAlive === false) return client.terminate();
      client.isAlive = false;
      client.ping();
    });
  }, 30000);

  const broadcastPresence = (userId, isOnline) => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.subscribedPresence && client.subscribedPresence.has(userId)) {
        client.send(JSON.stringify({ type: "presence-update", userId, isOnline }));
      }
    });
  };

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.subscribedPresence = new Set();
    ws.on('pong', () => { ws.isAlive = true; });

    let currentRoomId = null;
    let currentUserId = null;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case "auth": {
            currentUserId = message.userId;
            if (!activeUsers.has(currentUserId)) activeUsers.set(currentUserId, new Set());
            activeUsers.get(currentUserId).add(ws);
            broadcastPresence(currentUserId, true);
            break;
          }
          
          case "subscribe-presence": {
            if (message.friendIds && Array.isArray(message.friendIds)) {
              message.friendIds.forEach(id => ws.subscribedPresence.add(id));
              
              message.friendIds.forEach(id => {
                 const isOnline = activeUsers.has(id) && activeUsers.get(id).size > 0;
                 ws.send(JSON.stringify({ type: "presence-update", userId: id, isOnline }));
              });
            }
            break;
          }

          case "join": {
            currentRoomId = message.roomId;
            currentUserId = message.userId;
            
            if (!activeUsers.has(currentUserId)) activeUsers.set(currentUserId, new Set());
            activeUsers.get(currentUserId).add(ws);
            broadcastPresence(currentUserId, true);

            
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
      if (currentUserId && activeUsers.has(currentUserId)) {
         activeUsers.get(currentUserId).delete(ws);
         if (activeUsers.get(currentUserId).size === 0) {
            activeUsers.delete(currentUserId);
            broadcastPresence(currentUserId, false);
         }
      }

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

  app.get('/ping', (req, res) => res.status(200).send('pong'));

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
