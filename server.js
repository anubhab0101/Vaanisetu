import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import Razorpay from "razorpay";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "crypto";

dotenv.config();

let adminDb = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('ascii'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    admin.initializeApp();
  }
  // Connect to the specific named database used on the frontend!
  adminDb = getFirestore(admin.app(), 'ai-studio-d5fada93-c575-4056-a5ca-c8a98edf9c90');
} catch (e) {
  console.warn("Firebase Admin Init Warning (Ensure env is setup):", e.message);
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_missing_key",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "missing_secret",
});

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
              room: roomData // messages is not used anymore for history
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
              } else if (message.action === "remove-video") {
                r.videoState.videoUrl = null;
                r.videoState.currentTime = 0;
                r.videoState.isPlaying = false;
                // No messages to clear anymore
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
              // Note: We no longer store messages in `rooms.get(currentRoomId).messages.push(newMsg)`
              // This ensures new guests do not receive past chat history (Approach B).

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
          case "leave": {
            if (currentRoomId && connections.has(currentRoomId)) {
               connections.get(currentRoomId).delete(ws);
               
               if (connections.get(currentRoomId).size === 0) {
                 connections.delete(currentRoomId);
                 rooms.delete(currentRoomId);
               } else {
                 let leftUserName = 'A user';
                 if (rooms.has(currentRoomId) && rooms.get(currentRoomId).users[currentUserId]) {
                    leftUserName = rooms.get(currentRoomId).users[currentUserId].displayName;
                    delete rooms.get(currentRoomId).users[currentUserId];
                 }

                 connections.get(currentRoomId).forEach(client => {
                   if (client.readyState === WebSocket.OPEN) {
                     client.send(JSON.stringify({ type: "user-left", userId: currentUserId, userName: leftUserName }));
                   }
                 });
               }
               currentRoomId = null;
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
          rooms.delete(currentRoomId);
        } else {
          let leftUserName = 'A user';
          if (rooms.has(currentRoomId) && rooms.get(currentRoomId).users[currentUserId]) {
             leftUserName = rooms.get(currentRoomId).users[currentUserId].displayName;
             delete rooms.get(currentRoomId).users[currentUserId];
          }

          connections.get(currentRoomId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "user-left", userId: currentUserId, userName: leftUserName }));
            }
          });
        }
      }
    });
  });

  app.use(cors());
  app.use(express.json());

  app.get('/ping', (req, res) => res.status(200).send('pong'));

  // Razorpay Endpoints
  app.post('/api/create-order', async (req, res) => {
    try {
      const { amount, plan } = req.body;
      const options = {
        amount: amount * 100, // paise
        currency: "INR",
        receipt: "rcpt_" + Math.random().toString(36).substring(7),
        notes: { plan }
      };
      const order = await razorpay.orders.create(options);
      res.json({ ...order, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/verify-payment', async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, plan, amount } = req.body;
      const text = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                      .update(text.toString())
                                      .digest('hex');

      if (expectedSignature === razorpay_signature) {
        // Payment is authentic. Log transaction and update user subscription if DB is ready.
        if (adminDb && userId) {
           let durationDays = 0;
           if (plan === 'one-time') durationDays = 1;
           if (plan === 'weekly') durationDays = 7;
           if (plan === 'monthly') durationDays = 30;

           const expiryDate = Date.now() + (durationDays * 24 * 60 * 60 * 1000);
           
           // Update User
           await adminDb.collection('users').doc(userId).update({
              activeSubscription: plan,
              subscriptionExpiry: expiryDate
           });

           // Log Payment
           await adminDb.collection('payments').add({
              userId,
              paymentId: razorpay_payment_id,
              orderId: razorpay_order_id,
              amount: amount,
              plan,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
           });
        }
        res.json({ success: true, message: "Payment verified successfully" });
      } else {
        res.status(400).json({ success: false, message: "Invalid Signature" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin and Code Redemption Routes
  app.post('/api/redeem-code', async (req, res) => {
    try {
      const { code, userId } = req.body;
      if (!adminDb || !userId) return res.status(400).json({ error: "DB not initialized or User ID missing" });

      const cleanCode = code.replace(/-/g, '').toUpperCase();
      const codesRef = adminDb.collection('accessCodes');
      const snap = await codesRef.where('code', '==', cleanCode).get();
      
      if (snap.empty) return res.status(400).json({ error: "Code not found" });

      const codeDoc = snap.docs[0];
      const data = codeDoc.data();

      if (data.usages >= data.maxUses) return res.status(400).json({ error: "Code limit reached" });

      const durationDays = data.durationDays || 1;
      const expiryDate = Date.now() + (durationDays * 24 * 60 * 60 * 1000);
      
      await adminDb.collection('users').doc(userId).update({
         activeSubscription: "access-code",
         subscriptionExpiry: expiryDate
      });
      
      await codesRef.doc(codeDoc.id).update({
         usages: data.usages + 1
      });

      res.json({ success: true, message: "Code redeemed successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Verification failed on server" });
    }
  });

  app.post('/api/generate-code', async (req, res) => {
    try {
      const { durationDays, maxUses, adminEmail } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });

      const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let newCode = '';
      for(let i=0; i<16; i++) {
         newCode += charset.charAt(Math.floor(Math.random() * charset.length));
      }

      await adminDb.collection('accessCodes').doc(newCode).set({
          code: newCode,
          durationDays: durationDays,
          maxUses: maxUses,
          usages: 0,
          createdBy: adminEmail,
          createdAt: Date.now()
      });

      res.json({ success: true, code: newCode });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ledger', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });

      const usersSnap = await adminDb.collection('users').get();
      const userStatus = {};
      usersSnap.forEach(u => {
          userStatus[u.id] = {
              sub: u.data().activeSubscription,
              exp: u.data().subscriptionExpiry
          };
      });

      const snap = await adminDb.collection('payments').orderBy('timestamp', 'desc').get();
      const payments = [];
      snap.forEach(d => {
          const pd = d.data();
          const us = userStatus[pd.userId] || {};
          payments.push({ id: d.id, ...pd, currentSub: us.sub, currentExp: us.exp });
      });

      res.json({ success: true, payments });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin-update-sub', async (req, res) => {
    try {
      const { adminEmail, targetUserId, action, extendDays } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });

      const userRef = adminDb.collection('users').doc(targetUserId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ error: "User not found" });

      if (action === 'cancel') {
         await userRef.update({
            activeSubscription: null,
            subscriptionExpiry: 0
         });
      } else if (action === 'extend') {
         const days = parseInt(extendDays) || 1;
         const currentData = userSnap.data();
         const baseTime = (currentData.subscriptionExpiry && currentData.subscriptionExpiry > Date.now()) 
                           ? currentData.subscriptionExpiry : Date.now();
         const newExpiry = baseTime + (days * 24 * 60 * 60 * 1000);
         await userRef.update({
            activeSubscription: "extended_by_admin",
            subscriptionExpiry: newExpiry
         });
      }

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/code-users', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });

      const snap = await adminDb.collection('users')
        .where('activeSubscription', '==', 'access-code')
        .get();

      const users = [];
      snap.forEach(doc => {
        const d = doc.data();
        users.push({
          userId: doc.id,
          displayName: d.displayName || 'Unknown',
          email: d.email || '',
          roomCode: d.roomCode || '',
          subscriptionExpiry: d.subscriptionExpiry || 0,
          activeSubscription: d.activeSubscription
        });
      });

      res.json({ success: true, users });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/check-room-access', async (req, res) => {
    try {
      const { roomCode } = req.query;
      if (!adminDb || !roomCode) return res.status(400).json({ error: "Missing parameters" });

      const cleanCode = roomCode.trim().toUpperCase();
      const usersRef = adminDb.collection('users');
      const snap = await usersRef.where('roomCode', '==', cleanCode).get();
      
      if (snap.empty) {
        return res.json({ success: false, hostSubscribed: false, error: "Room not found" });
      }

      const hostData = snap.docs[0].data();
      const isValid = hostData.activeSubscription && hostData.subscriptionExpiry > Date.now();

      return res.json({ success: true, hostSubscribed: !!isValid });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to check room access" });
    }
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
