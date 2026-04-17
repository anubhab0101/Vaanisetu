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

// ✅ Admin always has full access — no payment required ever
const ADMIN_EMAIL = 'anubhabmohapatra.01@gmail.com';
const isAdmin = (email) => email === ADMIN_EMAIL;


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
  app.use(express.json({ limit: '10mb' })); // 10mb for base64 poster images

  // ================================================================
  // SECURITY HEADERS — Fixes PageSpeed Insights Best Practices errors
  // ================================================================
  app.use((req, res, next) => {
    // Force HTTPS on production (Render)
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Cross-Origin isolation
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    // Permissions policy
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")');
    // HSTS (only on HTTPS)
    if (req.headers['x-forwarded-proto'] === 'https' || req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com https://www.gstatic.com https://www.googleapis.com https://apis.google.com https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https: blob:; " +
      "media-src 'self' blob: https:; " +
      "connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firestore.googleapis.com https://api.razorpay.com https://vaanisethu-bot.onrender.com wss:; " +
      "frame-src https://checkout.razorpay.com https://api.razorpay.com https://accounts.google.com https://*.firebaseapp.com; " +
      "worker-src 'self' blob:;"
    );
    next();
  });

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

      const hostDoc = snap.docs[0];
      const hostData = hostDoc.data();
      const hostUid = hostDoc.id;

      // ✅ Admin is always subscribed — look up email via Firebase Auth
      try {
        const hostAuthRecord = await admin.auth().getUser(hostUid);
        if (isAdmin(hostAuthRecord.email || '')) {
          return res.json({ success: true, hostSubscribed: true });
        }
      } catch (authErr) {
        console.warn('Could not fetch host auth record:', authErr.message);
      }

      const isValid = hostData.activeSubscription && hostData.subscriptionExpiry > Date.now();

      // ✅ NEW: Also allow guests if host is on their first-time free pass day
      const isOnFreePass = hostData.freePassActive === true &&
                           hostData.freePassExpiry &&
                           hostData.freePassExpiry > Date.now();

      return res.json({ success: true, hostSubscribed: !!(isValid || isOnFreePass) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to check room access" });
    }
  });

  // ================================================================
  // VISITOR COUNTER, FREE PASS & FREE DAY ROUTES
  // ================================================================

  // Register a new unique visitor (called once on first-time account creation)
  app.post('/api/register-visitor', async (req, res) => {
    try {
      const { userId, displayName } = req.body;
      if (!adminDb || !userId) return res.status(400).json({ error: "Missing parameters" });
      // Idempotent — if already registered, ignore
      const visitorRef = adminDb.collection('visitors').doc(userId);
      const existing = await visitorRef.get();
      if (!existing.exists) {
        await visitorRef.set({ userId, displayName: displayName || 'Unknown', visitedAt: Date.now() });
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get total unique visitor count (admin only)
  app.get('/api/visitor-stats', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });
      const snap = await adminDb.collection('visitors').get();
      res.json({ success: true, totalVisitors: snap.size });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get platform config (public) — freeDayActive status
  app.get('/api/platform-config', async (req, res) => {
    try {
      const configRef = adminDb.collection('config').doc('platformSettings');
      const snap = await configRef.get();
      const freeDayActive = snap.exists ? (snap.data().freeDayActive === true) : false;
      res.json({ success: true, freeDayActive });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Set Free Day toggle on/off
  app.post('/api/admin/set-free-day', async (req, res) => {
    try {
      const { adminEmail, freeDayActive } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });
      await adminDb.collection('config').doc('platformSettings').set(
        { freeDayActive: !!freeDayActive },
        { merge: true }
      );
      res.json({ success: true, freeDayActive: !!freeDayActive });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Claim first-time free pass (anti-abuse: fingerprint + IP check)
  app.post('/api/claim-free-pass', async (req, res) => {
    try {
      const { userId, fingerprint, localKey } = req.body;
      if (!adminDb || !userId) return res.status(400).json({ error: "Missing parameters" });

      // REQUIRE fingerprint — if client couldn't generate one, reject
      if (!fingerprint || fingerprint.trim() === '') {
        return res.status(400).json({ 
          success: false, 
          error: "Device fingerprint not ready. Please wait a moment and try again." 
        });
      }

      const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      const claimsRef = adminDb.collection('freePassClaims');

      // 1. Fingerprint check — same device, different account
      const fpSnap = await claimsRef.where('fingerprint', '==', fingerprint).limit(1).get();
      if (!fpSnap.empty) {
        return res.status(403).json({ 
          success: false, 
          error: "Free pass already claimed on this device. Please purchase a plan to continue." 
        });
      }

      // 2. IP check — same network/router, different account (applies everywhere including localhost)
      if (ip) {
        const ipSnap = await claimsRef.where('ip', '==', ip).limit(1).get();
        if (!ipSnap.empty) {
          return res.status(403).json({ 
            success: false, 
            error: "Free pass already used from this network. Please purchase a plan to continue." 
          });
        }
      }

      // 3. localKey check — localStorage token sent by client (added as extra safety layer)
      if (localKey && localKey.trim() !== '') {
        const lkSnap = await claimsRef.where('localKey', '==', localKey).limit(1).get();
        if (!lkSnap.empty) {
          return res.status(403).json({ 
            success: false, 
            error: "Free pass already claimed from this browser. Please purchase a plan." 
          });
        }
      }

      // 4. userId direct check
      const userClaimSnap = await claimsRef.where('userId', '==', userId).limit(1).get();
      if (!userClaimSnap.empty) {
        return res.status(403).json({ 
          success: false, 
          error: "You have already used your free pass." 
        });
      }

      // All checks passed — grant 24hr free pass
      const freePassExpiry = Date.now() + (24 * 60 * 60 * 1000);

      // Save claim record
      await claimsRef.add({ 
        userId, 
        fingerprint, 
        ip, 
        localKey: localKey || '', 
        claimedAt: Date.now() 
      });

      // Update user document
      await adminDb.collection('users').doc(userId).update({
        freePassActive: true,
        freePassExpiry,
        freePassClaimedAt: Date.now()
      });

      res.json({ success: true, freePassExpiry, message: "Free pass activated! Enjoy 24 hours of free access." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });


  // ==== FILM STORE ROUTES ====

  // Admin: Add a new film
  app.post('/api/admin/add-film', async (req, res) => {
    try {
      const { adminEmail, title, telegramLink, thumbnailBase64, price, rentalDays } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });
      if (!title || !telegramLink) return res.status(400).json({ error: "Title and Telegram link required" });

      const filmRef = await adminDb.collection('films').add({
        title: title.trim(),
        telegramLink: telegramLink.trim(),
        thumbnailBase64: thumbnailBase64 || '',
        price: parseFloat(price) || 20,
        rentalDays: parseInt(rentalDays) || 3,
        isActive: true,
        createdAt: Date.now()
      });
      res.json({ success: true, filmId: filmRef.id });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Admin: Update a film
  app.post('/api/admin/update-film', async (req, res) => {
    try {
      const { adminEmail, filmId, title, telegramLink, thumbnailBase64, price, rentalDays, isActive } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });
      if (!filmId) return res.status(400).json({ error: "Film ID required" });

      const updateData = {};
      if (title !== undefined) updateData.title = title.trim();
      if (telegramLink !== undefined) updateData.telegramLink = telegramLink.trim();
      if (thumbnailBase64 && thumbnailBase64.length > 10) updateData.thumbnailBase64 = thumbnailBase64;
      if (price !== undefined) updateData.price = parseFloat(price) || 20;
      if (rentalDays !== undefined) updateData.rentalDays = parseInt(rentalDays) || 3;
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      await adminDb.collection('films').doc(filmId).update(updateData);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Admin: Delete a film
  app.post('/api/admin/delete-film', async (req, res) => {
    try {
      const { adminEmail, filmId } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });
      if (!filmId) return res.status(400).json({ error: "Film ID required" });
      await adminDb.collection('films').doc(filmId).delete();
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Admin: Get all films (with telegram links)
  app.get('/api/admin/films', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: "Unauthorized" });
      const snap = await adminDb.collection('films').orderBy('createdAt', 'desc').get();
      const films = [];
      snap.forEach(doc => {
        const d = doc.data();
        films.push({ filmId: doc.id, title: d.title, telegramLink: d.telegramLink, thumbnailBase64: d.thumbnailBase64 || '', price: d.price || 20, rentalDays: d.rentalDays || 3, isActive: d.isActive, createdAt: d.createdAt });
      });
      res.json({ success: true, films });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Public: List active films (no telegram link)
  app.get('/api/films', async (req, res) => {
    try {
      // No compound query — fetch all and filter in JS to avoid index requirement
      const snap = await adminDb.collection('films').get();
      const films = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.isActive) {
          films.push({ filmId: doc.id, title: d.title, thumbnailBase64: d.thumbnailBase64 || '', price: d.price || 20, rentalDays: d.rentalDays || 3 });
        }
      });
      // Sort by createdAt desc in JS
      films.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ success: true, films });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Create Razorpay order for film rental
  app.post('/api/rent-film', async (req, res) => {
    try {
      const { userId, filmId } = req.body;
      if (!adminDb || !userId || !filmId) return res.status(400).json({ error: "Missing parameters" });
      const filmSnap = await adminDb.collection('films').doc(filmId).get();
      if (!filmSnap.exists) return res.status(404).json({ error: "Film not found" });
      const film = filmSnap.data();
      if (!film.isActive) return res.status(400).json({ error: "Film is not available" });

      // Check for existing active rental — no compound index needed
      const now = Date.now();
      const existing = await adminDb.collection('rentals').where('userId', '==', userId).get();
      const hasActive = existing.docs.some(d => d.data().filmId === filmId && d.data().expiresAt > now);
      if (hasActive) return res.status(400).json({ error: "You already have an active rental for this film" });

      const options = {
        amount: Math.round((film.price || 20) * 100),
        currency: "INR",
        receipt: "rent_" + Math.random().toString(36).substring(7),
        notes: { filmId, userId, type: 'film-rental' }
      };
      const order = await razorpay.orders.create(options);
      res.json({ ...order, keyId: process.env.RAZORPAY_KEY_ID, filmTitle: film.title, rentalDays: film.rentalDays || 3 });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Verify rental payment & create rental record
  app.post('/api/verify-rental', async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, filmId } = req.body;
      const text = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(text).digest('hex');
      if (expectedSig !== razorpay_signature) return res.status(400).json({ success: false, message: "Invalid Signature" });

      const filmSnap = await adminDb.collection('films').doc(filmId).get();
      if (!filmSnap.exists) return res.status(404).json({ error: "Film not found" });
      const film = filmSnap.data();

      // Get user display name
      let displayName = userId;
      try {
        const userRecord = await admin.auth().getUser(userId);
        displayName = userRecord.displayName || userRecord.email || userId;
      } catch(e) { /* fallback to userId */ }

      const rentedAt = Date.now();
      const expiresAt = rentedAt + ((film.rentalDays || 3) * 24 * 60 * 60 * 1000);

      await adminDb.collection('rentals').add({
        userId, displayName, filmId, filmTitle: film.title, telegramLink: film.telegramLink,
        thumbnailBase64: film.thumbnailBase64 || '', rentalDays: film.rentalDays || 3,
        rentedAt, expiresAt, paymentId: razorpay_payment_id, orderId: razorpay_order_id, amount: film.price || 20
      });
      await adminDb.collection('payments').add({
        userId, paymentId: razorpay_payment_id, orderId: razorpay_order_id,
        amount: film.price || 20, plan: `film-rental:${film.title}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ success: true, message: "Rental activated!" });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Admin: All Rental Records (Rental Ledger)
  app.get('/api/admin/rental-ledger', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (!adminEmail || adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: 'Forbidden' });
      const snap = await adminDb.collection('rentals').get();
      const now = Date.now();
      const rentals = [];
      snap.forEach(doc => {
        const d = doc.data();
        rentals.push({
          rentalId: doc.id,
          userId: d.userId || '',
          displayName: d.displayName || d.userId || 'Unknown',
          filmTitle: d.filmTitle || 'Unknown Film',
          filmId: d.filmId || '',
          amount: d.amount || 0,
          paymentId: d.paymentId || '',
          orderId: d.orderId || '',
          rentalDays: d.rentalDays || 3,
          rentedAt: d.rentedAt || 0,
          expiresAt: d.expiresAt || 0,
          isExpired: (d.expiresAt || 0) <= now
        });
      });
      rentals.sort((a, b) => (b.rentedAt || 0) - (a.rentedAt || 0));
      res.json({ success: true, rentals, total: rentals.length,
        totalRevenue: rentals.reduce((s, r) => s + (r.amount || 0), 0),
        activeCount: rentals.filter(r => !r.isExpired).length
      });
    } catch(err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Get user's rentals
  app.get('/api/my-rentals', async (req, res) => {
    try {
      const { userId } = req.query;
      if (!adminDb || !userId) return res.status(400).json({ error: "Missing parameters" });
      // Simple single-field query — no composite index needed
      const snap = await adminDb.collection('rentals').where('userId', '==', userId).get();
      const now = Date.now();
      const rentals = [];
      snap.forEach(doc => {
        const d = doc.data();
        rentals.push({
          rentalId: doc.id, filmId: d.filmId, filmTitle: d.filmTitle, thumbnailBase64: d.thumbnailBase64 || '',
          telegramLink: d.expiresAt > now ? d.telegramLink : null,
          rentalDays: d.rentalDays || 3, rentedAt: d.rentedAt, expiresAt: d.expiresAt,
          isExpired: d.expiresAt <= now, amount: d.amount
        });
      });
      // Sort by rentedAt desc in JS
      rentals.sort((a, b) => (b.rentedAt || 0) - (a.rentedAt || 0));
      res.json({ success: true, rentals });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // ==== END FILM STORE ROUTES ====

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
