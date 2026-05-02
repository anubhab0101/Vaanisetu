# Vaanisetu

**Vaanisetu** is a premium, real-time synchronized movie-watching and social platform designed to effortlessly connect couples and friends over long distances. Built with a sleek, dynamic, glassmorphism UI, it provides a seamless and perfectly synchronized parallel viewing experience.

## Features

Vaanisetu offers an intuitive, distraction-free environment for sharing media. Here are its core capabilities:

### 🎬 Synchronized Viewing Experience
- **Real-Time Playback Sync**: Every play, pause, and seek action is perfectly synchronized across all connected view screens via low-latency WebSockets.
- **Bring Your Own Content**: Supports direct video URLs (like Dropbox links) or local file uploads.

### 🛋️ Social & Presence Features
- **Live Room Chat**: An overlay text chat featuring unread message badges, a Floating Action Button (FAB) design, and a responsive mobile layout that never covers the movie.
- **Persistent Friendships**: Add friends via their unique 6-character room codes. See who is currently online in the ecosystem instantly.
- **Privacy First**: Room chat history is not stored permanently, and new users entering won't see past messages from earlier in the session.

## Tech Stack & Core Logic

Vaanisetu is built on a fast, lightweight stack focused heavily on rapid UI rendering and instant network communication.

* **High-Performance Frontend System**: Written entirely in vanilla HTML, CSS, and modular JavaScript to eliminate framework overhead, achieving near-instant load times with premium modern design tokens (vibrant dark modes, smooth gradients, and micro-animations).
* **WebSocket Synchronization Engine**: A custom Node.js `ws` server holding in-memory state precisely managing presence, room interactions, and sync logic without the latency of database round-trips.
* **Firebase Identity & Persistence**: Uses `firebase-admin` to manage secure Google/Email authentication, store user profiles, track subscriptions, and manage social connections (friends list).
* **Integrated Razorpay Billing**: Completely hooked-up Razorpay payment portal natively on the frontend and validated via SHA256 Webhooks on the server. Includes an automated subscription Ledger system.

### Backend Logic Summary
The backend operates as an Express.js server that simultaneously hosts a WebSocket (`ws`) server. 
- **Real-Time State:** It maintains an in-memory map of active users, connections, and video rooms. When a user creates or joins a room, their connection is added to the room's set. 
- **Synchronization:** Actions like "play", "pause", "seek", and "chat" are broadcast instantly to all connected clients in that specific room, completely bypassing the database to ensure zero latency. 
- **Database & Auth:** Firebase handles authentication, while a Supabase PostgreSQL instance acts as the primary database for long-term storage (users, friend lists, subscription expiry, etc.). 
- **API & Payments:** The Express API routes handle secure Razorpay webhook validations for subscription purchases, generate one-time access codes, and process contact form submissions via Nodemailer.

## The Philosophy
Vaanisetu is more than just a tech demonstration, it's about closing the gap between distance. It removes all complicated setup steps for the user. Enter a code, upload a file, and immediately feel like you are sitting together on the exact same couch.
