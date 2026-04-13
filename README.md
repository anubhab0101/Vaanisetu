# Vaanisetu

**Vaanisetu** is a premium, real-time synchronized movie-watching and social platform designed to effortlessly connect couples and friends over long distances. Built with a sleek, dynamic, glassmorphism UI, it provides a seamless and perfectly synchronized parallel viewing experience.

## What It Can Do

Vaanisetu offers an intuitive, distraction-free environment for sharing media. Here are its core capabilities:

### 🎬 Synchronized Viewing Experience
- **Real-Time Playback Sync**: Every play, pause, and seek action is perfectly synchronized across all connected view screens via low-latency WebSockets.
- **Bring Your Own Content**: Supports direct video URLs (like Dropbox links) or local file uploads.
- **Host Controls**: The room owner retains the ultimate control over the video source, preventing accidental disruptions from participants. Guests are greeted with a beautiful "Waiting for Host" interface when no media is playing.

### 🛋️ Social & Presence Features
- **Live Room Chat**: An overlay text chat featuring unread message badges, a Floating Action Button (FAB) design, and a responsive mobile layout that never covers the movie.
- **Persistent Friendships**: Add friends via their unique 6-character room codes. See who is currently online in the ecosystem instantly.
- **Privacy First**: New guests entering a room won't see past chat histories from earlier in the session, and hosts can clear the room at any time.

### 🎟️ Subscriptions & Host-Based Access
- **Premium Host, Free Guest**: Vaanisetu runs on a subscription model where only the "Host" needs a premium pass (Monthly, Weekly, or Daily). Invited guests can join the host's room completely for free.
- **Permanent Room Codes**: Every user owns a unique persistent 6-digit room code to make drop-ins stress-free.

## What's Included

Vaanisetu is built on a fast, lightweight stack focused heavily on rapid UI rendering and instant network communication.

* **High-Performance Frontend System**: Written entirely in vanilla HTML, CSS, and modular JavaScript to eliminate framework overhead, achieving near-instant load times with premium modern design tokens (vibrant dark modes, smooth gradients, and micro-animations).
* **WebSocket Synchronization Engine**: A custom Node.js `ws` server holding in-memory state precisely managing presence, room interactions, and sync logic without the latency of database round-trips.
* **Firebase Identity & Persistence**: Uses `firebase-admin` to manage secure Google/Email authentication, store user profiles, track subscriptions, and manage social connections (friends list).
* **Integrated Razorpay Billing**: Completely hooked-up Razorpay payment portal natively on the frontend and validated via SHA256 Webhooks on the server. Includes an automated subscription Ledger system.
* **Development/Admin Dashboard**: A secure, built-in developer portal specifically to generate one-time `access codes`, monitor subscription expiries, and audit user access. 

## The Philosophy
Vaanisetu is more than just a tech demonstration, it's about closing the gap between distance. It removes all complicated setup steps for the user. Enter a code, upload a file, and immediately feel like you are sitting together on the exact same couch.
