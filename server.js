import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { readFile } from "fs/promises";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import Razorpay from "razorpay";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "crypto";
import compression from "compression";
import webPush from "web-push";
import nodemailer from 'nodemailer';

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

// Nodemailer transporter for Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_EMAIL || 'mailto:anubhabmohapatra.01@gmail.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn('[push] VAPID keys not set — push notifications disabled');
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

  // ── Seed admin as lifetime full-premium on every server start ──────────────
  // This ensures admin can always access /premium.html without manual DB entry.
  if (adminDb) {
    try {
      const adminRef = adminDb.collection('users').doc(ADMIN_EMAIL);
      // Use a far-future expiry (year 2286) to represent "lifetime"
      const LIFETIME_EXPIRY = 9999999999999;
      await adminRef.set({
        activeSubscription: 'monthly',
        subscriptionExpiry: LIFETIME_EXPIRY,
        isAdmin: true,
        freeRentalUnlimited: true // admin gets unlimited free rentals
      }, { merge: true });
    } catch (_) { /* non-critical */ }
  }

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
              connections.get(currentRoomId).forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: "chat", message: newMsg }));
                }
              });
            }
            break;
          }

          // ── Emoji Reaction — broadcast to all room members ──────────────
          case "reaction": {
            if (currentRoomId && connections.has(currentRoomId)) {
              connections.get(currentRoomId).forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({
                    type: "reaction",
                    emoji: message.emoji,
                    userName: message.userName || 'Someone'
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
  app.use(compression()); // ← GZIP compress all text/JSON/HTML/CSS/JS responses
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' " +
        "https://checkout.razorpay.com https://cdn.razorpay.com " +
        "https://www.gstatic.com https://www.googleapis.com https://apis.google.com " +
        "https://cdn.jsdelivr.net " +
        // AdSterra ad domains (banner + social bar — NOT popunder)
        "https://millionairelucidlytransmitted.com https://*.millionairelucidlytransmitted.com " +
        "https://www.highperformanceformat.com https://*.highperformanceformat.com " +
        "https://*.adsterra.com https://adsterra.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https:; " +
      "media-src 'self' blob: https:; " +
      "connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com " +
        "https://securetoken.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com " +
        "https://*.firestore.googleapis.com https://api.razorpay.com " +
        "https://vaanisethu-bot.onrender.com wss: " +
        "https://millionairelucidlytransmitted.com https://*.millionairelucidlytransmitted.com https:; " +
      "frame-src https://checkout.razorpay.com https://api.razorpay.com " +
        "https://accounts.google.com https://*.firebaseapp.com https:; " +
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
        if (adminDb && userId) {
           let durationDays = 0;
           if (plan === 'one-time') durationDays = 1;
           if (plan === 'weekly') durationDays = 7;
           if (plan === 'monthly') durationDays = 30;

           const now = Date.now();
           let expiryDate = now + (durationDays * 24 * 60 * 60 * 1000);

           // ── Check for pending referral bonus ──────────────────────────
           let referralBonusApplied = false;
           let bonusDaysApplied = 0;
           const userDoc = await adminDb.collection('users').doc(userId).get();
           const userData = userDoc.exists ? userDoc.data() : {};

           if (userData.pendingReferralBonusDays && !userData.firstPurchaseDone && !userData.referralBonusApplied) {
             bonusDaysApplied = userData.pendingReferralBonusDays;
             const bonusMs = bonusDaysApplied * 24 * 60 * 60 * 1000;

             // Extend THIS user's subscription by bonus days
             expiryDate += bonusMs;
             referralBonusApplied = true;

             // Extend REFERRER's subscription by same bonus days
             const referrerId = userData.referredBy;
             if (referrerId) {
               const refDoc = await adminDb.collection('users').doc(referrerId).get();
               if (refDoc.exists) {
                 const refData = refDoc.data();
                 const refExpiry = (refData.subscriptionExpiry && refData.subscriptionExpiry > now)
                   ? refData.subscriptionExpiry + bonusMs
                   : now + bonusMs;
                 await adminDb.collection('users').doc(referrerId).update({
                   subscriptionExpiry: refExpiry,
                   referralCount: (refData.referralCount || 0) + 1
                 });
               }
             }

             // Anti-abuse: record device fingerprint so same device can't claim again
             const fp = userData.pendingReferralDeviceFp;
             if (fp) {
               await adminDb.collection('referralClaims').add({
                 userId, referrerId: userData.referredBy || null,
                 deviceFingerprint: fp, claimedAt: now, bonusDays: bonusDaysApplied
               });
             }
           }

           // Update user subscription
           await adminDb.collection('users').doc(userId).update({
              activeSubscription: plan,
              subscriptionExpiry: expiryDate,
              firstPurchaseDone: true,
              ...(referralBonusApplied ? {
                referralBonusApplied: true,
                referralBonusDays: bonusDaysApplied,
                pendingReferralBonusDays: null,
                pendingReferralDeviceFp: null
              } : {})
           });

           // Log Payment
           await adminDb.collection('payments').add({
              userId,
              paymentId: razorpay_payment_id,
              orderId: razorpay_order_id,
              amount: amount,
              plan,
              referralBonusDays: referralBonusApplied ? bonusDaysApplied : 0,
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


  // Contact form submission via nodemailer
  app.post('/api/send-contact', async (req, res) => {
    try {
      const { name, email, message, screenshotBase64 } = req.body;
      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: ['anubhabmohapatra.01@gmail.com', 'anubhab.01@vaanisethu.online'],
        subject: `Vaanisethu Contact: ${name || 'Anonymous'}`,
        text: `Message from ${name || 'Anonymous'} (${email || 'no-reply'}):\n\n${message}`,
      };
      if (screenshotBase64 && screenshotBase64.length < 1_000_000) {
        mailOptions.attachments = [{ filename: 'screenshot.png', content: screenshotBase64.split("base64,")[1] || screenshotBase64, encoding: 'base64' }];
      } else if (screenshotBase64) {
        mailOptions.text += '\n\n[Screenshot attached was too large to send]';
      }
      await transporter.sendMail(mailOptions);
      res.json({ success: true });
    } catch (err) {
      console.error('Contact email error:', err);
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

      // ✅ Allow if host is on free pass
      const isOnFreePass = hostData.freePassActive === true &&
                           hostData.freePassExpiry &&
                           hostData.freePassExpiry > Date.now();

      // ✅ Allow if host is on an ad-pass (watched ads for free access)
      const isOnAdPass = hostData.adPassActive === true &&
                         hostData.adPassExpiry &&
                         hostData.adPassExpiry > Date.now();

      return res.json({ success: true, hostSubscribed: !!(isValid || isOnFreePass || isOnAdPass) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to check room access" });
    }
    });

  // Returns host's current ad context for a room — used by guests to set _roomHostAccessType
  app.get('/api/room-ad-context', async (req, res) => {
    try {
      const { roomCode } = req.query;
      if (!adminDb || !roomCode) return res.status(400).json({ error: 'Missing roomCode' });
      const cleanCode = roomCode.trim().toUpperCase();
      const snap = await adminDb.collection('users').where('roomCode', '==', cleanCode).get();
      if (snap.empty) return res.json({ success: false, error: 'Room not found' });

      const hostData = snap.docs[0].data();
      const hostUid  = snap.docs[0].id;

      // Determine host access type
      let hostAccessType = 'generic';
      try {
        const hostAuth = await admin.auth().getUser(hostUid);
        if (isAdmin(hostAuth.email || '')) hostAccessType = 'premium';
      } catch (_) {}

      if (hostAccessType !== 'premium') {
        const now = Date.now();
        const isPremiumSub = hostData.activeSubscription && hostData.subscriptionExpiry > now
                             && hostData.activeSubscription !== 'ad-pass';
        if (isPremiumSub) {
          hostAccessType = 'premium'; // paid subscription = premium tier
        } else if (hostData.adPassActive && hostData.adPassExpiry > now) {
          // Host used ad-pass — but their film access type written by client is more accurate
          hostAccessType = hostData.roomHostAccessType || 'ad-unlock';
        } else if (hostData.freePassActive && hostData.freePassExpiry > now) {
          hostAccessType = hostData.roomHostAccessType || 'generic';
        } else {
          hostAccessType = hostData.roomHostAccessType || 'generic';
        }
      }

      res.json({
        success: true,
        hostAccessType,
        filmAdEnabled: hostData.roomFilmAdEnabled !== false // default true
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });



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

  // Get total unique visitor count (now public)
  app.get('/api/visitor-stats', async (req, res) => {
    try {
      // Made public as requested (Option A or Option B, user chose Option B for footer but we do both, we will use page-view-count for anonymous counter)
      const snap = await adminDb.collection('visitors').get();
      res.json({ success: true, totalVisitors: snap.size });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Public page view counter (anonymous)
  app.get('/api/page-view-count', async (req, res) => {
    try {
      const counterRef = adminDb.collection('pageViews').doc('counter');
      await adminDb.runTransaction(async (t) => {
        const doc = await t.get(counterRef);
        let count = 0;
        if (doc.exists) {
          count = doc.data().count || 0;
        }
        count += 1;
        t.set(counterRef, { count }, { merge: true });
        res.json({ success: true, totalPageViews: count });
      });
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


  // ================================================================
  // AD MONETIZATION SYSTEM
  // ================================================================

  // Step 1: Client calls this after each ad completes to get a signed token
  app.post('/api/verify-ad-completion', async (req, res) => {
    try {
      const { userId, adIndex } = req.body; // adIndex = 1 or 2
      if (!adminDb || !userId) return res.status(400).json({ error: 'Missing parameters' });

      // Generate a secure random token tied to this user + ad slot + time
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + (10 * 60 * 1000); // token valid for 10 minutes only

      // Store token in Firestore so grant endpoint can verify it
      await adminDb.collection('adTokens').add({
        userId,
        adIndex,
        token,
        expiresAt,
        createdAt: Date.now(),
        used: false
      });

      res.json({ success: true, token, expiresAt });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Step 2: After watching all required ads, grant 24hr ad-pass
  app.post('/api/grant-ad-pass', async (req, res) => {
    try {
      const { userId, tokens, fingerprint } = req.body; // tokens = array of 4 verified ad tokens
      const REQUIRED_ADS = 4;
      if (!adminDb || !userId || !Array.isArray(tokens) || tokens.length < REQUIRED_ADS) {
        return res.status(400).json({ error: `Need ${REQUIRED_ADS} ad tokens to grant access.` });
      }

      // All tokens must be unique
      if (new Set(tokens).size < REQUIRED_ADS) {
        return res.status(403).json({ success: false, error: 'Duplicate tokens detected. Please restart the ad flow.' });
      }

      const tokensRef = adminDb.collection('adTokens');
      const now = Date.now();
      const batch = adminDb.batch();

      // Verify all tokens in sequence
      for (let i = 0; i < REQUIRED_ADS; i++) {
        const t = tokens[i];
        if (!t) return res.status(400).json({ success: false, error: `Token ${i + 1} is missing.` });

        const snap = await tokensRef
          .where('userId', '==', userId)
          .where('token', '==', t)
          .where('used', '==', false)
          .limit(1).get();

        if (snap.empty) return res.status(403).json({ success: false, error: `Ad ${i + 1} token is invalid or already used. Please restart.` });
        if (snap.docs[0].data().expiresAt < now) return res.status(403).json({ success: false, error: `Ad ${i + 1} token expired. Please restart.` });

        batch.update(tokensRef.doc(snap.docs[0].id), { used: true });
      }

      // Grant 24hr ad-pass on user document
      // Also set activeSubscription + subscriptionExpiry so hasValidAccess() routes to dashboard
      const adPassExpiry = now + (24 * 60 * 60 * 1000);
      const userRef = adminDb.collection('users').doc(userId);
      batch.update(userRef, {
        adPassActive: true,
        adPassExpiry,
        adPassGrantedAt: now,
        activeSubscription: 'ad-pass',
        subscriptionExpiry: adPassExpiry
      });

      // Log ad-pass grant
      const adPassRef = adminDb.collection('adPasses').doc();
      batch.set(adPassRef, {
        userId,
        fingerprint: fingerprint || '',
        adsWatched: REQUIRED_ADS,
        grantedAt: now,
        expiresAt: adPassExpiry
      });

      await batch.commit();

      res.json({ success: true, adPassExpiry, message: '🎉 24-hour free access granted! Enjoy Vaanisethu.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Film ad unlock: watch 1 ad → get 4hr access to a specific film
  app.post('/api/grant-film-ad-unlock', async (req, res) => {
    try {
      const { userId, filmId, token } = req.body;
      if (!adminDb || !userId || !filmId || !token) {
        return res.status(400).json({ error: 'Missing parameters' });
      }

      const now = Date.now();

      // Verify the ad token
      const tokensRef = adminDb.collection('adTokens');
      const tSnap = await tokensRef
        .where('userId', '==', userId)
        .where('token', '==', token)
        .where('used', '==', false)
        .limit(1).get();
      if (tSnap.empty) return res.status(403).json({ success: false, error: 'Invalid or expired ad token. Please watch the ad again.' });
      if (tSnap.docs[0].data().expiresAt < now) return res.status(403).json({ success: false, error: 'Ad token expired. Please retry.' });

      // Check film exists and ad unlock is enabled
      const filmRef = adminDb.collection('films').doc(filmId);
      const filmSnap = await filmRef.get();
      if (!filmSnap.exists) return res.status(404).json({ success: false, error: 'Film not found.' });
      const filmData = filmSnap.data();
      if (filmData.adUnlockEnabled === false) {
        return res.status(403).json({ success: false, error: 'Ad unlock is not available for this film.' });
      }

      const unlockHours = filmData.adUnlockHours || 1; // default: 1 hour
      const expiresAt = now + (unlockHours * 60 * 60 * 1000);

      // Mark token used
      await adminDb.collection('adTokens').doc(tSnap.docs[0].id).update({ used: true });

      // Create unlock record — use userId+filmId as doc ID so we can overwrite/extend
      const unlockId = `${userId}_${filmId}`;
      await adminDb.collection('adFilmUnlocks').doc(unlockId).set({
        userId,
        filmId,
        filmTitle: filmData.title,
        telegramLink: filmData.telegramLink,
        unlockedAt: now,
        expiresAt
      });

      res.json({
        success: true,
        expiresAt,
        telegramLink: filmData.telegramLink,
        filmTitle: filmData.title,
        message: `🎬 Film unlocked for ${unlockHours} hours! Enjoy.`
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get current user's active ad-unlocked films
  app.get('/api/my-ad-unlocks', async (req, res) => {
    try {
      const { userId } = req.query;
      if (!adminDb || !userId) return res.status(400).json({ error: 'Missing userId' });

      const now = Date.now();
      const snap = await adminDb.collection('adFilmUnlocks')
        .where('userId', '==', userId)
        .get();

      const unlocks = [];
      snap.forEach(doc => {
        const d = doc.data();
        unlocks.push({
          filmId: d.filmId,
          filmTitle: d.filmTitle,
          telegramLink: d.expiresAt > now ? d.telegramLink : null, // hide link if expired
          unlockedAt: d.unlockedAt,
          expiresAt: d.expiresAt,
          isActive: d.expiresAt > now
        });
      });

      res.json({ success: true, unlocks });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Toggle ad-unlock per film + set unlock duration
  app.post('/api/admin/set-film-ad-unlock', async (req, res) => {
    try {
      const { adminEmail, filmId, adUnlockEnabled, adUnlockHours } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: 'Unauthorized' });
      if (!filmId) return res.status(400).json({ error: 'filmId required' });

      const update = {};
      if (adUnlockEnabled !== undefined) update.adUnlockEnabled = !!adUnlockEnabled;
      if (adUnlockHours !== undefined) update.adUnlockHours = parseInt(adUnlockHours) || 4;

      await adminDb.collection('films').doc(filmId).update(update);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Ad analytics overview
  app.get('/api/admin/ad-analytics', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: 'Unauthorized' });

      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);

      const [passSnap, unlockSnap] = await Promise.all([
        adminDb.collection('adPasses').get(),
        adminDb.collection('adFilmUnlocks').get()
      ]);

      let todayPasses = 0;
      passSnap.forEach(d => { if (d.data().grantedAt >= oneDayAgo) todayPasses++; });

      const filmCounts = {};
      let activeUnlocks = 0;
      unlockSnap.forEach(d => {
        const data = d.data();
        filmCounts[data.filmTitle] = (filmCounts[data.filmTitle] || 0) + 1;
        if (data.expiresAt > now) activeUnlocks++;
      });

      const topFilm = Object.entries(filmCounts).sort((a, b) => b[1] - a[1])[0];

      res.json({
        success: true,
        totalAdPasses: passSnap.size,
        todayAdPasses: todayPasses,
        totalFilmUnlocks: unlockSnap.size,
        activeFilmUnlocks: activeUnlocks,
        topFilm: topFilm ? { title: topFilm[0], count: topFilm[1] } : null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });


  // ==== FREE PASS MANAGEMENT (Admin) ====

  // GET /api/admin/free-pass-users — list all users who ever claimed a free pass
  app.get('/api/admin/free-pass-users', async (req, res) => {
    try {
      const { adminEmail } = req.query;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: 'Unauthorized' });
      if (!adminDb) return res.status(503).json({ error: 'DB unavailable' });

      const now = Date.now();
      let docs = [];

      try {
        // Try ordered query first (requires Firestore composite index)
        const snap = await adminDb.collection('users')
          .where('freePassClaimedAt', '>', 0)
          .orderBy('freePassClaimedAt', 'desc')
          .limit(200)
          .get();
        docs = snap.docs;
      } catch (indexErr) {
        // Fallback: simple filter (no index needed), sort in memory
        const allSnap = await adminDb.collection('users')
          .where('freePassClaimedAt', '>', 0)
          .limit(200)
          .get();
        docs = allSnap.docs.sort((a, b) => (b.data().freePassClaimedAt || 0) - (a.data().freePassClaimedAt || 0));
      }

      const users = docs.map(d => {
        const data = d.data();
        return {
          uid: d.id,
          displayName: data.displayName || data.name || '—',
          email: data.email || '',
          freePassActive: !!(data.freePassActive && data.freePassExpiry > now),
          freePassExpiry: data.freePassExpiry || 0,
          freePassGrantedAt: data.freePassClaimedAt || 0,
        };
      });

      res.json({ success: true, users });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/manage-free-pass — extend (+24h) or revoke a user's free pass
  app.post('/api/admin/manage-free-pass', async (req, res) => {
    try {
      const { adminEmail, userId, action } = req.body;
      if (adminEmail !== 'anubhabmohapatra.01@gmail.com') return res.status(403).json({ error: 'Unauthorized' });
      if (!adminDb || !userId || !action) return res.status(400).json({ error: 'Missing params' });

      const userRef = adminDb.collection('users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'User not found' });

      const now = Date.now();

      if (action === 'extend-24h') {
        const currentExpiry = Math.max(snap.data().freePassExpiry || 0, now);
        await userRef.update({
          freePassActive: true,
          freePassExpiry: currentExpiry + (24 * 60 * 60 * 1000),
        });
        res.json({ success: true, message: 'Extended by 24 hours.' });
      } else if (action === 'revoke') {
        await userRef.update({
          freePassActive: false,
          freePassExpiry: 0,
        });
        res.json({ success: true, message: 'Free pass revoked.' });
      } else {
        res.status(400).json({ error: 'Unknown action' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });


  // ==== FILM STORE ROUTES ====

  // Admin: Add a new film
  app.post('/api/admin/add-film', async (req, res) => {
    try {
      const { adminEmail, title, telegramLink, thumbnailBase64, price, rentalDays, adUnlockEnabled, trailerLink, earlyAccessUntil } = req.body;
      if (adminEmail !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized" });
      if (!title || !telegramLink) return res.status(400).json({ error: "Title and Telegram link required" });

      const filmData = {
        title: title.trim(),
        telegramLink: telegramLink.trim(),
        thumbnailBase64: thumbnailBase64 || '',
        price: parseFloat(price) || 20,
        rentalDays: parseInt(rentalDays) || 3,
        isActive: true,
        adUnlockEnabled: adUnlockEnabled !== false,
        adUnlockHours: 1,
        createdAt: Date.now()
      };
      if (trailerLink) filmData.trailerLink = trailerLink.trim();
      if (earlyAccessUntil) filmData.earlyAccessUntil = parseInt(earlyAccessUntil);

      const filmRef = await adminDb.collection('films').add(filmData);
      res.json({ success: true, filmId: filmRef.id });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Admin: Update a film
  app.post('/api/admin/update-film', async (req, res) => {
    try {
      const { adminEmail, filmId, title, telegramLink, thumbnailBase64, price, rentalDays, isActive, adUnlockEnabled, trailerLink, earlyAccessUntil } = req.body;
      if (adminEmail !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized" });
      if (!filmId) return res.status(400).json({ error: "Film ID required" });

      const updateData = {};
      if (title !== undefined) updateData.title = title.trim();
      if (telegramLink !== undefined) updateData.telegramLink = telegramLink.trim();
      if (thumbnailBase64 && thumbnailBase64.length > 10) updateData.thumbnailBase64 = thumbnailBase64;
      if (price !== undefined) updateData.price = parseFloat(price) || 20;
      if (rentalDays !== undefined) updateData.rentalDays = parseInt(rentalDays) || 3;
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);
      if (adUnlockEnabled !== undefined) updateData.adUnlockEnabled = Boolean(adUnlockEnabled);
      // Trailer & early access (allow clearing with empty string)
      if (trailerLink !== undefined) updateData.trailerLink = trailerLink ? trailerLink.trim() : null;
      if (earlyAccessUntil !== undefined) updateData.earlyAccessUntil = earlyAccessUntil ? parseInt(earlyAccessUntil) : null;

      await adminDb.collection('films').doc(filmId).update(updateData);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Admin: Delete a film
  app.post('/api/admin/delete-film', async (req, res) => {
    try {
      const { adminEmail, filmId } = req.body;
      if (adminEmail !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized" });
      if (!filmId) return res.status(400).json({ error: "Film ID required" });
      await adminDb.collection('films').doc(filmId).delete();
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // ── Free Rental (1/week for Weekly, 1/month for Monthly, unlimited for Admin) ──
  app.post('/api/use-free-rental', async (req, res) => {
    try {
      const { userId, filmId } = req.body;
      if (!userId || !filmId) return res.status(400).json({ success: false, error: 'Missing fields' });

      const userRef = adminDb.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ success: false, error: 'User not found' });
      const userData = userSnap.data();

      // Admin gets unlimited free rentals
      const isAdminUser = userData.isAdmin === true || userData.email === ADMIN_EMAIL;

      const plan = userData.activeSubscription;
      const expiry = userData.subscriptionExpiry || 0;
      const now = Date.now();

      if (!isAdminUser) {
        // Verify they have an active weekly or monthly plan
        if (!['weekly','monthly'].includes(plan) || expiry < now) {
          return res.json({ success: false, error: 'Free rental requires active Weekly or Monthly plan.' });
        }
        // Check if already used this cycle
        const lastUsed = userData.freeRentalUsedAt || 0;
        // Both weekly AND monthly → reset every week (Monday 00:00)
        // Monthly gets same weekly cadence = better value for higher price
        const weekStart = new Date(); weekStart.setHours(0,0,0,0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
        if (lastUsed >= weekStart.getTime()) {
          return res.json({ success: false, error: 'You already used your 1 free rental this week.' });
        }
      }

      // Fetch the film's telegramLink
      const filmSnap = await adminDb.collection('films').doc(filmId).get();
      if (!filmSnap.exists) return res.json({ success: false, error: 'Film not found.' });
      const filmData = filmSnap.data();
      const telegramLink = filmData.telegramLink;

      // Mark rental used (non-admin only)
      if (!isAdminUser) {
        await userRef.set({ freeRentalUsedAt: now, freeRentalFilmId: filmId }, { merge: true });
      }

      res.json({ success: true, telegramLink, filmTitle: filmData.title });
    } catch (err) {
      console.error('[free-rental]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  // ════════════════════════════════════════════════════════════
  // PWA PUSH NOTIFICATIONS
  // ════════════════════════════════════════════════════════════

  // [1] Return VAPID public key to client (needed for subscription)
  app.get('/api/push/vapid-key', (req, res) => {
    if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Push not configured' });
    res.json({ publicKey: VAPID_PUBLIC });
  });

  // [2] Save a push subscription from the browser
  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const { userId, subscription } = req.body;
      if (!userId || !subscription || !subscription.endpoint) {
        return res.status(400).json({ success: false, error: 'Invalid subscription' });
      }
      // Use endpoint hash as doc ID (prevents duplicates from same device)
      const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 20);
      await adminDb.collection('pushSubscriptions').doc(endpointHash).set({
        userId,
        subscription,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, { merge: true });
      res.json({ success: true });
    } catch (err) {
      console.error('[push/subscribe]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // [3] Admin: broadcast push notification to ALL subscribers
  app.post('/api/push/send', async (req, res) => {
    try {
      const { adminEmail, title, body, url, icon } = req.body;
      if (adminEmail !== ADMIN_EMAIL) return res.status(403).json({ error: 'Unauthorized' });
      if (!title || !body) return res.status(400).json({ error: 'Title and body required' });

      const subsSnap = await adminDb.collection('pushSubscriptions').get();
      if (subsSnap.empty) return res.json({ success: true, sent: 0, message: 'No subscribers yet.' });

      const payload = JSON.stringify({
        title: title.trim(),
        body:  body.trim(),
        icon:  icon || '/logo.png',
        url:   url  || '/',
        tag:   'vaanisethu-broadcast'
      });

      let sent = 0, failed = 0, expired = [];
      const batch = adminDb.batch();

      await Promise.all(subsSnap.docs.map(async (doc) => {
        try {
          await webPush.sendNotification(doc.data().subscription, payload);
          sent++;
        } catch (err) {
          failed++;
          // 410 Gone = subscription revoked by browser → remove it
          if (err.statusCode === 410 || err.statusCode === 404) {
            expired.push(doc.ref);
          }
        }
      }));

      // Clean expired subscriptions
      expired.forEach(ref => batch.delete(ref));
      if (expired.length) await batch.commit();

      res.json({ success: true, sent, failed, expiredCleaned: expired.length });
    } catch (err) {
      console.error('[push/send]', err);
      res.status(500).json({ success: false, error: err.message });
    }
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
        films.push({ filmId: doc.id, title: d.title, telegramLink: d.telegramLink, thumbnailBase64: d.thumbnailBase64 || '', price: d.price || 20, rentalDays: d.rentalDays || 3, isActive: d.isActive, adUnlockEnabled: d.adUnlockEnabled !== false, createdAt: d.createdAt });
      });
      res.json({ success: true, films });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Public: List active films (no telegram link)
  app.get('/api/films', async (req, res) => {
    try {
      const snap = await adminDb.collection('films').get();
      const films = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.isActive) {
          films.push({
            filmId: doc.id,
            title: d.title,
            thumbnailBase64: d.thumbnailBase64 || '',
            price: d.price || 20,
            rentalDays: d.rentalDays || 3,
            // ✅ CRITICAL: include adUnlockEnabled so frontend can split into sections
            adUnlockEnabled: d.adUnlockEnabled !== false,
            createdAt: d.createdAt || 0
          });
        }
      });
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

  // =====================================================================
  // V2 FEATURES — RATINGS, WATCH HISTORY, LEADERBOARD, REFERRALS
  // =====================================================================

  // POST /api/rate-film — Save a 1-5 star rating for a film
  app.post('/api/rate-film', async (req, res) => {
    try {
      const { userId, filmId, filmTitle, rating } = req.body;
      if (!userId || !filmId || !rating) return res.json({ success: false, error: 'Missing fields' });
      const r = parseInt(rating);
      if (r < 1 || r > 5) return res.json({ success: false, error: 'Rating must be 1-5' });

      const ratingRef = adminDb.collection('filmRatings').doc(`${userId}_${filmId}`);
      await ratingRef.set({ userId, filmId, filmTitle: filmTitle || '', rating: r, createdAt: Date.now() }, { merge: true });

      // Recompute avg
      const snap = await adminDb.collection('filmRatings').where('filmId', '==', filmId).get();
      let total = 0, count = 0;
      snap.forEach(d => { total += d.data().rating; count++; });
      const avg = count > 0 ? (total / count).toFixed(1) : null;

      // Persist avg on film doc
      await adminDb.collection('films').doc(filmId).set({ avgRating: avg ? parseFloat(avg) : null, ratingCount: count }, { merge: true });
      res.json({ success: true, avg, count });
    } catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
  });

  // GET /api/my-film-rating?userId=&filmId= — Get a user's own rating
  app.get('/api/my-film-rating', async (req, res) => {
    try {
      const { userId, filmId } = req.query;
      if (!userId || !filmId) return res.json({ success: false, rating: null });
      const doc = await adminDb.collection('filmRatings').doc(`${userId}_${filmId}`).get();
      res.json({ success: true, rating: doc.exists ? doc.data().rating : null });
    } catch (err) { res.json({ success: false, rating: null }); }
  });

  // POST /api/log-watch-history — Called when a film starts playing
  app.post('/api/log-watch-history', async (req, res) => {
    try {
      const { userId, filmId, filmTitle, thumbnailBase64 } = req.body;
      if (!userId || !filmId) return res.json({ success: false });
      await adminDb.collection('watchHistory').add({
        userId, filmId, filmTitle: filmTitle || '', thumbnailBase64: thumbnailBase64 || '',
        watchedAt: Date.now()
      });
      res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
  });

  // GET /api/my-watch-history?userId= — Return last 20 entries
  app.get('/api/my-watch-history', async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.json({ success: false, history: [] });
      const snap = await adminDb.collection('watchHistory')
        .where('userId', '==', userId)
        .orderBy('watchedAt', 'desc')
        .limit(20)
        .get();
      const history = [];
      snap.forEach(d => history.push({ id: d.id, ...d.data() }));
      res.json({ success: true, history });
    } catch (err) { res.json({ success: true, history: [] }); }
  });

  // GET /api/leaderboard — Top 10 users by films watched this month
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const snap = await adminDb.collection('watchHistory')
        .where('watchedAt', '>=', monthStart.getTime())
        .get();
      const counts = {};
      const names = {};
      snap.forEach(d => {
        const { userId, filmTitle } = d.data();
        counts[userId] = (counts[userId] || 0) + 1;
      });
      // Get names from users collection
      const userIds = Object.keys(counts);
      if (userIds.length > 0) {
        const userSnap = await adminDb.collection('users').where('uid', 'in', userIds.slice(0, 10)).get();
        userSnap.forEach(d => { names[d.id] = d.data().displayName || 'User'; });
      }
      const board = Object.entries(counts)
        .map(([uid, count]) => ({ uid, name: names[uid] || 'User', count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      res.json({ success: true, board });
    } catch (err) { res.json({ success: true, board: [] }); }
  });

  // POST /api/apply-referral — Store a PENDING referral on signup
  // Bonus is NOT granted immediately — it applies on the user's FIRST PURCHASE.
  // Anti-abuse: device fingerprint prevents the same device from claiming again,
  //   even if the user creates a new email account.
  app.post('/api/apply-referral', async (req, res) => {
    try {
      const { newUserId, refCode, deviceFingerprint } = req.body;
      if (!newUserId || !refCode) return res.json({ success: false, error: 'Missing fields' });

      const refUpper = refCode.trim().toUpperCase();

      // Anti-abuse — check if this device already claimed a referral bonus before
      if (deviceFingerprint) {
        const abuseSn = await adminDb.collection('referralClaims')
          .where('deviceFingerprint', '==', deviceFingerprint).limit(1).get();
        if (!abuseSn.empty) {
          return res.json({ success: false, error: 'This device has already used a referral bonus.' });
        }
      }

      // Find owner of refCode
      const snap = await adminDb.collection('users').where('roomCode', '==', refUpper).get();
      if (snap.empty) return res.json({ success: false, error: 'Referral code not found. Check the code and try again.' });

      const referrerDoc = snap.docs[0];
      const referrerId = referrerDoc.id;
      if (referrerId === newUserId) return res.json({ success: false, error: 'You cannot refer yourself.' });

      // Check new user hasn't already used / pended a referral
      const newUserDoc = await adminDb.collection('users').doc(newUserId).get();
      const newUserData = newUserDoc.exists ? newUserDoc.data() : {};
      if (newUserData.referredBy || newUserData.referralBonusApplied) {
        return res.json({ success: false, error: 'You have already used a referral code.' });
      }
      if (newUserData.firstPurchaseDone) {
        return res.json({ success: false, error: 'Referral code must be entered before your first purchase.' });
      }

      // Determine bonus days based on referrer's subscription status
      const referrerData = referrerDoc.data();
      const now = Date.now();
      const referrerIsActive = referrerData.subscriptionExpiry && referrerData.subscriptionExpiry > now;
      const referrerPlan = referrerData.activeSubscription || '';
      const referrerIsPremium = referrerIsActive &&
        (referrerPlan === 'weekly' || referrerPlan === 'monthly' || referrerPlan === 'access-code');
      const bonusDays = referrerIsPremium ? 7 : 3;

      // Store PENDING referral on the new user's doc (bonus applied on first purchase)
      await adminDb.collection('users').doc(newUserId).set({
        referredBy: referrerId,
        referredByCode: refUpper,
        pendingReferralBonusDays: bonusDays,
        pendingReferralDeviceFp: deviceFingerprint || null,
        referralPendingAt: now
      }, { merge: true });

      res.json({ success: true, pending: true, bonusDays, referrerIsPremium });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });


  const publicPath = path.join(process.cwd(), 'public');

  // ── Server-side Premium HTML ──────────────────────────────────────────────
  // Reads index.html, removes AdSterra scripts, injects premium flag, serves it.
  // This replaces the broken client-side fetch+document.write() approach
  // (document.write blocks module scripts from executing).
  app.get('/premium.html', async (req, res) => {
    try {
      let html = await readFile(path.join(publicPath, 'index.html'), 'utf-8');
      // Remove AdSterra Social Bar (not shown to premium users)
      html = html.replace(/<script[^>]*823a60f46b088bcbd52fceb040961ab1[^>]*><\/script>/g, '');
      html = html.replace(/<script[^>]*Social[\s\S]*?<\/script>/g, '');
      // Inject premium flag so app.js skips ads and redirect loops
      html = html.replace('</head>', '<script>window._IS_PREMIUM_PAGE=true;<\/script></head>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.send(html);
    } catch (e) {
      console.error('[premium.html]', e.message);
      res.redirect('/');
    }
  });


  // Smart static caching:
  // - versioned assets (app.js?v=X, style.css?v=X) → 1 hour cache (CDN-friendly)
  // - index.html → no-cache so users always get the latest version
  app.use(express.static(publicPath, {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      const isHtml = filePath.endsWith('.html');
      if (isHtml) {
        // HTML — always revalidate so users get fresh JS/CSS version references
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        // CSS/JS/images — 1 hour cache (query-string versioning busts cache)
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      }
    }
  }));
  
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Vanilla JS Server running on http://localhost:${PORT}`);

    // ── Render free-tier keep-alive self-ping ──────────────────────────────
    // Render spins down free services after 15 min of inactivity.
    // We ping our own public URL every 10 minutes so it never sleeps.
    // RENDER_EXTERNAL_URL is auto-set by Render (e.g. https://vaanisetu.onrender.com)
    const selfUrl = process.env.RENDER_EXTERNAL_URL;
    if (selfUrl) {
      const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
      setInterval(async () => {
        try {
          const r = await fetch(`${selfUrl}/ping`, { signal: AbortSignal.timeout(10000) });
          console.log(`[keep-alive] self-ping → ${r.status}`);
        } catch (e) {
          console.warn('[keep-alive] self-ping failed:', e.message);
        }
      }, PING_INTERVAL);
      console.log(`[keep-alive] Self-ping active every 10 min → ${selfUrl}/ping`);
    } else {
      console.log('[keep-alive] RENDER_EXTERNAL_URL not set — skipping self-ping (local dev)');
    }
  });
}

startServer();
