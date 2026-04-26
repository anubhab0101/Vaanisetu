import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, 
  onAuthStateChanged, updateProfile, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
// Firestore removed - data now via backend API

const firebaseConfig = {
  apiKey: "AIzaSyBocu4_8iXU3ZsaPsdQDKM694awK-6IIBI",
  authDomain: "gen-lang-client-0245146108.firebaseapp.com",
  projectId: "gen-lang-client-0245146108",
  storageBucket: "gen-lang-client-0245146108.firebasestorage.app",
  messagingSenderId: "802373276495",
  appId: "1:802373276495:web:35965034e2cd30c8d36b3a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// db removed - using backend API

// === Supabase Realtime client (anon key - safe to expose) ===
const _SB_URL = 'https://fgfacebhmcbydjefzfif.supabase.co';
const _SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZmFjZWJobWNieWRqZWZ6ZmlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTUyNzMsImV4cCI6MjA5MjYzMTI3M30.ErT0-TQu2C_HOdGXcX5kAXUXy61Y3799jw4JQmU-CjE';
let _sbClient = null;
async function getSBClient() {
    if (_sbClient) return _sbClient;
    try {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        _sbClient = createClient(_SB_URL, _SB_ANON);
    } catch(e) { console.warn('[Supabase] CDN failed:', e.message); }
    return _sbClient;
}



// === YOUTUBE INTEGRATION ===
let ytPlayer = null;
let ytPlayerReady = false;
let isYouTubeMode = false;
let ytSyncInterval = null;
let pendingYtVideoId = null;

function initYTPlayer() {
    ytPlayer = new YT.Player('youtube-player-container', {
        height: '100%',
        width: '100%',
        playerVars: { 'autoplay': 1, 'controls': 1, 'modestbranding': 1, 'rel': 0 },
        events: {
            'onReady': () => { 
                ytPlayerReady = true; 
                if (pendingYtVideoId) {
                    ytPlayer.loadVideoById(pendingYtVideoId);
                    pendingYtVideoId = null;
                }
            },
            'onStateChange': onPlayerStateChange
        }
    });
}

window.onYouTubeIframeAPIReady = initYTPlayer;

if (window.YT && window.YT.Player) {
    initYTPlayer();
} else {
    const ytScriptTag = document.createElement('script');
    ytScriptTag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(ytScriptTag, firstScriptTag);
    } else {
        document.head.appendChild(ytScriptTag);
    }
}

function onPlayerStateChange(event) {
    if (!isYouTubeMode) return;
    if (event.data == YT.PlayerState.PLAYING) {
        if (!isUpdating) sendVideoState('play');
        if (ytSyncInterval) clearInterval(ytSyncInterval);
        ytSyncInterval = setInterval(() => {
            if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                window._ytLastKnownTime = ytPlayer.getCurrentTime();
            }
        }, 500);
    } else if (event.data == YT.PlayerState.PAUSED) {
        if (!isUpdating) sendVideoState('pause');
        if (ytSyncInterval) clearInterval(ytSyncInterval);
    }
}
// ================================================================

// Global session initialized from Auth
let sessionUserId = Math.random().toString(36).substring(2, 10);
let sessionUserName = "Guest";
let currentUser = null;
let currentUserDoc = null;
let unsubscribeDoc = null;

// Friends Cache
const friendCache = new Map();
let onlinePresence = new Set(); 

// State
let currentRoomId = null;
let currentVideoUrl = null;
let currentVideoFile = null;
let isUpdating = false;
let ws = null;
let currentRoomUsers = new Set();
let currentRoomOwnerUid = null;
let currentGuestAccessRoom = null; // Stores room code if guest pass granted

// Platform Config Cache
let _platformConfig = null; // { freeDayActive: bool }
let _deviceFingerprint = ''; // FingerprintJS hash
let _fpReady = false; // true once FingerprintJS has resolved

// =====================================================================
// AD CONTEXT GLOBALS
// _currentPlayingFilmAdEnabled: whether the CURRENT film has ads enabled
//   - Paid rental \u2192 false (ads off)
//   - Ad-unlocked \u2192 true (ads on, host watched ad)
//   - Generic URL \u2192 true (default)
// _roomHostAccessType: read from room Firestore doc by guests
//   - 'premium' | 'rental' | 'ad-unlock' | 'generic'
// =====================================================================
window._currentPlayingFilmAdEnabled = true; // default: ads on
window._roomHostAccessType = 'generic';      // updated when room doc changes

// Generate a persistent localStorage key for this browser (survives account changes)
function getLocalClaimKey() {
  let key = localStorage.getItem('_vns_fpkey');
  if (!key) {
    key = 'lk_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('_vns_fpkey', key);
  }
  return key;
}

// Generate device fingerprint on load (async)
(async () => {
  try {
    const fp = await window.FingerprintJS?.load();
    if (fp) {
      const result = await fp.get();
      _deviceFingerprint = result.visitorId || '';
    }
  } catch(e) { console.warn('Fingerprint unavailable:', e); }
  _fpReady = true;
})();

async function getPlatformConfig() {
  if (_platformConfig !== null) return _platformConfig;
  try {
    const res = await fetch('/api/platform-config');
    const data = await res.json();
    _platformConfig = data.success ? data : { freeDayActive: false };
  } catch(e) {
    _platformConfig = { freeDayActive: false };
  }
  return _platformConfig;
}

// Views
const authView = document.getElementById('auth-view');
const setupProfileView = document.getElementById('setup-profile-view');
const dashView = document.getElementById('dashboard-view');
const roomView = document.getElementById('room-view');
const paymentView = document.getElementById('payment-view');
const adminView = document.getElementById('admin-view');

// ================================================================
// SPA NAVIGATION \u2014 History API
// Browser Back/Forward navigates between app views, not URLs
// ================================================================
let _currentSpaView = 'auth';
let _spaHandlingPop = false;

function spaPushState(viewId) {
    _currentSpaView = viewId;
    history.pushState({ spaSite: true, view: viewId }, '', '/');
}

// On app load, set the initial state so Back doesn't leave the site
history.replaceState({ spaSite: true, view: 'auth' }, '', '/');
// NOTE: auth-view starts with display:none in HTML.
// It is only made visible inside onAuthStateChanged when user === null.
// This eliminates the login screen flash for already-logged-in users.

window.addEventListener('popstate', function(e) {
    if (_spaHandlingPop) return;
    _spaHandlingPop = true;
    try {
        const state = e.state;

        // 1. Film Store Modal open \u2014 close it on Back
        const filmModal = document.getElementById('film-store-modal');
        if (filmModal && filmModal.style.display !== 'none') {
            filmModal.style.display = 'none';
            // Repush current view since we "consumed" this back event
            history.pushState({ spaSite: true, view: _currentSpaView }, '', '/');
            _spaHandlingPop = false;
            return;
        }

        if (!state || !state.spaSite || state.view === 'auth' || state.view === 'init') {
            // Trying to go before the SPA started \u2014 block and stay
            history.pushState({ spaSite: true, view: _currentSpaView }, '', '/');
            _spaHandlingPop = false;
            return;
        }

        const targetView = state.view;

        // 2. Back from admin \u2192 show dashboard
        if (_currentSpaView === 'admin') {
            _currentSpaView = targetView;
            adminView.classList.add('hidden');
            checkAccessAndRoute();
            _spaHandlingPop = false;
            return;
        }

        // 3. Back from room \u2192 leave room gracefully
        if (_currentSpaView === 'room') {
            _currentSpaView = targetView;
            leaveRoom();
            _spaHandlingPop = false;
            return;
        }

        // 4. Back on dashboard/payment \u2192 stay (block leaving SPA)
        if (_currentSpaView === 'dashboard' || _currentSpaView === 'payment') {
            history.pushState({ spaSite: true, view: _currentSpaView }, '', '/');
            _spaHandlingPop = false;
            return;
        }

        // Fallback
        history.pushState({ spaSite: true, view: _currentSpaView }, '', '/');
    } catch(err) { console.error('[SPA Nav]', err); }
    _spaHandlingPop = false;
});


// Payment Elements
const btnPayOneTime = document.getElementById('btn-pay-one-time');
const btnPayWeekly = document.getElementById('btn-pay-weekly');
const btnPayMonthly = document.getElementById('btn-pay-monthly');
const accessCodeInput = document.getElementById('access-code-input');
const btnRedeemCode = document.getElementById('btn-redeem-code');
const redeemMsg = document.getElementById('redeem-msg');
const guestRoomInput = document.getElementById('guest-room-input');
const btnJoinGuestRoom = document.getElementById('btn-join-guest-room');
const guestJoinMsg = document.getElementById('guest-join-msg');

// Admin Elements
const btnAdminDash = document.getElementById('btn-admin-dash');
const btnAdminClose = document.getElementById('btn-admin-close');
const adminCodeDuration = document.getElementById('admin-code-duration');
const adminCodeUses = document.getElementById('admin-code-uses');
const btnAdminGenerateCode = document.getElementById('btn-admin-generate-code');
const adminCodeResult = document.getElementById('admin-code-result');
const adminNewCode = document.getElementById('admin-new-code');
const btnAdminRefreshLedger = document.getElementById('btn-admin-refresh-ledger');
const adminLedgerBody = document.getElementById('admin-ledger-body');

// Auth Elements
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const btnForgotPwd = document.getElementById('btn-forgot-pwd');
const btnToggleAuth = document.getElementById('btn-toggle-auth');
const btnGoogleLogin = document.getElementById('btn-google-login');
const authTitle = document.getElementById('auth-title');
const authError = document.getElementById('auth-error');
const passwordGroup = document.getElementById('password-group');
const btnLogout = document.getElementById('btn-logout');
const dashboardUserName = document.getElementById('dashboard-user-name');
const setupNameInput = document.getElementById('setup-name-input');
const btnSaveProfile = document.getElementById('btn-save-profile');

// Dashboard Manual Join Elements
const inputJoinKey = document.getElementById('join-key-input');
const btnJoin = document.getElementById('btn-join');

// Room Elements
const roomNameDisplay = document.getElementById('room-name-display');
const roomIdDisplay = document.getElementById('room-id-display');
const btnLeave = document.getElementById('btn-leave');
const btnCopy = document.getElementById('btn-copy');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');

const chatPopup = document.getElementById('chat-popup');
const btnChatFab = document.getElementById('btn-chat-fab');
const chatBadge = document.getElementById('chat-badge');
const chatNotification = document.getElementById('chat-notification');
const notifName = document.getElementById('notif-name');
const notifText = document.getElementById('notif-text');

let unreadCount = 0;
let notifTimeout = null;

const sourceUi = document.getElementById('source-ui');
const playerWrapper = document.getElementById('custom-player-wrapper');
const mainVideo = document.getElementById('main-video');
const roomUrlInput = document.getElementById('room-url-input');
const roomFileUpload = document.getElementById('room-file-upload');
const syncOverlay = document.getElementById('sync-overlay');
const btnSyncPlayback = document.getElementById('btn-sync-playback');
const waitingUi = document.getElementById('waiting-ui');

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const settingsModal = document.getElementById('settings-modal');
const btnPlayerSettings = document.getElementById('btn-player-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsUrlInput = document.getElementById('settings-url-input');
const btnApplySettings = document.getElementById('btn-apply-settings');

// Generic Alert Modal
const alertModal = document.getElementById('alert-modal');
const alertModalTitle = document.getElementById('alert-modal-title');
const alertModalText = document.getElementById('alert-modal-text');
const btnCloseAlert = document.getElementById('btn-close-alert');

function showCustomAlert(title, message) {
    alertModalTitle.textContent = title;
    alertModalText.textContent = message;
    alertModal.classList.remove('hidden');
    alertModal.style.display = 'flex';
}

btnCloseAlert.addEventListener('click', () => {
    alertModal.classList.add('hidden');
    alertModal.style.display = 'none';
});

// ==== AUTH & PROFILE LOGIC ====
let authMode = 'login'; 

btnToggleAuth.addEventListener('click', () => {
    if (authMode === 'login') {
        authMode = 'register';
        authTitle.textContent = 'Create Account';
        btnAuthSubmit.textContent = 'Sign Up';
        btnToggleAuth.textContent = 'Back to Login';
        passwordGroup.classList.remove('hidden');
        authPassword.required = true;
    } else {
        authMode = 'login';
        authTitle.textContent = 'Sign In';
        btnAuthSubmit.textContent = 'Sign In';
        btnToggleAuth.textContent = 'Create Account';
        passwordGroup.classList.remove('hidden');
        authPassword.required = true;
    }
    authError.classList.add('hidden');
});

btnForgotPwd.addEventListener('click', () => {
    authMode = 'reset';
    authTitle.textContent = 'Reset Password';
    btnAuthSubmit.textContent = 'Send Reset Link';
    btnToggleAuth.textContent = 'Back to Login';
    passwordGroup.classList.add('hidden');
    authPassword.required = false;
    authError.classList.add('hidden');
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    btnAuthSubmit.disabled = true;
    const authRefForm = document.getElementById('auth-referral');
    if (authRefForm && authRefForm.value) window._pendingAuthReferral = authRefForm.value.trim().toUpperCase();
    const email = authEmail.value;
    const password = authPassword.value;
    
    try {
        if (authMode === 'login') {
            await signInWithEmailAndPassword(auth, email, password);
        } else if (authMode === 'register') {
            await createUserWithEmailAndPassword(auth, email, password);
        } else if (authMode === 'reset') {
            await sendPasswordResetEmail(auth, email);
            authError.classList.remove('hidden', 'bg-red-900', 'text-red-500');
            authError.classList.add('bg-green-900', 'text-green-500');
            authError.textContent = "Reset link sent to email!";
            btnAuthSubmit.disabled = false;
            return;
        }
    } catch (error) {
        authError.classList.remove('hidden', 'bg-green-900', 'text-green-500');
        authError.classList.add('bg-red-900', 'text-red-500');
        authError.textContent = error.message.replace('Firebase:', '').trim();
    }
    btnAuthSubmit.disabled = false;
});

btnGoogleLogin.addEventListener('click', async () => {
    try {
        const provider = new GoogleAuthProvider();
        const authRef = document.getElementById('auth-referral');
        if (authRef && authRef.value) window._pendingAuthReferral = authRef.value.trim().toUpperCase();
        await signInWithPopup(auth, provider);
    } catch (error) {
        authError.classList.remove('hidden');
        authError.textContent = error.message.replace('Firebase:', '').trim();
    }
});

if(btnLogout) btnLogout.addEventListener('click', () => signOut(auth));

async function generateUniqueRoomCode() {
    try {
        const res = await fetch('/api/generate-room-code');
        const d = await res.json();
        if (d.code) return d.code;
    } catch(e) {}
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

btnSaveProfile.addEventListener('click', async () => {
    const name = setupNameInput.value.trim();
    if (!name) return;
    btnSaveProfile.textContent = "Saving...";
    try {
        await updateProfile(auth.currentUser, { displayName: name });
        const code = await generateUniqueRoomCode();
        
        await fetch('/api/user-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: auth.currentUser.uid,
                email: auth.currentUser.email,
                displayName: name,
                roomCode: code,
                friends: [],
                friendRequests: []
            })
        });

        sessionUserName = name;
        if(dashboardUserName) dashboardUserName.textContent = `Hi, ${name}`;

        // Register as a new unique visitor
        fetch('/api/register-visitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: auth.currentUser.uid, displayName: name })
        }).catch(() => {});

        // \u{1F381} Referral code \u2014 store pending if user entered one
        const refInput = document.getElementById('setup-ref-input');
        const refCode = refInput ? refInput.value.trim().toUpperCase() : '';
        if (refCode && refCode.length >= 4) {
            const refStatusEl = document.getElementById('ref-status-msg');
            fetch('/api/apply-referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    newUserId: auth.currentUser.uid,
                    refCode,
                    deviceFingerprint: _deviceFingerprint || ''
                })
            }).then(r => r.json()).then(d => {
                if (d.success) {
                    const days = d.bonusDays;
                    const who = d.referrerIsPremium ? 'Premium member' : 'member';
                    showToast(
                        `\u{1F381} Code saved! You get +${days} days added to your first subscription. Your friend also gets +${days} days!`,
                        'success', 6000
                    );
                    if (refStatusEl) {
                        refStatusEl.textContent = `\u2705 Referral saved \u2014 +${days} days bonus on first purchase`;
                        refStatusEl.style.color = '#4ade80';
                    }
                } else {
                    if (refStatusEl) {
                        refStatusEl.textContent = `\u26A0\uFE0F ${d.error}`;
                        refStatusEl.style.color = '#f87171';
                    }
                }
            }).catch(() => {});
        }

        
        setupProfileView.classList.add('hidden');
        await _pollUserDoc();
        initWebSocket(true);
        checkAccessAndRoute();
    } catch (e) {
        console.error(e);
        btnSaveProfile.textContent = "Error";
    }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        sessionUserId = user.uid;
        // \u26A0\uFE0F DO NOT hide authView here \u2014 wait until we know which view to show
        // authView will be hidden inside the branches below to prevent black screen
        
        initWebSocket(true); // Sign into Presence Layer

        try {
            // Try cache first for instant load
            const _cachedDoc = localStorage.getItem('vsetu_userdoc_' + user.uid);
            let _udJson;
            if (_cachedDoc) {
                try { _udJson = JSON.parse(_cachedDoc); } catch(e) {}
            }
            // Always fetch fresh in background (non-blocking)
            const _fetchFresh = fetch('/api/user-doc?uid=' + user.uid)
                .then(r => r.json())
                .then(fresh => { if (fresh.exists) localStorage.setItem('vsetu_userdoc_' + user.uid, JSON.stringify(fresh)); return fresh; })
                .catch(() => null);
            // If no cache, wait for fresh
            if (!_udJson || !_udJson.exists) _udJson = await _fetchFresh;
            const userSnap = { exists: () => _udJson && _udJson.exists, data: () => _udJson && _udJson.data };

            if (!_udJson.exists) {
                authView.classList.add('hidden'); // hide auth only now
                if (user.displayName) {
                    // Google Login provides a name, so auto-complete profile setup!
                    setupNameInput.value = user.displayName;
                    btnSaveProfile.click();
                } else {
                    setupProfileView.classList.remove('hidden');
                    dashView.classList.add('hidden');
                }
            } else if (!userSnap.data().displayName) {
                authView.classList.add('hidden'); // hide auth only now
                setupProfileView.classList.remove('hidden');
                dashView.classList.add('hidden');
            } else {
                currentUserDoc = userSnap.data();
                sessionUserName = currentUserDoc.displayName;
                if(dashboardUserName) dashboardUserName.textContent = `Hi, ${currentUserDoc.displayName}`;
                if (currentUserDoc.roomName) {
                    const roomNameDisplay = document.getElementById('room-name-display');
                    if (roomNameDisplay) roomNameDisplay.textContent = currentUserDoc.roomName;
                }
                // Sync mobile UI username + plan \u2014 use raw displayName NOT the "Hi, X" version
                const _cleanName = currentUserDoc.displayName || 'You';
                window._mobCleanName = _cleanName; // stored for profile tab
                const mobName = document.getElementById('mob-username-display');
                const mobWelcome = document.getElementById('mob-welcome-name');
                if (mobName) mobName.textContent = _cleanName;
                if (mobWelcome) mobWelcome.textContent = _cleanName;
                window._mobUserPlan = currentUserDoc.activeSubscription || 'free';
                document.dispatchEvent(new CustomEvent('vaanisethu:userdata-loaded', { detail: currentUserDoc }));
                authView.classList.add('hidden'); // hide auth only now
                setupProfileView.classList.add('hidden');
                
                if (user.email === 'anubhabmohapatra.01@gmail.com') {
                    btnAdminDash.classList.remove('hidden');
                    // Show mobile admin section
                    const mobAdminSec = document.getElementById('mob-admin-section');
                    if (mobAdminSec) mobAdminSec.style.display = 'block';
                    // Check unread help desk messages
                    fetch('/api/unread-messages').then(r => r.json()).then(d => {
                      const lbl = document.getElementById('mob-admin-msg-label');
                      if (lbl && d.count > 0) lbl.textContent = 'Help Desk Messages (' + d.count + ' new)';
                    }).catch(() => {});
                } else {
                    btnAdminDash.classList.add('hidden');
                    const mobAdminSec = document.getElementById('mob-admin-section');
                    if (mobAdminSec) mobAdminSec.style.display = 'none';
                }

                // Register visitor for ALL users (server deduplicates by userId \u2014 no double count)
                fetch('/api/register-visitor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: user.uid, displayName: currentUserDoc.displayName })
                }).catch(() => {});

                checkAccessAndRoute();
                setupProfileView.classList.add('hidden');
        await _pollUserDoc();
            }
                } catch (err) {
            console.error("Failed to load user profile:", err);
            authView.style.display = 'flex';
            authView.classList.remove('hidden');
            authError.classList.remove('hidden', 'bg-green-900', 'text-green-500');
            authError.classList.add('bg-red-900', 'text-red-500');
            authError.textContent = "Login Error: " + err.message;
            // authView stays visible so user can see the error
        }
    } else {
        currentUser = null;
        if (ws) { ws.close(); ws = null; currentRoomId = null; }
        roomView.classList.add('hidden'); dashView.classList.add('hidden'); setupProfileView.classList.add('hidden');
        paymentView.classList.add('hidden'); adminView.classList.add('hidden');
        // Reveal auth view \u2014 override the default display:none set in HTML
        authView.style.display = 'flex';
        authView.classList.remove('hidden');
        authError.classList.add('hidden');
        authError.classList.remove('bg-green-900', 'text-green-500'); authError.classList.add('bg-red-900', 'text-red-500');
        if(unsubscribeDoc) { unsubscribeDoc(); unsubscribeDoc = null; }
    if (currentUser) localStorage.removeItem('vsetu_userdoc_' + currentUser.uid);
    }
});

// ==== SUPABASE REALTIME (Firestore-like instant sync) ====
function _applyUserDoc(data) {
    if (!data) return;
    const out = {};
    for (const [k, v] of Object.entries(data))
        out[k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = v;
    currentUserDoc = out;
    if (currentUser) localStorage.setItem('vsetu_userdoc_' + currentUser.uid, JSON.stringify({ exists: true, data: out }));
    const codeEl = document.getElementById('my-room-code');
    if (codeEl) codeEl.textContent = out.roomCode || '';
    renderFriendRequests(out.friendRequests || []);
    renderFriends(out.friends || []);
    checkAccessAndRoute();
}
async function _pollUserDoc() {
    if (!currentUser) return;
    try {
        const _r = await fetch('/api/user-doc?uid=' + currentUser.uid + '&_t=' + Date.now()).then(r => r.json());
        if (_r && _r.exists && _r.data) _applyUserDoc(_r.data);
    } catch(e) {}
}
let _sbChannel = null;
async function listenToUserDoc() {
    if (unsubscribeDoc) unsubscribeDoc();
    await _pollUserDoc(); // instant first load
    // Try Supabase Realtime (same speed as Firestore onSnapshot)
    try {
        const sb = await getSBClient();
        if (!sb) throw new Error('No client');
        if (_sbChannel) sb.removeChannel(_sbChannel);
        _sbChannel = sb.channel('ud-' + currentUser.uid)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'users',
                filter: 'uid=eq.' + currentUser.uid
            }, (payload) => {
                if (payload.new) _applyUserDoc(payload.new);
            })
            .subscribe();
        unsubscribeDoc = () => {
            if (_sbChannel && sb) { sb.removeChannel(_sbChannel); _sbChannel = null; }
        };
        console.log('[Realtime] subscribed to user doc');
    } catch(e) {
        console.warn('[Realtime] fallback to polling:', e.message);
        const _p = setInterval(_pollUserDoc, 30000);
        unsubscribeDoc = () => clearInterval(_p);
    }

    // Refresh presence logic for friends periodically or if friends change
    if(ws && ws.readyState === WebSocket.OPEN && currentUserDoc && currentUserDoc.friends) {
        ws.send(JSON.stringify({ type: "subscribe-presence", friendIds: currentUserDoc.friends }));
    }
}

// ==== ACCESS GATEKEEPER & PAYMENTS ====
function hasValidAccess() {
    if (currentUser.email === 'anubhabmohapatra.01@gmail.com') return true;
    // Active paid or ad-pass subscription
    if (currentUserDoc && currentUserDoc.activeSubscription && currentUserDoc.subscriptionExpiry) {
        if (Date.now() < currentUserDoc.subscriptionExpiry) return true;
    }
    // Ad pass (legacy field fallback in case subscriptionExpiry not set by older records)
    if (currentUserDoc && currentUserDoc.adPassActive && currentUserDoc.adPassExpiry) {
        if (Date.now() < currentUserDoc.adPassExpiry) return true;
    }
    // First-time free pass
    if (currentUserDoc && currentUserDoc.freePassActive && currentUserDoc.freePassExpiry) {
        if (Date.now() < currentUserDoc.freePassExpiry) return true;
    }
    return false;
}

let _monetagInjected = false;
function injectMonetagAdsIfApplicable() {
    if (_monetagInjected) return;
    const paidPlans = ['weekly', 'monthly', 'access-code', 'extended_by_admin', 'one-time'];
    const isPaid = currentUserDoc && paidPlans.includes(currentUserDoc.activeSubscription) && currentUserDoc.subscriptionExpiry > Date.now();
    if (isPaid || currentUser.email === 'anubhabmohapatra.01@gmail.com') return;
    
    // 1. Onclick (Popunder)
    const s1 = document.createElement('script');
    s1.src = 'https://quge5.com/88/tag.min.js';
    s1.dataset.zone = '233739';
    s1.async = true;
    s1.dataset.cfasync = 'false';
    document.head.appendChild(s1);

    // 2. In-Page Push
    (function(s){s.dataset.zone='10928467',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));

    // 3. Push Notifications
    const s3 = document.createElement('script');
    s3.src = 'https://5gvci.com/act/files/tag.min.js?z=10928470';
    s3.async = true;
    s3.dataset.cfasync = 'false';
    document.head.appendChild(s3);

    _monetagInjected = true;
}


function showCustomMonetagWarning() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] px-4';
    overlay.innerHTML = `<div class="bg-zinc-900 border border-orange-500/50 rounded-xl max-w-sm w-full p-6 text-center shadow-2xl transform transition-all scale-100"><div class="w-16 h-16 mx-auto mb-4 bg-orange-500/10 rounded-full flex items-center justify-center"><span class="text-3xl">??</span></div><h3 class="text-xl font-bold text-white mb-2">Important Notice / ?????? ?????</h3><p class="text-sm text-zinc-300 mb-4 leading-relaxed"><span class="font-bold text-orange-400">English:</span> As a free user, you will see ads to support our platform. Clicking anywhere on the screen might open an ad in a new tab. Please close the ad tab and return here to continue watching.<br><br><span class="font-bold text-orange-400">?????:</span> ????? ?? ???? ??? ?? ????? ?? ??? ???, ????? ???? ???????? (Ads) ????? ?????? ??????? ?? ???? ?? ????? ???? ?? ?? ?? ??? ??? ???????? ??? ???? ??? ????? ?? ??? ?? ??? ???? ?? ???? ????? ????? ?? ??? ???? ???? ?? ???? ?????????? ?? ???? ???? ??? ??? ???? ???</p><button class="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold py-3 rounded-lg hover:from-orange-600 hover:to-red-600 transition-colors shadow-lg shadow-orange-500/20">I Understand / ??? ??? ???</button></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('button').addEventListener('click', () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    });
}

function checkAccessAndRoute() {
    if (adminView && !adminView.classList.contains('hidden')) return; // let them stay in admin view

    injectMonetagAdsIfApplicable();
    if (sessionStorage.getItem('showMonetagWarning') === 'true') {
        sessionStorage.removeItem('showMonetagWarning');
        showCustomMonetagWarning();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join') ? urlParams.get('join').toUpperCase() : null;

    if (!hasValidAccess() && joinCode) {
        // Evaluate if joinCode's owner is subbed OR on their free day
        fetch(`/api/check-room-access?roomCode=${joinCode}`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.hostSubscribed) {
                    currentGuestAccessRoom = joinCode;
                    paymentView.classList.add('hidden');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    showRoom(joinCode);
                } else {
                    dashView.classList.add('hidden');
                    roomView.classList.add('hidden');
                    paymentView.classList.remove('hidden');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    showFreePassCardIfEligible();
                }
            })
            .catch(() => {
                dashView.classList.add('hidden');
                roomView.classList.add('hidden');
                paymentView.classList.remove('hidden');
            });
        return; // wait for fetch
    }

    if (!hasValidAccess()) {
        // \u{1F527} FIX: IMMEDIATELY show payment view (no black screen)
        dashView.classList.add('hidden');
        roomView.classList.add('hidden');
        paymentView.classList.remove('hidden');
        currentGuestAccessRoom = null;
        if (!_spaHandlingPop) spaPushState('payment');
        showFreePassCardIfEligible();

        // THEN check if admin turned Free Day ON (async, updates if needed)
        getPlatformConfig().then(config => {
            if (config && config.freeDayActive) {
                // Free Day active \u2014 override payment wall
                paymentView.classList.add('hidden');
                if (!currentRoomId) {
                    dashView.classList.remove('hidden');
                    if (!_spaHandlingPop) spaPushState('dashboard');
                }
            }
            // else: payment view already shown above, nothing to do
        });
    } else {
        paymentView.classList.add('hidden');
        if (joinCode && !currentRoomId) {
            window.history.replaceState({}, document.title, window.location.pathname);
            showRoom(joinCode);
        } else if (!currentRoomId) {
            dashView.classList.remove('hidden');
            if (!_spaHandlingPop) spaPushState('dashboard');
        }

        // \u2500\u2500 Premium page routing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        // ONLY weekly/monthly/access-code users \u2192 /premium.html (zero ads)
        // 1-day (\u20B950) users \u2192 stay on index.html (reduced 3 in-movie ad breaks)
        const onPremiumPage = window.location.pathname.includes('premium.html') ||
                              window._IS_PREMIUM_PAGE === true;
        const isActuallyFullPremium = isFullPremiumUser(); // weekly/monthly only

        if (isActuallyFullPremium && !onPremiumPage) {
            window.location.replace('/premium.html');
            return;
        }
        if (!isActuallyFullPremium && onPremiumPage) {
            window.location.replace('/');
            return;
        }
    }
}

// Show/hide the "Claim Free Pass" card on payment view based on eligibility
function showFreePassCardIfEligible() {
    const freePassCard = document.getElementById('free-pass-card');
    if (!freePassCard || !currentUser) return;

    // Already claimed in Firestore
    const claimedInDb = currentUserDoc && 
        (currentUserDoc.freePassActive || currentUserDoc.freePassClaimedAt);
    // Already claimed in localStorage (same browser, different account)
    const claimedInBrowser = localStorage.getItem('_vns_claimed') === '1';

    if (claimedInDb || claimedInBrowser) {
        freePassCard.style.display = 'none';
    } else {
        freePassCard.style.display = 'block';
    }
}

async function claimFreePass() {
    const btn = document.getElementById('btn-claim-free-pass');
    const msgEl = document.getElementById('free-pass-msg');
    if (!btn || !currentUser) return;

    btn.disabled = true;
    if (msgEl) { msgEl.textContent = ''; msgEl.classList.add('hidden'); }

    // Wait for fingerprint to be ready (max 4 seconds)
    if (!_fpReady) {
        btn.textContent = 'Preparing...';
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (_fpReady) { clearInterval(check); resolve(); }
            }, 200);
            setTimeout(() => { clearInterval(check); resolve(); }, 4000);
        });
    }

    // If fingerprint still empty after waiting, fallback to localKey-only approach
    // but still block (server will reject empty fingerprint)
    if (!_deviceFingerprint) {
        if (msgEl) {
            msgEl.textContent = 'Could not verify your device. Please refresh and try again.';
            msgEl.className = 'text-xs mt-3 text-red-400';
            msgEl.classList.remove('hidden');
        }
        btn.textContent = 'Claim Free 24-Hour Pass';
        btn.disabled = false;
        return;
    }

    btn.textContent = 'Claiming...';

    // Check localStorage FIRST before even hitting server
    if (localStorage.getItem('_vns_claimed') === '1') {
        if (msgEl) {
            msgEl.textContent = 'Free pass already claimed on this browser. Please purchase a plan.';
            msgEl.className = 'text-xs mt-3 text-red-400';
            msgEl.classList.remove('hidden');
        }
        btn.textContent = 'Already Claimed';
        btn.disabled = true;
        showFreePassCardIfEligible();
        return;
    }

    try {
        const localKey = getLocalClaimKey();
        const res = await fetch('/api/claim-free-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: (currentUserDoc?.uid || currentUser?.uid), 
                fingerprint: _deviceFingerprint,
                localKey
            })
        });
        const data = await res.json();

        if (data.success) {
            // Mark in localStorage so same browser can't claim again even with new account
            localStorage.setItem('_vns_claimed', '1');
            if (msgEl) {
                msgEl.textContent = 'Free Pass Activated! Entering dashboard...';
                msgEl.className = 'text-xs mt-3 text-green-400';
                msgEl.classList.remove('hidden');
            }
            // Force-refresh user doc then route to dashboard
            setTimeout(() => _pollUserDoc(), 1500);
        } else {
            if (msgEl) {
                msgEl.textContent = data.error || 'Could not claim free pass.';
                msgEl.className = 'text-xs mt-3 text-red-400';
                msgEl.classList.remove('hidden');
            }
            btn.textContent = 'Claim Free 24-Hour Pass';
            btn.disabled = false;
        }
    } catch(e) {
        if (msgEl) {
            msgEl.textContent = 'Network error. Please try again.';
            msgEl.className = 'text-xs mt-3 text-red-400';
            msgEl.classList.remove('hidden');
        }
        btn.textContent = 'Claim Free 24-Hour Pass';
        btn.disabled = false;
    }
}

async function initiateCheckout(plan, amount) {
    try {
        // Wait for Razorpay SDK to be ready (it loads deferred \u2014 may not be ready on very slow connections)
        if (!window.Razorpay) {
            await new Promise((resolve, reject) => {
                let attempts = 0;
                const check = setInterval(() => {
                    attempts++;
                    if (window.Razorpay) { clearInterval(check); resolve(); }
                    else if (attempts > 50) { clearInterval(check); reject(new Error('Payment gateway not loaded. Please refresh and try again.')); }
                }, 100); // checks every 100ms, max 5 seconds
            });
        }

        const orderRes = await fetch('/api/create-order', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ plan, amount })
        });
        const order = await orderRes.json();
        
        if (!order || !order.id) throw new Error("Failed to create order");


        const options = {
            key: order.keyId,
            amount: order.amount,
            currency: "INR",
            name: "Vaanisetu",
            description: `${plan} Access`,
            order_id: order.id,
            handler: async function (response) {
                // Verify payment
                const verifyRes = await fetch('/api/verify-payment', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        userId: (currentUserDoc?.uid || currentUser?.uid),
                        plan: plan,
                        amount: amount
                    })
                });
                const verifyData = await verifyRes.json();
                if (verifyData.success) {
                    showCustomAlert("Success", "Payment successful! Your pass is active.");
                    // listenToUserDoc will trigger checkAccessAndRoute() automatically
                } else {
                    showCustomAlert("Error", "Payment verification failed.");
                }
            },
            prefill: { email: currentUser.email },
            theme: { color: "#F97316" }
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
    } catch (e) {
        console.error(e);
        showCustomAlert("Error", "Could not initiate payment: " + e.message);
    }
}

if (btnPayOneTime) btnPayOneTime.addEventListener('click', () => initiateCheckout('one-time', 50));
if (btnPayWeekly) btnPayWeekly.addEventListener('click', () => initiateCheckout('weekly', 150));
if (btnPayMonthly) btnPayMonthly.addEventListener('click', () => initiateCheckout('monthly', 400));

// Access Code Redemption
if (btnRedeemCode) {
    btnRedeemCode.addEventListener('click', async () => {
        const code = accessCodeInput.value.trim().toUpperCase();
        redeemMsg.classList.remove('hidden');
        if (code.length !== 19 && code.length !== 16) { // Account for XXXX-XXXX-XXXX-XXXX
            redeemMsg.textContent = "Invalid code format.";
            redeemMsg.className = "text-xs mt-3 text-red-500";
            return;
        }
        
        btnRedeemCode.textContent = '...';
        btnRedeemCode.disabled = true;

        try {
            const res = await fetch('/api/redeem-code', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ code: code, userId: (currentUserDoc?.uid || currentUser?.uid) })
            });
            const data = await res.json();
            
            if (data.success) {
                redeemMsg.textContent = "Code redeemed successfully!";
                redeemMsg.className = "text-xs mt-3 text-green-500";
                // The `listenToUserDoc` snapshot will automatically pick up the new expiry date and route to dashboard!
            } else {
                redeemMsg.textContent = data.error || "Error redeeming code.";
                redeemMsg.className = "text-xs mt-3 text-red-500";
            }
        } catch (e) {
            console.error(e);
            redeemMsg.textContent = "Error redeeming code.";
            redeemMsg.className = "text-xs mt-3 text-red-500";
        }
        
        btnRedeemCode.textContent = 'Redeem';
        btnRedeemCode.disabled = false;
    });
}

// Guest Room Check
if (btnJoinGuestRoom) {
    btnJoinGuestRoom.addEventListener('click', async () => {
        const code = guestRoomInput.value.trim().toUpperCase();
        guestJoinMsg.classList.remove('hidden');
        if (code.length < 5) {
            guestJoinMsg.textContent = "Invalid room code.";
            guestJoinMsg.className = "text-xs mt-3 text-red-500";
            return;
        }

        btnJoinGuestRoom.textContent = '...';
        btnJoinGuestRoom.disabled = true;

        try {
            const res = await fetch(`/api/check-room-access?roomCode=${code}`);
            const data = await res.json();
            
            if (data.success && data.hostSubscribed) {
                guestJoinMsg.textContent = "Guest Pass Granted! Joining...";
                guestJoinMsg.className = "text-xs mt-3 text-green-500";
                currentGuestAccessRoom = code;
                setTimeout(() => {
                    paymentView.classList.add('hidden');
                    showRoom(code);
                }, 500);
            } else {
                guestJoinMsg.textContent = data.error || "Room owner does not have an active pass.";
                guestJoinMsg.className = "text-xs mt-3 text-red-500";
            }
        } catch (e) {
            guestJoinMsg.textContent = "Error checking room access.";
            guestJoinMsg.className = "text-xs mt-3 text-red-500";
        }
        
        btnJoinGuestRoom.textContent = 'Join Free';
        btnJoinGuestRoom.disabled = false;
    });
}

// ==== ADMIN DASHBOARD ROUTING ====
if (btnAdminDash) {
    btnAdminDash.addEventListener('click', () => {
        dashView.classList.add('hidden');
        roomView.classList.add('hidden');
        paymentView.classList.add('hidden');
        adminView.classList.remove('hidden');
        spaPushState('admin');
        loadAdminLedger();
        loadCodeUsers();
        loadRentalLedger();
        loadVisitorStats();
        loadFreeDayStatus();
    });
}

// Free Pass claim button
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-claim-free-pass') {
        claimFreePass();
    }
});
if (btnAdminClose) {
    btnAdminClose.addEventListener('click', () => {
        adminView.classList.add('hidden');
        checkAccessAndRoute();
    });
}

if (btnAdminGenerateCode) {
    btnAdminGenerateCode.addEventListener('click', async () => {
        const dur = parseInt(adminCodeDuration.value) || 1;
        const uses = parseInt(adminCodeUses.value) || 1;
        
        // Generate random 16 chars
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let newCode = '';
        for(let i=0; i<16; i++) {
           newCode += charset.charAt(Math.floor(Math.random() * charset.length));
        }

        try {
            const res = await fetch('/api/generate-code', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                   durationDays: dur,
                   maxUses: uses,
                   adminEmail: currentUser.email
                })
            });
            const data = await res.json();
            
            if (data.success) {
                adminNewCode.textContent = data.code.match(/.{1,4}/g).join('-');
                adminCodeResult.classList.remove('hidden');
            } else {
                throw new Error(data.error);
            }
        } catch(e) {
            console.error(e);
            showCustomAlert("Error", "Could not generate code: " + e.message);
        }
    });
}

if (btnAdminRefreshLedger) {
    btnAdminRefreshLedger.addEventListener('click', loadAdminLedger);
}

async function loadAdminLedger() {
    if (!adminLedgerBody) return;
    adminLedgerBody.innerHTML = '<tr><td colspan="6" class="py-10 text-center italic text-zinc-600">Loading data...</td></tr>';
    try {
        const res = await fetch(`/api/ledger?adminEmail=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        
        const thRow = adminLedgerBody.parentElement.querySelector('thead tr');
        if (thRow && thRow.children.length === 5) {
            const th = document.createElement('th');
            th.className = "px-4 py-3 text-right";
            th.textContent = "Actions";
            thRow.appendChild(th);
        }

        if (!data.success || !data.payments || data.payments.length === 0) {
            adminLedgerBody.innerHTML = '<tr><td colspan="6" class="py-10 text-center italic text-zinc-600">No purchases found.</td></tr>';
            return;
        }

        adminLedgerBody.innerHTML = '';
        const payments = data.payments;

        for (const p of payments) {
             const dt = p.timestamp ? new Date(p.timestamp._seconds * 1000) : null;
             const timeStr = dt ? `<div class="font-bold">${dt.toLocaleDateString()}</div><div class="text-[0.65rem] text-zinc-500">${dt.toLocaleTimeString()}</div>` : 'N/A';
             
             const isCancelled = !p.currentSub || p.currentExp < Date.now();

             let actionsHTML = '';
             if (isCancelled) {
                 actionsHTML = `
                     <span style="font-size:0.7rem;font-weight:800;color:#f87171;margin-right:0.35rem;">Cancelled</span>
                     <select class="extend-days-select" style="background:#0d0d0f;border:1px solid #222224;border-radius:0.4rem;color:#a1a1aa;font-size:0.7rem;padding:0.3rem 0.4rem;">
                         <option value="1">1 Day</option><option value="3">3 Days</option>
                         <option value="7">7 Days</option><option value="30">30 Days</option>
                     </select>
                     <button class="btn-admin-extend" style="background:rgba(59,130,246,0.1);color:#60a5fa;border:1px solid rgba(59,130,246,0.25);border-radius:0.4rem;padding:0.3rem 0.6rem;font-size:0.7rem;font-weight:700;cursor:pointer;">Extend</button>
                 `;
             } else {
                 actionsHTML = `
                     <button class="btn-admin-cancel" style="background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);border-radius:0.4rem;padding:0.3rem 0.6rem;font-size:0.7rem;font-weight:700;cursor:pointer;margin-right:0.35rem;">Cancel</button>
                     <select class="extend-days-select" style="background:#0d0d0f;border:1px solid #222224;border-radius:0.4rem;color:#a1a1aa;font-size:0.7rem;padding:0.3rem 0.4rem;">
                         <option value="1">1 Day</option><option value="3">3 Days</option>
                         <option value="7">7 Days</option><option value="30">30 Days</option>
                     </select>
                     <button class="btn-admin-extend" style="background:rgba(59,130,246,0.1);color:#60a5fa;border:1px solid rgba(59,130,246,0.25);border-radius:0.4rem;padding:0.3rem 0.6rem;font-size:0.7rem;font-weight:700;cursor:pointer;">Extend</button>
                 `;
             }

             const planLow = (p.plan || '').toLowerCase();
             let tierClass = 'tier-badge-onetime';
             if (planLow.includes('weekly') || planLow.includes('week')) tierClass = 'tier-badge-weekly';
             else if (planLow.includes('monthly') || planLow.includes('month')) tierClass = 'tier-badge-monthly';
             else if (planLow.includes('film') || planLow.includes('rental')) tierClass = 'tier-badge-monthly';

             const tr = document.createElement('tr');
             tr.innerHTML = `
                 <td style="padding: 0.85rem 1.5rem; white-space:nowrap;">${timeStr}</td>
                 <td style="padding: 0.85rem 1.5rem; font-family:monospace; font-size:0.7rem; color:#52525b; white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis;">${p.userId}</td>
                 <td style="padding: 0.85rem 1.5rem; white-space:nowrap;"><span class="tier-badge ${tierClass}">${p.plan}</span></td>
                 <td style="padding: 0.85rem 1.5rem; color:#4ade80; font-weight:800; white-space:nowrap;">\u20B9${p.amount}</td>
                 <td style="padding: 0.85rem 1.5rem; font-family:monospace; font-size:0.68rem; color:#52525b; white-space:nowrap;">${p.orderId}</td>
                 <td style="padding: 0.85rem 1.5rem; text-align:right; white-space:nowrap;">
                     ${actionsHTML}
                 </td>
             `;
             
             const btnCancel = tr.querySelector('.btn-admin-cancel');
             const btnExtend = tr.querySelector('.btn-admin-extend');
             const selectDays = tr.querySelector('.extend-days-select');
             
             if(btnCancel) btnCancel.onclick = () => manageUserSubscription(p.userId, 'cancel', btnCancel, null);
             if(btnExtend) btnExtend.onclick = () => manageUserSubscription(p.userId, 'extend', btnExtend, selectDays.value);

             adminLedgerBody.appendChild(tr);
        }
    } catch(e) {
        console.error(e);
        adminLedgerBody.innerHTML = '<tr><td colspan="6" class="py-10 text-center text-red-500">Error loading ledger. Check server logs.</td></tr>';
    }
}

async function manageUserSubscription(userId, action, btn, extendDays) {
    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    try {
        const res = await fetch('/api/admin-update-sub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminEmail: currentUser.email, targetUserId: userId, action, extendDays })
        });
        const data = await res.json();
        if (data.success) {
            btn.textContent = 'Done';
            btn.classList.add('text-green-500');
            setTimeout(() => { 
                btn.textContent = originalText; 
                btn.classList.remove('text-green-500'); 
                btn.disabled = false; 
                loadAdminLedger();
                loadCodeUsers(); // refresh both tables
            }, 1000);
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        alert("Failed to update user: " + e.message);
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function loadCodeUsers() {
    const container = document.getElementById('code-users-body');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="5" class="py-8 text-center italic text-zinc-600">Loading...</td></tr>';
    try {
        const res = await fetch(`/api/code-users?adminEmail=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();

        if (!data.success || !data.users || data.users.length === 0) {
            container.innerHTML = '<tr><td colspan="5" class="py-8 text-center italic text-zinc-600">No access-code users found.</td></tr>';
            return;
        }

        container.innerHTML = '';
        for (const u of data.users) {
            const expDate = new Date(u.subscriptionExpiry);
            const isExpired = u.subscriptionExpiry < Date.now();
            const expStr = `<div class="font-bold ${isExpired ? 'text-red-400' : 'text-green-400'}">${expDate.toLocaleDateString()}</div><div class="text-[0.65rem] text-zinc-500">${expDate.toLocaleTimeString()}</div>`;
            const statusBadge = isExpired
                ? '<span class="status-badge status-badge-expired">Expired</span>'
                : '<span class="status-badge status-badge-active">Active</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:0.85rem 1.5rem; color:white; font-weight:700; white-space:nowrap;">${u.displayName}</td>
                <td style="padding:0.85rem 1.5rem; font-family:monospace; font-size:0.7rem; color:#52525b; white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis;">${u.userId}</td>
                <td style="padding:0.85rem 1.5rem; white-space:nowrap;">${statusBadge}</td>
                <td style="padding:0.85rem 1.5rem; white-space:nowrap;">${expStr}</td>
                <td style="padding:0.85rem 1.5rem; text-align:right; white-space:nowrap;">
                    <div style="display:flex;gap:0.35rem;align-items:center;justify-content:flex-end;">
                    <button class="cu-cancel" style="background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);border-radius:0.4rem;padding:0.3rem 0.6rem;font-size:0.7rem;font-weight:700;cursor:pointer;">Terminate</button>
                    <select class="cu-days" style="background:#0d0d0f;border:1px solid #222224;border-radius:0.4rem;color:#a1a1aa;font-size:0.7rem;padding:0.3rem 0.4rem;">
                        <option value="1">1 Day</option><option value="3">3 Days</option><option value="7">7 Days</option><option value="30">30 Days</option>
                    </select>
                    <button class="cu-extend" style="background:rgba(59,130,246,0.1);color:#60a5fa;border:1px solid rgba(59,130,246,0.25);border-radius:0.4rem;padding:0.3rem 0.6rem;font-size:0.7rem;font-weight:700;cursor:pointer;">Extend</button>
                    </div>
                </td>
            `;

            const btnCancel = tr.querySelector('.cu-cancel');
            const btnExtend = tr.querySelector('.cu-extend');
            const selectDays = tr.querySelector('.cu-days');

            btnCancel.onclick = () => manageUserSubscription(u.userId, 'cancel', btnCancel, null);
            btnExtend.onclick = () => manageUserSubscription(u.userId, 'extend', btnExtend, selectDays.value);

            container.appendChild(tr);
        }
    } catch(e) {
        console.error(e);
        container.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-red-500">Error loading code users.</td></tr>';
    }
}

async function loadRentalLedger() {
    const tbody = document.getElementById('rental-ledger-body');
    if (!tbody || !currentUser) return;
    tbody.innerHTML = '<tr><td colspan="8" class="py-10 text-center italic text-zinc-600">Loading rental records...</td></tr>';
    try {
        const res = await fetch(`/api/admin/rental-ledger?adminEmail=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        // Update stats
        const elTotal = document.getElementById('rl-total');
        const elRevenue = document.getElementById('rl-revenue');
        const elActive = document.getElementById('rl-active');
        if (elTotal) elTotal.textContent = data.total || 0;
        if (elRevenue) elRevenue.textContent = '\u20b9' + (data.totalRevenue || 0);
        if (elActive) elActive.textContent = data.activeCount || 0;

        if (!data.rentals || data.rentals.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="py-10 text-center italic text-zinc-600">No film rentals yet.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        for (const r of data.rentals) {
            const rentedDate = r.rentedAt ? new Date(r.rentedAt) : null;
            const expiryDate = r.expiresAt ? new Date(r.expiresAt) : null;
            const timeStr = rentedDate
                ? `<div style="font-weight:700;color:#e4e4e7;">${rentedDate.toLocaleDateString()}</div><div style="font-size:0.65rem;color:#71717a;">${rentedDate.toLocaleTimeString()}</div>`
                : 'N/A';
            const expiryStr = expiryDate
                ? `<div style="font-weight:600;color:${r.isExpired ? '#f87171' : '#4ade80'};font-size:0.78rem;">${expiryDate.toLocaleDateString()}</div><div style="font-size:0.65rem;color:#71717a;">${expiryDate.toLocaleTimeString()}</div>`
                : 'N/A';
            const statusBadge = r.isExpired
                ? '<span class="status-badge status-badge-expired">Expired</span>'
                : '<span class="status-badge status-badge-active">Active</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:0.85rem 1.5rem;white-space:nowrap;">${timeStr}</td>
                <td style="padding:0.85rem 1.5rem;">
                    <div style="font-weight:700;color:white;font-size:0.82rem;">${r.displayName}</div>
                    <div style="font-family:monospace;font-size:0.62rem;color:#52525b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">${r.userId}</div>
                </td>
                <td style="padding:0.85rem 1.5rem;">
                    <div style="font-weight:700;color:#c084fc;font-size:0.82rem;">\u{1F3A6} ${r.filmTitle}</div>
                    <div style="font-size:0.65rem;color:#71717a;">${r.rentalDays} day rental</div>
                </td>
                <td style="padding:0.85rem 1.5rem;color:#4ade80;font-weight:800;white-space:nowrap;">\u20B9${r.amount}</td>
                <td style="padding:0.85rem 1.5rem;font-family:monospace;font-size:0.65rem;color:#52525b;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;" title="${r.paymentId}">${r.paymentId || '\u2014'}</td>
                <td style="padding:0.85rem 1.5rem;white-space:nowrap;">
                    <span style="background:rgba(168,85,247,0.1);color:#c084fc;border:1px solid rgba(168,85,247,0.25);border-radius:9999px;font-size:0.6rem;font-weight:800;padding:0.15rem 0.5rem;">${r.rentalDays}d</span>
                </td>
                <td style="padding:0.85rem 1.5rem;white-space:nowrap;">${statusBadge}</td>
                <td style="padding:0.85rem 1.5rem;white-space:nowrap;">${expiryStr}</td>
            `;
            tbody.appendChild(tr);
        }
    } catch(e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-red-500">Error: ${e.message}</td></tr>`;
    }
}

// ==== FRIEND SYSTEM LOGIC ====
document.getElementById('btn-open-add-friend').addEventListener('click', () => {
    const m = document.getElementById('add-friend-modal');
    m.classList.remove('hidden');
    m.style.display = 'flex';
});
document.getElementById('btn-close-add-friend').addEventListener('click', () => {
    const m = document.getElementById('add-friend-modal');
    m.classList.add('hidden');
    m.style.display = 'none';
});

document.getElementById('btn-send-request').addEventListener('click', async () => {
    const code = document.getElementById('add-friend-input').value.trim().toUpperCase();
    const errEl = document.getElementById('add-friend-err');
    const succEl = document.getElementById('add-friend-success');
    errEl.classList.add('hidden'); succEl.classList.add('hidden');

    if(!code || code === currentUserDoc.roomCode) {
        errEl.textContent = "Invalid code."; errEl.classList.remove('hidden'); return;
    }

    try {
        const _afRes = await fetch('/api/add-friend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromUid: currentUser.uid, toRoomCode: code })
        }).then(r => r.json());
        if (!_afRes.success) {
            errEl.textContent = _afRes.error || 'Error sending request.'; errEl.classList.remove('hidden'); return;
        }

        succEl.textContent = "Request sent!"; succEl.classList.remove('hidden');
        document.getElementById('add-friend-input').value = '';
        setTimeout(() => { 
            const m = document.getElementById('add-friend-modal');
            m.classList.add('hidden'); 
            m.style.display = 'none';
            succEl.classList.add('hidden'); 
        }, 1500);
    } catch (e) {
        console.error(e);
        errEl.textContent = "Error sending request."; errEl.classList.remove('hidden');
    }
});

async function acceptFriendRequest(reqId) {
    try {
        await fetch('/api/friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'accept', uid: currentUser.uid, reqId })
        });
        await _pollUserDoc();
    } catch(e) { console.error("Error accepting", e); }
}

async function declineFriendRequest(reqId) {
    try {
        await fetch('/api/friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'decline', uid: currentUser.uid, reqId })
        });
        await _pollUserDoc();
    } catch(e) { console.error("Error declining", e); }
}

async function renderFriendRequests(requesterIds) {
    const container = document.getElementById('friend-requests-container');
    const list = document.getElementById('requests-list');
    
    if (requesterIds.length === 0) {
       container.classList.add('hidden'); list.innerHTML = ''; return;
    }
    
    container.classList.remove('hidden'); list.innerHTML = '';

    for (const reqId of requesterIds) {
        const _rr = await fetch('/api/user-doc?uid=' + reqId).then(r=>r.json()).catch(()=>({exists:false}));
        if(!_rr.exists) continue;
        const reqData = _rr.data;

        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 rounded-lg bg-zinc-900 border border-zinc-800';
        div.innerHTML = `
           <div class="text-sm font-bold text-white overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">${reqData.displayName}</div>
           <div class="flex gap-2">
              <button class="icon-btn hover-bg text-green-500" title="Accept" id="btn-acc-${reqId}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></button>
              <button class="icon-btn hover-bg text-red-500" title="Decline" id="btn-dec-${reqId}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
           </div>
        `;
        list.appendChild(div);

        document.getElementById(`btn-acc-${reqId}`).onclick = () => acceptFriendRequest(reqId);
        document.getElementById(`btn-dec-${reqId}`).onclick = () => declineFriendRequest(reqId);
    }
}

async function renderFriends(friendIds) {
    const friendsListEl = document.getElementById('friends-list');
    const emptyMsg = document.getElementById('empty-friends-msg');
    
    if (friendsListEl) friendsListEl.innerHTML = '';
    
    if (!friendIds || friendIds.length === 0) {
        if(emptyMsg) emptyMsg.classList.remove('hidden'); 
        return;
    }
    
    if(emptyMsg) emptyMsg.classList.add('hidden');

    // Synchronize presence on web socket
    if(ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe-presence", friendIds }));
    }

    for (const fid of friendIds) {
        let friend = friendCache.get(fid);
        if (!friend) {
           const _fr = await fetch('/api/user-doc?uid=' + fid).then(r=>r.json()).catch(()=>({exists:false}));
           if(_fr.exists) {
               friend = _fr.data; friendCache.set(fid, friend);
           } else continue;
        }

        const isOnline = onlinePresence.has(fid);
        const statusClass = isOnline ? 'status-online' : 'status-offline';

        const div = document.createElement('div');
        div.className = 'friend-item';
        div.innerHTML = `
           <div class="friend-avatar">
               ${friend.displayName.charAt(0).toUpperCase()}
               <div class="friend-status ${statusClass}" id="status-${fid}"></div>
           </div>
           <div class="friend-info">
               <div class="friend-name">${friend.displayName}</div>
               <div class="friend-code">Code: ${friend.roomCode}</div>
           </div>
        `;
        const joinBtn = document.createElement('button');
        joinBtn.className = 'btn btn-primary';
        joinBtn.style = 'padding: 0.25rem 0.75rem; font-size: 0.75rem; max-width: 60px; pointer-events: auto;';
        joinBtn.textContent = 'Join';
        joinBtn.onclick = async () => {
             joinBtn.textContent = '...';
             joinBtn.disabled = true;
             
             const _jb = await fetch('/api/user-doc?uid=' + fid).then(r=>r.json()).catch(()=>({exists:false}));
             if (_jb.exists) {
                 const freshCode = _jb.data.roomCode;
                 if (freshCode !== friend.roomCode) {
                     div.querySelector('.friend-code').innerHTML = `<span class="text-red-500 font-bold">Invalid</span> (Tap Reload \u27F3)`;
                     joinBtn.textContent = 'Join';
                     joinBtn.disabled = false;
                     return;
                 }
             }

             showRoom(friend.roomCode);
             joinBtn.textContent = 'Join';
             joinBtn.disabled = false;
        };
        div.appendChild(joinBtn);

        friendsListEl.appendChild(div);
    }
}

document.getElementById('btn-reload-friends').addEventListener('click', async (e) => {
   const icon = e.currentTarget.querySelector('svg');
   if(icon) icon.classList.add('animate-spin');
   
   try {
       friendCache.clear();
       if (currentUserDoc && currentUserDoc.friends) {
           await renderFriends(currentUserDoc.friends);
       }
   } finally {
       setTimeout(() => { if(icon) icon.classList.remove('animate-spin'); }, 500);
   }
});

// ==== UI BUTTONS ====
document.getElementById('btn-start-my-room').addEventListener('click', () => {
   if (currentUserDoc) showRoom(currentUserDoc.roomCode);
});

document.getElementById('btn-copy-invite').addEventListener('click', () => {
   if (currentUserDoc) {
      const url = `${window.location.origin}/?join=${currentUserDoc.roomCode}`;
      navigator.clipboard.writeText(url);
      const btn = document.getElementById('btn-copy-invite');
      btn.textContent = "Copied!"; btn.style.borderColor = "var(--orange)";
      setTimeout(() => { btn.textContent = "Copy Invite Link"; btn.style.borderColor = "white"; }, 2000);
   }
});

inputJoinKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });
btnJoin.addEventListener('click', () => {
  const key = inputJoinKey.value.trim().toUpperCase();
  if(key) showRoom(key);
});


// Format Time helper & Video Link helper
const formatTime = (time) => {
  if (isNaN(time)) return "0:00";
  const m = Math.floor(time / 60); const s = Math.floor(time % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const formatVideoUrl = (url) => {
  let formattedUrl = url.trim();
  
  // Auto-Fix internal Telegram Bot IP to Render Public URL
  if (formattedUrl.startsWith('http://10.') && formattedUrl.includes('/stream/')) {
    try {
       const urlObj = new URL(formattedUrl);
       urlObj.protocol = 'https:';
       urlObj.hostname = 'vaanisethu-bot.onrender.com';
       urlObj.port = ''; // Remove the port
       return urlObj.toString();
    } catch(e) { }
  }

  // Dropbox auto-formatting
  if (formattedUrl.includes('dropbox.com')) {
    try {
       const urlObj = new URL(formattedUrl);
       urlObj.hostname = 'dl.dropboxusercontent.com'; urlObj.searchParams.delete('dl');
       return urlObj.toString();
    } catch(e) { }
  }
  
  return formattedUrl;
};

// Switch Views
window.joinFriendRoom = function(code) { showRoom(code); }

function showRoom(roomId, url = null, file = null) {
  if (!hasValidAccess() && currentGuestAccessRoom !== roomId) return checkAccessAndRoute();

  sessionUserName = currentUser?.displayName || 'Guest';
  currentRoomId = roomId;
  dashView.classList.add('hidden');
  roomView.classList.remove('hidden');
  roomIdDisplay.textContent = roomId;
  if (!_spaHandlingPop) spaPushState('room');
  if(url) handleNewUrl(url, true);
  if(file) { currentVideoFile = file; handleNewUrl(URL.createObjectURL(file), false); }
  initWebSocket();

  // Show emoji tray and WhatsApp share in room header
  const emojiCont = document.getElementById('emoji-tray-container');
  const waBtn     = document.getElementById('btn-whatsapp-share');
  if (emojiCont) emojiCont.style.display = 'flex';
  if (waBtn)     waBtn.style.display = 'flex';

  // \u2B50 Host badge in room name \u2014 only for full premium (weekly/monthly)
  const iAmOwner = currentUserDoc && currentUserDoc.roomCode === roomId;
  if (iAmOwner && isFullPremiumUser()) {
    const nameEl = document.getElementById('room-name-display');
    if (nameEl && !nameEl.querySelector('.host-star-badge')) {
      const badge = document.createElement('span');
      badge.className = 'host-star-badge';
      badge.textContent = '\u2B50 Premium Host';
      nameEl.appendChild(badge);
    }
  }

  if (!iAmOwner) {
    fetchRoomAdContext(roomId);
  } else {
    if (isPremiumUser()) {
      window._roomHostAccessType = 'premium';
      window._currentPlayingFilmAdEnabled = true;
    }
  }
}


// Fetch host's ad context for a room and set global ad flags
async function fetchRoomAdContext(roomCode) {
  try {
    const res = await fetch(`/api/room-ad-context?roomCode=${encodeURIComponent(roomCode)}`);
    const data = await res.json();
    if (data.success) {
      window._roomHostAccessType = data.hostAccessType || 'generic';
      window._currentPlayingFilmAdEnabled = data.filmAdEnabled !== false;
    }
  } catch (e) {
    // On error, default to showing ads (safe fallback)
    window._roomHostAccessType = 'generic';
    window._currentPlayingFilmAdEnabled = true;
  }
}

function leaveRoom() {
  if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
      ws.send(JSON.stringify({ type: "leave", roomId: currentRoomId }));
  }
  currentRoomId = null;
  currentVideoUrl = null;
  currentVideoFile = null;
  mainVideo.src = "";
  if (isYouTubeMode && ytPlayerReady && ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
  playerWrapper.classList.add('hidden');
  sourceUi.classList.remove('hidden');
  if(waitingUi) waitingUi.classList.add('hidden');
  chatMessages.innerHTML = '';
  
  roomView.classList.add('hidden');

  // Hide room-only controls (emoji + WhatsApp) when leaving
  const emojiCont = document.getElementById('emoji-tray-container');
  const waBtn     = document.getElementById('btn-whatsapp-share');
  if (emojiCont) emojiCont.style.display = 'none';
  if (waBtn)     waBtn.style.display = 'none';
  // Also remove host badge from room name
  document.querySelectorAll('.host-star-badge').forEach(b => b.remove());

  
  // Clear guest state when leaving to force re-evaluation of gatekeeper
  currentGuestAccessRoom = null; 
  checkAccessAndRoute(); // This will show Dashboard if valid, or Payment wall if unauthorized
  
  initWebSocket(true); // fall back to presence mode
}

btnLeave.addEventListener('click', leaveRoom);
btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(`${window.location.origin}/?join=${currentRoomId}`);
  btnCopy.textContent = "Copied!"; btnCopy.classList.add('text-orange');
  setTimeout(() => { btnCopy.textContent = "Copy"; btnCopy.classList.remove('text-orange'); }, 2000);
});

btnChatFab.addEventListener('click', () => {
  chatPopup.classList.remove('closed'); unreadCount = 0;
  chatBadge.classList.add('hidden'); chatBadge.textContent = '0';
  chatNotification.classList.remove('show');
});
btnCloseSidebar.addEventListener('click', () => chatPopup.classList.add('closed'));

function handleNewUrl(formattedUrl, broadcast = false) {
  currentVideoUrl = formattedUrl;
  sourceUi.classList.add('hidden');
  if(waitingUi) waitingUi.classList.add('hidden');
  playerWrapper.classList.remove('hidden');
  settingsModal.classList.add('hidden');

  const isYouTube = formattedUrl && (formattedUrl.includes('youtu.be') || formattedUrl.includes('youtube.com'));
  if (isYouTube) {
      isYouTubeMode = true;
      mainVideo.classList.add('hidden');
      mainVideo.pause();
      const ytContainer = document.getElementById('youtube-player-container');
      if (ytContainer) ytContainer.classList.remove('hidden');
      
      const m = formattedUrl.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
      const vidId = m ? m[1] : null;
      if (vidId) {
          if (ytPlayerReady && ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
              ytPlayer.loadVideoById(vidId);
          } else {
              pendingYtVideoId = vidId;
          }
      }
  } else {
      isYouTubeMode = false;
      const ytContainer = document.getElementById('youtube-player-container');
      if (ytContainer) ytContainer.classList.add('hidden');
      if (ytPlayerReady && ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
      mainVideo.classList.remove('hidden');
      mainVideo.src = formattedUrl;
  }

  if (btnChatFab) btnChatFab.style.display = 'flex';
  const fabContainer = document.getElementById('chat-fab-container');
  if (fabContainer) fabContainer.style.display = 'flex';

  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "sync", action: "update-url", videoUrl: formattedUrl, time: 0, timestamp: Date.now() }));
    }
    if (typeof renderRoomSuggestions === 'function') renderRoomSuggestions();
}

// Ensure settings button is hidden for guests (Enforce Host-Only Privileges)
function updateGuestPermissions() {
  const iAmOwner = currentUserDoc && currentUserDoc.roomCode === currentRoomId;
  if (!iAmOwner && btnPlayerSettings) {
      btnPlayerSettings.classList.add('hidden');
  } else if (btnPlayerSettings) {
      btnPlayerSettings.classList.remove('hidden');
  }
  // Chat FAB should always be visible for EVERYONE in the room
  if (btnChatFab) btnChatFab.style.display = 'flex';
  const fabContainer = document.getElementById('chat-fab-container');
  if (fabContainer) fabContainer.style.display = 'flex';
}

// UI Flow for Source Selection
const srcSelectionStep = document.getElementById('source-selection-step');
const srcInputStep = document.getElementById('source-input-step');
const srcStepTitle = document.getElementById('source-step-title');
const tgGuide = document.getElementById('telegram-guide');
const urlGroup = document.getElementById('url-input-group');
const localGroup = document.getElementById('local-input-group');

function openSourceStep(type) {
  if(!srcSelectionStep) return;
  srcSelectionStep.classList.add('hidden');
  srcInputStep.classList.remove('hidden');
  tgGuide.classList.add('hidden');
  urlGroup.classList.add('hidden');
  localGroup.classList.add('hidden');

  if(type === 'dropbox') {
    srcStepTitle.textContent = 'DROPBOX';
    urlGroup.classList.remove('hidden');
    roomUrlInput.placeholder = 'Paste Dropbox Link Here';
    roomUrlInput.focus();
  } else if(type === 'telegram') {
    srcStepTitle.textContent = 'TELEGRAM';
    tgGuide.classList.remove('hidden');
    urlGroup.classList.remove('hidden');
    roomUrlInput.placeholder = 'Paste Stream Link';
    roomUrlInput.focus();

    // Wake up the Render bot since free instances sleep after inactivity
    fetch('https://vaanisethu-bot.onrender.com/', { mode: 'no-cors' }).catch(() => {});
  } else if(type === 'youtube') {
    srcStepTitle.textContent = 'YOUTUBE';
    urlGroup.classList.remove('hidden');
    roomUrlInput.placeholder = 'Paste YouTube Link Here';
    roomUrlInput.focus();
  } else {
    srcStepTitle.textContent = 'LOCAL FILE';
    localGroup.classList.remove('hidden');
  }
}

document.getElementById('btn-src-dropbox')?.addEventListener('click', () => openSourceStep('dropbox'));
document.getElementById('btn-src-telegram')?.addEventListener('click', () => openSourceStep('telegram'));
document.getElementById('btn-src-local')?.addEventListener('click', () => openSourceStep('local'));
document.getElementById('btn-src-youtube')?.addEventListener('click', () => openSourceStep('youtube'));

document.getElementById('btn-back-source')?.addEventListener('click', () => {
  srcSelectionStep.classList.remove('hidden');
  srcInputStep.classList.add('hidden');
  roomUrlInput.value = '';
});

roomUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim() !== '') handleNewUrl(formatVideoUrl(e.target.value), true);
});
document.getElementById('btn-play-url').addEventListener('click', () => {
  const val = roomUrlInput.value.trim();
  if (val) handleNewUrl(formatVideoUrl(val), true);
});
roomFileUpload.addEventListener('change', (e) => {
   if(e.target.files && e.target.files[0]) { currentVideoFile = e.target.files[0]; handleNewUrl(URL.createObjectURL(e.target.files[0]), false); }
});

function appendMessage(msg) {
   const isSelf = msg.senderId === sessionUserId;
   const msgDiv = document.createElement('div');
   msgDiv.className = `msg-bubble ${isSelf ? 'msg-self' : 'msg-other'}`;
   
   const nameSpan = document.createElement('span');
   nameSpan.className = 'msg-name'; nameSpan.textContent = msg.senderName;

   const textSpan = document.createElement('div');
   textSpan.className = 'msg-text'; textSpan.textContent = msg.text;

   msgDiv.appendChild(nameSpan); msgDiv.appendChild(textSpan);
   chatMessages.appendChild(msgDiv); chatMessages.scrollTop = chatMessages.scrollHeight;

   if (!isSelf && chatPopup.classList.contains('closed')) {
     unreadCount++; chatBadge.textContent = unreadCount > 99 ? '99+' : unreadCount; chatBadge.classList.remove('hidden');
     notifName.textContent = msg.senderName + ':'; notifText.textContent = msg.text; chatNotification.classList.add('show');
     if (notifTimeout) clearTimeout(notifTimeout);
     notifTimeout = setTimeout(() => chatNotification.classList.remove('show'), 3000);
   }
}

function appendSystemMessage(text) {
   const msgDiv = document.createElement('div'); msgDiv.className = 'msg-system';
   msgDiv.textContent = text; chatMessages.appendChild(msgDiv);
   chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if(!text || !ws) return;
  ws.send(JSON.stringify({ type: "chat", text: text, userName: sessionUserName }));
  chatInput.value = '';
});

const sendVideoState = (action) => {
  if (isUpdating || !ws || ws.readyState !== WebSocket.OPEN) return;
  const time = isYouTubeMode && ytPlayerReady && ytPlayer && typeof ytPlayer.getCurrentTime === 'function' ? ytPlayer.getCurrentTime() : mainVideo.currentTime;
  ws.send(JSON.stringify({ type: "sync", action, time, timestamp: Date.now() }));
};

async function updateGuestWaitingUI() {
    if (!waitingUi || waitingUi.classList.contains('hidden')) return;
    
    if (!currentRoomOwnerUid) {
        try {
           const _gw = await fetch('/api/room-owner?roomCode=' + currentRoomId).then(r=>r.json()).catch(()=>({}));
           if (_gw.uid) currentRoomOwnerUid = _gw.uid;
        } catch(e) { console.error(e); }
    }

    const isOwnerPresent = currentRoomOwnerUid && currentRoomUsers.has(currentRoomOwnerUid);
    const isOwnerOnline = currentRoomOwnerUid && onlinePresence.has(currentRoomOwnerUid);
    
    const h3 = waitingUi.querySelector('h3');
    const p = waitingUi.querySelector('p');
    const iconBox = waitingUi.querySelector('.icon-box');

    if (isOwnerPresent || isOwnerOnline) {
        h3.textContent = "Waiting for Host";
        p.textContent = "The room owner is currently selecting a movie. Please wait.";
        iconBox.style.background = "rgba(255,255,255,0.05)";
        iconBox.classList.remove('text-red-500');
        iconBox.classList.add('text-zinc-500');
        iconBox.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    } else {
        h3.textContent = "Host Offline";
        p.textContent = "The owner of this room is currently not here. They need to join to start the movie.";
        iconBox.style.background = "rgba(239,68,68,0.1)";
        iconBox.classList.remove('text-zinc-500');
        iconBox.classList.add('text-red-500');
        iconBox.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    }
}

mainVideo.addEventListener('play', () => sendVideoState('play'));
mainVideo.addEventListener('pause', () => sendVideoState('pause'));
mainVideo.addEventListener('seeked', () => sendVideoState('seek'));

btnPlayerSettings.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});
btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

document.getElementById('btn-force-sync').addEventListener('click', () => {
    btnSyncPlayback.click();
    settingsModal.classList.add('hidden');
});

document.getElementById('btn-remove-video').addEventListener('click', () => {
    currentVideoUrl = null;
    currentVideoFile = null;
    mainVideo.src = "";
    playerWrapper.classList.add('hidden');
    sourceUi.classList.remove('hidden');
    document.getElementById('room-suggestions-container')?.classList.add('hidden');
    settingsModal.classList.add('hidden');
    
    // Clear chats
    chatMessages.innerHTML = '';
    
    if (isYouTubeMode && ytPlayerReady && ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
    if (ws && ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify({ type: "sync", action: "remove-video", time: 0, timestamp: Date.now() }));
    }
});

btnSyncPlayback.addEventListener('click', () => {
   isUpdating = true; 
   if (isYouTubeMode && ytPlayerReady && ytPlayer && typeof ytPlayer.playVideo === 'function') ytPlayer.playVideo();
   else mainVideo.play().catch(console.error);
   if(ws) ws.send(JSON.stringify({ type: "request-sync" }));
   syncOverlay.classList.add('hidden');
   setTimeout(() => isUpdating = false, 500);
});

const btnClearChatGlobal = document.getElementById('btn-clear-chat-global');
if(btnClearChatGlobal) {
  btnClearChatGlobal.addEventListener('click', () => {
      chatMessages.innerHTML = '';
      settingsModal.classList.add('hidden');
      if (ws && ws.readyState === WebSocket.OPEN) {
         ws.send(JSON.stringify({ type: "sync", action: "clear-chat", timestamp: Date.now() }));
      }
  });
}

// ==== WEBSOCKETS (ROOMS & PRESENCE) ====
let reconnectTimeout = null;

function initWebSocket(isPresenceOnly = false) {
  if (ws) {
     if(ws.readyState === WebSocket.OPEN && isPresenceOnly && currentUser) {
         ws.send(JSON.stringify({ type:"auth", userId: sessionUserId }));
         if(currentUserDoc && currentUserDoc.friends) {
             ws.send(JSON.stringify({ type: "subscribe-presence", friendIds: currentUserDoc.friends }));
         }
         return;
     }
     ws.close(); ws = null;
  }
  
  if(!currentUser) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    
    if (isPresenceOnly || !currentRoomId) {
        ws.send(JSON.stringify({ type: "auth", userId: sessionUserId }));
        if (currentUserDoc && currentUserDoc.friends?.length > 0) {
            ws.send(JSON.stringify({ type: "subscribe-presence", friendIds: currentUserDoc.friends }));
        }
    } else {
        ws.send(JSON.stringify({
          type: "join", roomId: currentRoomId,
          userId: sessionUserId, userName: sessionUserName,
          roomName: (currentUserDoc && currentUserDoc.roomName) || sessionUserName || 'My Room',
          videoUrl: currentVideoFile ? null : currentVideoUrl
        }));
    }
  };
  
  ws.onclose = () => {
    if (currentRoomId || isPresenceOnly) {
       reconnectTimeout = setTimeout(() => initWebSocket(isPresenceOnly), 3000);
    }
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "presence-update") {
        if (data.isOnline) onlinePresence.add(data.userId);
        else onlinePresence.delete(data.userId);
        
        const dot = document.getElementById(`status-${data.userId}`);
        if(dot) dot.className = `friend-status ${data.isOnline ? 'status-online' : 'status-offline'}`;
        updateGuestWaitingUI();
    }

    if (data.type === "room-state") {
       currentRoomUsers = new Set(Object.keys(data.room.users));
       
       roomNameDisplay.textContent = data.room.name;
       if (data.room.messages) data.room.messages.forEach(appendMessage);

       updateGuestPermissions(); // Apply guest restrictions on UI
       const iAmOwner = currentUserDoc && currentUserDoc.roomCode === currentRoomId;

       if (data.room.videoState.videoUrl && !currentVideoFile) {
           handleNewUrl(data.room.videoState.videoUrl, false);
           // Guest: re-fetch host's ad context when new video arrives
           const iAmOwner = currentUserDoc && currentUserDoc.roomCode === currentRoomId;
           if (!iAmOwner && currentRoomId) fetchRoomAdContext(currentRoomId);
           // Video chal raha hai \u2014 chat FAB sabko dikhao
           if (btnChatFab) btnChatFab.style.display = 'flex';
           const fabContainer = document.getElementById('chat-fab-container');
           if (fabContainer) fabContainer.style.display = 'flex';
       } else if (!data.room.videoState.videoUrl) {
           currentVideoUrl = null;
           currentVideoFile = null;
           mainVideo.src = "";
           playerWrapper.classList.add('hidden');
           
           if(iAmOwner) {
               sourceUi.classList.remove('hidden');
               if(waitingUi) waitingUi.classList.add('hidden');
               // Host ko chat dikho
               if (btnChatFab) btnChatFab.style.display = 'flex';
               const fabContainer = document.getElementById('chat-fab-container');
               if (fabContainer) fabContainer.style.display = 'flex';
           } else {
               sourceUi.classList.add('hidden');
               if(waitingUi) {
                  waitingUi.classList.remove('hidden');
                  updateGuestWaitingUI();
               }
               // Guest ko chat hide karo jab video na ho
               if (btnChatFab) btnChatFab.style.display = 'none';
               const fabContainer = document.getElementById('chat-fab-container');
               if (fabContainer) fabContainer.style.display = 'none';
           }
       }
       mainVideo.currentTime = data.room.videoState.currentTime;
       if(data.room.videoState.isPlaying) mainVideo.play().catch(() => syncOverlay.classList.remove('hidden'));
    }

    if (data.type === "chat") appendMessage(data.message);
    if (data.type === "user-joined") {
       currentRoomUsers.add(data.userId);
       updateGuestWaitingUI();
       appendSystemMessage(`${data.userName} joined the room`);
    }

    if (data.type === "user-left") {
       currentRoomUsers.delete(data.userId);
       updateGuestWaitingUI();
       appendSystemMessage(`${data.userName || 'A user'} left the room`);
    }

    if (data.type === "room-updated") roomNameDisplay.textContent = data.name;

    // \u2500\u2500 Emoji Reaction received \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (data.type === "reaction") {
      spawnFloatingEmoji(data.emoji, data.userName);
    }

    if (data.type === "sync") {
       if (data.action === "clear-chat") {
           chatMessages.innerHTML = '';
           return;
       }

       if (data.action === "remove-video") {
           currentVideoUrl = null;
           currentVideoFile = null;
           mainVideo.src = "";
           mainVideo.pause();
           if (isYouTubeMode && ytPlayerReady && ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
           playerWrapper.classList.add('hidden');
           document.getElementById('room-suggestions-container')?.classList.add('hidden');
           
           // Clear chats on sync sync
           chatMessages.innerHTML = '';
           
           const iAmOwner = currentUserDoc && currentUserDoc.roomCode === currentRoomId;
           if(iAmOwner) {
               sourceUi.classList.remove('hidden');
               if(waitingUi) waitingUi.classList.add('hidden');
               // Host always sees chat
               if (btnChatFab) btnChatFab.style.display = 'flex';
               const fabContainer = document.getElementById('chat-fab-container');
               if (fabContainer) fabContainer.style.display = 'flex';
           } else {
               sourceUi.classList.add('hidden');
               if(waitingUi) {
                   waitingUi.classList.remove('hidden');
                   updateGuestWaitingUI();
               }
               // Guest has no chat when there is no video
               if (btnChatFab) btnChatFab.style.display = 'none';
               const fabContainer = document.getElementById('chat-fab-container');
               if (fabContainer) fabContainer.style.display = 'none';
           }
           return;
       }

       if (data.videoUrl && data.videoUrl !== currentVideoUrl && !currentVideoFile) handleNewUrl(data.videoUrl, false);

       isUpdating = true;
       const latency = data.timestamp ? Math.max(0, Math.min((Date.now() - data.timestamp) / 1000, 2)) : 0;
       const targetTime = data.time + (data.action === "play" ? latency : 0);

       if (data.action === "play") {
           if (isYouTubeMode && ytPlayerReady && ytPlayer) {
               if (ytPlayer.getPlayerState && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) ytPlayer.playVideo();
           } else if (mainVideo.paused) {
               mainVideo.play().catch(() => { syncOverlay.classList.remove('hidden'); mainVideo.pause(); isUpdating = false; });
           }
       } else if (data.action === "pause") {
           if (isYouTubeMode && ytPlayerReady && ytPlayer) {
               if (typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo();
           } else if (!mainVideo.paused) {
               mainVideo.pause();
           }
       }

       if (isYouTubeMode && ytPlayerReady && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
           if (Math.abs(ytPlayer.getCurrentTime() - targetTime) > 0.5) ytPlayer.seekTo(targetTime, true);
       } else {
           if (Math.abs(mainVideo.currentTime - targetTime) > 0.5) mainVideo.currentTime = targetTime;
       }
       setTimeout(() => { isUpdating = false; }, 500);
    }
  };
}

setInterval(() => { fetch('/ping').catch(() => {}); }, 2 * 60 * 1000);

// ================================================================
// ==== FILM STORE \u2014 SHARED STATE ====
// ================================================================
let filmStoreData = [];

// ================================================================
// ==== FILM STORE \u2014 UTILITY FUNCTIONS ====
// ================================================================

// Compress image to max 600px wide, JPEG quality 0.75 \u2192 returns base64
function compressImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const maxSize = 600;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatTimeRemaining(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h remaining`;
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m remaining`;
}

// ================================================================
// ==== FILM STORE \u2014 USER MODAL ====
// ================================================================

window.switchFilmTab = function(tab) {
  const panels = { browse: 'film-tab-browse', rentals: 'film-tab-rentals', history: 'film-tab-history' };
  const btns   = { browse: 'tab-btn-browse', rentals: 'tab-btn-rentals', history: 'tab-btn-history' };
  Object.keys(panels).forEach(t => {
    const el = document.getElementById(panels[t]); if (el) el.classList.toggle('hidden', t !== tab);
    const b  = document.getElementById(btns[t]);   if (b)  b.classList.toggle('active', t === tab);
  });
  if (tab === 'browse')  loadFilmStore();
  else if (tab === 'rentals') loadMyRentals();
  else if (tab === 'history') loadWatchHistory();
};

function openFilmStoreModal() {
  const modal = document.getElementById('film-store-modal');
  modal.style.display = 'block';
  spaPushState('film-modal'); // Back button will close modal, not leave SPA
  switchFilmTab('browse');
}

document.getElementById('btn-close-film-store')?.addEventListener('click', () => {
  document.getElementById('film-store-modal').style.display = 'none';
});

document.getElementById('btn-src-rented')?.addEventListener('click', openFilmStoreModal);

async function loadFilmStore() {
  const grid = document.getElementById('films-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="text-zinc-500 text-center py-12 col-span-full"><p>Loading films...</p></div>';
  try {
    const [res, adUnlocks] = await Promise.all([fetch('/api/films'), fetchMyAdUnlocks()]);
    window._adUnlocks = adUnlocks;

    const data = await res.json();
    if (!data.success || !data.films || data.films.length === 0) {
      grid.innerHTML = '<div class="text-zinc-500 text-center py-12 col-span-full"><p class="font-bold">No films available yet.</p><p class="text-sm mt-1">Check back soon!</p></div>';
      return;
    }
    filmStoreData = data.films;
    window._allFilms = data.films;
    grid.innerHTML = '';

    // \u2500\u2500 PREMIUM PAGE: show ALL films in ONE section, rent-only \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (window._IS_PREMIUM_PAGE) {
      const sec = document.createElement('div');
      sec.className = 'film-section';
      sec.innerHTML = `
        <div class="film-section-header">
          <span class="film-section-icon">\u{1F3AC}</span>
          <div>
            <div class="film-section-title">Rent a Film</div>
            <div class="film-section-sub">Premium members enjoy 100% ad-free viewing \u2014 rent any film below</div>
          </div>
        </div>
        <div class="film-section-grid" id="premium-all-films-grid"></div>
      `;
      grid.appendChild(sec);
      const premGrid = sec.querySelector('#premium-all-films-grid');
      data.films.forEach(film => premGrid.appendChild(buildFilmCard(film)));
      return;
    }

    // \u2500\u2500 NORMAL PAGE: split into Free-with-Ads + Premium sections \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const adFilms      = data.films.filter(f => f.adUnlockEnabled !== false);
    const premiumFilms = data.films.filter(f => f.adUnlockEnabled === false);

    // ---- Section 1: Free with Ads ----
    if (adFilms.length > 0) {
      const sec1 = document.createElement('div');
      sec1.className = 'film-section';
      sec1.innerHTML = `
        <div class="film-section-header">
          <span class="film-section-icon">\u{1F4FA}</span>
          <div>
            <div class="film-section-title">Free with Ads</div>
            <div class="film-section-sub">Watch 1 ad for 1hr free access \u2014 or rent for full access</div>
          </div>
        </div>
        <div class="film-section-grid" id="ad-films-grid"></div>
      `;
      grid.appendChild(sec1);
      const adGrid = sec1.querySelector('#ad-films-grid');
      adFilms.forEach(film => adGrid.appendChild(buildFilmCard(film)));
    }

    // ---- Section 2: Premium Films ----
    if (premiumFilms.length > 0) {
      const sec2 = document.createElement('div');
      sec2.className = 'film-section';
      sec2.innerHTML = `
        <div class="film-section-header">
          <span class="film-section-icon">\u{1F3AC}</span>
          <div>
            <div class="film-section-title">Premium Films</div>
            <div class="film-section-sub">Exclusive titles \u2014 rent with payment, no ads ever</div>
          </div>
        </div>
        <div class="film-section-grid" id="premium-films-grid"></div>
      `;
      grid.appendChild(sec2);
      const premGrid = sec2.querySelector('#premium-films-grid');
      premiumFilms.forEach(film => premGrid.appendChild(buildFilmCard(film)));
    }

  } catch (e) {
    grid.innerHTML = `<div class="text-red-400 text-center py-12 col-span-full">Error loading films: ${e.message}</div>`;
  }
}

function buildFilmCard(film) {
  const card = document.createElement('div');
  card.className = 'film-card';

  const adUnlock      = window._adUnlocks && window._adUnlocks.get(film.filmId);
  const isAdUnlocked  = adUnlock && adUnlock.isActive;
  const adUnlockEnabled = film.adUnlockEnabled !== false;
  const premium       = isPremiumUser();
  const fullPremium   = isFullPremiumUser();
  const isAdminUser   = currentUser && currentUser.email === 'anubhabmohapatra.01@gmail.com';

  // \u2500\u2500 Early Access logic \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const earlyUntil = film.earlyAccessUntil || 0;
  const isEarlyAccess = earlyUntil > Date.now(); // still in early access window
  const isLockedByEarlyAccess = isEarlyAccess && !fullPremium && !isAdminUser;

  // \u2500\u2500 Free Rental eligibility \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const plan = currentUserDoc?.activeSubscription || '';
  const hasFreeRental = isAdminUser ||
    (plan === 'weekly' && currentUserDoc?.subscriptionExpiry > Date.now()) ||
    (plan === 'monthly' && currentUserDoc?.subscriptionExpiry > Date.now());

  // \u2500\u2500 Trailer link helper \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const trailerLink = film.trailerLink || '';
  const isYouTube = trailerLink && (trailerLink.includes('youtu.be') || trailerLink.includes('youtube.com'));
  // Convert YouTube URL to embed URL
  function ytEmbedUrl(url) {
    const m = url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
    return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&mute=1&loop=1&playlist=${m[1]}&controls=0&rel=0&modestbranding=1` : null;
  }
  const trailerEmbed = isYouTube ? ytEmbedUrl(trailerLink) : (trailerLink ? trailerLink : null);

  card.innerHTML = `
    <div class="film-card-poster" style="position:relative;">
      ${film.thumbnailBase64
        ? `<img src="${film.thumbnailBase64}" alt="${film.title}" style="width:100%;height:100%;object-fit:cover;">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#52525b;font-size:2rem;">\u{1F3AC}</div>`}
      ${isAdUnlocked ? '<div class="film-ad-unlock-badge">AD UNLOCKED</div>' : ''}
      ${!adUnlockEnabled ? '<div class="film-premium-badge">PREMIUM</div>' : ''}
      ${isEarlyAccess && (fullPremium || isAdminUser) ? '<div class="film-early-badge">\u2B50 EARLY ACCESS</div>' : ''}
      ${isLockedByEarlyAccess ? `<div class="film-early-lock-overlay"><div class="film-early-lock-inner"><span style="font-size:1.6rem;">\u{1F512}</span><span style="font-size:0.72rem;font-weight:700;color:#e4e4e7;margin-top:0.25rem;">Early Access</span><span style="font-size:0.6rem;color:#a1a1aa;text-align:center;">Available ${new Date(earlyUntil).toLocaleDateString()}</span></div></div>` : ''}
      ${trailerEmbed ? `<div class="film-trailer-overlay" data-trailer="${trailerEmbed}" data-is-yt="${isYouTube}">
        ${isYouTube
          ? `<iframe class="film-trailer-frame" src="" data-src="${trailerEmbed}" allow="autoplay" frameborder="0" allowfullscreen style="width:100%;height:100%;position:absolute;inset:0;display:none;"></iframe>`
          : `<video class="film-trailer-video" muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;" src="${trailerEmbed}"></video>`
        }
        <div class="film-trailer-play-hint">\u25B6 Trailer</div>
      </div>` : ''}
    </div>
    <div class="film-card-body">
      <h3 class="film-card-title">${film.title}</h3>

      <div class="film-card-meta">
        <span class="film-card-price">\u20B9${film.price}</span>
        <span class="film-card-days">${film.rentalDays} day${film.rentalDays > 1 ? 's' : ''}</span>
      </div>

      ${isLockedByEarlyAccess
        ? `<!-- Locked \u2014 early access not yet available for this tier -->
           <button class="btn film-rent-btn" disabled style="opacity:0.45;cursor:not-allowed;">
             \u{1F512} Available ${new Date(earlyUntil).toLocaleDateString()}
           </button>`
        : hasFreeRental
          ? `<!-- Free rental button for weekly/monthly/admin -->
             <button class="btn film-free-rental-btn" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}"
               style="background:linear-gradient(135deg,#16a34a,#22c55e);color:white;border:none;margin-bottom:0.35rem;font-size:0.78rem;">
               \u{1F193} ${isAdminUser ? 'Free (Admin)' : '1 Free/Week'}
             </button>
             <button class="btn film-rent-btn btn-outline-sm" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}" data-price="${film.price}" data-days="${film.rentalDays}">
               Rent ${film.rentalDays}d \u2014 \u20B9${film.price}
             </button>`
          : isAdUnlocked
            ? `<!-- Already unlocked via ad -->
               <div class="film-ad-unlocked-timer" style="margin-bottom:0.4rem;font-size:0.68rem;color:#c084fc;font-weight:600;display:flex;align-items:center;gap:0.3rem;">
                 <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                 ${formatTimeRemaining(adUnlock.expiresAt)}
               </div>
               <button class="btn film-play-btn" data-link="${adUnlock.telegramLink || ''}" style="background:linear-gradient(135deg,#6d28d9,#a855f7);border:none;margin-bottom:0.3rem;">\u25B6 Watch Now (Ad Unlocked)</button>
               <button class="btn film-rent-btn btn-outline-sm" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}" data-price="${film.price}" data-days="${film.rentalDays}">
                 Rent ${film.rentalDays}d \u2014 \u20B9${film.price}
               </button>`
            : adUnlockEnabled && !premium
              ? `<!-- Ad film: show both Watch Ad (primary) + Rent (secondary) -->
                 <button class="film-ad-btn film-ad-btn-primary" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}">
                   \u{1F4FA} Watch Ad \u2014 Free 1hr
                 </button>
                 <button class="btn film-rent-btn btn-outline-sm" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}" data-price="${film.price}" data-days="${film.rentalDays}">
                   Rent ${film.rentalDays}d \u2014 \u20B9${film.price}
                 </button>`
              : `<!-- Premium film OR premium user: only rent -->
                 <button class="btn film-rent-btn" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}" data-price="${film.price}" data-days="${film.rentalDays}">
                   Rent ${film.rentalDays}d \u2014 \u20B9${film.price}
                 </button>`
      }
    </div>
  `;

  // Event listeners
  card.querySelectorAll('.film-rent-btn').forEach(btn => {
    if (btn.disabled) return; // skip locked buttons
    btn.addEventListener('click', () => initiateFilmRental(film.filmId, film.title, film.price, film.rentalDays));
  });

  const adPlayBtn = card.querySelector('.film-play-btn');
  if (adPlayBtn) {
    adPlayBtn.addEventListener('click', () => {
      window._currentPlayingFilmAdEnabled = film.adUnlockEnabled !== false;
      window._roomHostAccessType = 'ad-unlock';
      window.logWatchHistory?.(film.filmId, film.title, film.thumbnailBase64 || '');
      playRentedFilm(adPlayBtn.dataset.link, film.title, 'ad-unlock');
    });
  }

  const adUnlockBtn = card.querySelector('.film-ad-btn-primary');
  if (adUnlockBtn) {
    adUnlockBtn.addEventListener('click', () => startFilmAdUnlock(film.filmId, film.title, adUnlockBtn));
  }

  // \u2500\u2500 Free Rental button \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const freeRentalBtn = card.querySelector('.film-free-rental-btn');
  if (freeRentalBtn) {
    freeRentalBtn.addEventListener('click', async () => {
      if (!currentUser) return;
      const origText = freeRentalBtn.textContent;
      freeRentalBtn.textContent = 'Loading...';
      freeRentalBtn.disabled = true;
      try {
        const res = await fetch('/api/use-free-rental', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), filmId: film.filmId })
        });
        const data = await res.json();
        if (data.success) {
          window.logWatchHistory?.(film.filmId, film.title, film.thumbnailBase64 || '');
          playRentedFilm(data.telegramLink, film.title, 'free-rental');
        } else {
          showCustomAlert('Free Rental', data.error || 'Could not use free rental.');
          freeRentalBtn.textContent = origText;
          freeRentalBtn.disabled = false;
        }
      } catch(e) {
        showCustomAlert('Error', 'Network error. Try again.');
        freeRentalBtn.textContent = origText;
        freeRentalBtn.disabled = false;
      }
    });
  }

  // \u2500\u2500 Trailer preview hover \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const trailerOverlay = card.querySelector('.film-trailer-overlay');
  const posterEl = card.querySelector('.film-card-poster');
  if (trailerOverlay && posterEl) {
    const isYT = trailerOverlay.dataset.isYt === 'true';
    let hoverTimer = null;

    const showTrailer = () => {
      if (isYT) {
        const iframe = trailerOverlay.querySelector('.film-trailer-frame');
        if (iframe && !iframe.src) iframe.src = iframe.dataset.src; // lazy load
        if (iframe) iframe.style.display = 'block';
      } else {
        const vid = trailerOverlay.querySelector('.film-trailer-video');
        if (vid) { vid.style.display = 'block'; vid.play().catch(() => {}); }
      }
      trailerOverlay.querySelector('.film-trailer-play-hint').style.opacity = '0';
    };
    const hideTrailer = () => {
      clearTimeout(hoverTimer);
      if (isYT) {
        const iframe = trailerOverlay.querySelector('.film-trailer-frame');
        if (iframe) iframe.style.display = 'none';
      } else {
        const vid = trailerOverlay.querySelector('.film-trailer-video');
        if (vid) { vid.pause(); vid.style.display = 'none'; }
      }
      trailerOverlay.querySelector('.film-trailer-play-hint').style.opacity = '1';
    };

    // Desktop: hover
    posterEl.addEventListener('mouseenter', () => { hoverTimer = setTimeout(showTrailer, 600); });
    posterEl.addEventListener('mouseleave', hideTrailer);
    // Mobile: tap play hint
    trailerOverlay.querySelector('.film-trailer-play-hint').addEventListener('click', (e) => {
      e.stopPropagation();
      showTrailer();
    });
  }

  // \u2500\u2500 Star Rating Bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (window.buildStarBar) {
    const cardBody = card.querySelector('.film-card-body');
    if (cardBody) cardBody.appendChild(window.buildStarBar(film.filmId, film.title, film.avgRating, film.ratingCount));
  }

  return card;
}


async function initiateFilmRental(filmId, filmTitle, price, rentalDays) {
  if (!currentUser) { showCustomAlert('Login Required', 'Please login to rent films.'); return; }
  try {
    const res = await fetch('/api/rent-film', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), filmId })
    });
    const order = await res.json();
    if (!order || !order.id) throw new Error(order.error || 'Failed to create order');

    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: 'INR',
      name: 'Vaanisetu Film Store',
      description: `Rent: ${filmTitle} (${rentalDays} days)`,
      order_id: order.id,
      handler: async function(response) {
        const verifyRes = await fetch('/api/verify-rental', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            userId: (currentUserDoc?.uid || currentUser?.uid),
            filmId
          })
        });
        const vData = await verifyRes.json();
        if (vData.success) {
          showCustomAlert('\u{1F3AC} Rental Activated!', `"${filmTitle}" is now available for ${rentalDays} days. Go to My Rentals to watch!`);
          switchFilmTab('rentals');
        } else {
          showCustomAlert('Error', 'Payment verification failed. Contact support.');
        }
      },
      prefill: { email: currentUser.email },
      theme: { color: '#a855f7' }
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  } catch (e) {
    showCustomAlert('Error', e.message);
  }
}

async function loadMyRentals() {
  const grid = document.getElementById('rentals-grid');
  if (!grid || !currentUser) return;
  grid.innerHTML = '<div class="text-zinc-500 text-center py-12 col-span-full"><p>Loading your rentals...</p></div>';
  try {
    // Fetch paid rentals + ad unlocks in parallel
    const [res, adUnlocks] = await Promise.all([
      fetch(`/api/my-rentals?userId=${currentUser.uid}`),
      fetchMyAdUnlocks()
    ]);
    window._adUnlocks = adUnlocks;
    const data = await res.json();

    const hasPaidRentals = data.success && data.rentals && data.rentals.length > 0;
    const activeAdUnlocks = [...adUnlocks.values()].filter(u => u.isActive);
    const expiredAdUnlocks = [...adUnlocks.values()].filter(u => !u.isActive);

    if (!hasPaidRentals && adUnlocks.size === 0) {
      grid.innerHTML = '<div class="text-zinc-500 text-center py-12 col-span-full"><svg class="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg><p class="font-bold">No rentals yet.</p><p class="text-sm mt-1">Browse films and rent one, or watch an ad for free access!</p></div>';
      return;
    }

    grid.innerHTML = '';

    // --- Ad-unlocked films (active) ---
    if (activeAdUnlocks.length > 0) {
      const header = document.createElement('div');
      header.className = 'col-span-full';
      header.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;margin-top:0.5rem;">
        <span style="background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);color:#c084fc;font-size:0.65rem;font-weight:900;padding:0.2rem 0.5rem;border-radius:0.35rem;letter-spacing:0.06em;">AD UNLOCKED</span>
        <span style="font-size:0.75rem;color:#71717a;">Free access \u2014 watch before time runs out!</span>
      </div>`;
      grid.appendChild(header);
      activeAdUnlocks.forEach(u => grid.appendChild(buildAdUnlockCard(u, false)));
    }

    // --- Paid rentals ---
    if (hasPaidRentals) {
      if (activeAdUnlocks.length > 0) {
        const div = document.createElement('div');
        div.className = 'col-span-full';
        div.innerHTML = `<div style="border-top:1px solid #27272a;margin:0.75rem 0;"></div>
          <div style="font-size:0.7rem;color:#52525b;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.75rem;">Paid Rentals</div>`;
        grid.appendChild(div);
      }
      data.rentals.forEach(rental => grid.appendChild(buildRentalCard(rental)));
    }

    // --- Expired ad unlocks ---
    if (expiredAdUnlocks.length > 0) {
      const expHeader = document.createElement('div');
      expHeader.className = 'col-span-full';
      expHeader.innerHTML = `<div style="border-top:1px solid #27272a;margin:0.75rem 0;"></div>
        <div style="font-size:0.7rem;color:#52525b;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.75rem;">Expired Ad Unlocks</div>`;
      grid.appendChild(expHeader);
      expiredAdUnlocks.forEach(u => grid.appendChild(buildAdUnlockCard(u, true)));
    }

  } catch (e) {
    grid.innerHTML = `<div class="text-red-400 text-center py-12 col-span-full">Error loading rentals: ${e.message}</div>`;
  }
}

function buildAdUnlockCard(unlock, expired) {
  const card = document.createElement('div');
  card.className = 'film-card' + (expired ? ' film-card-expired' : '');
  const timeLeft = expired ? 'Expired' : formatTimeRemaining(unlock.expiresAt);
  card.innerHTML = `
    <div class="film-card-poster">
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#52525b;font-size:2rem;">\u{1F3AC}</div>
      <div class="film-ad-unlock-badge" style="${expired ? 'background:#3f3f46;border-color:#52525b;color:#71717a;' : ''}">AD${expired ? ' EXPIRED' : ' UNLOCKED'}</div>
    </div>
    <div class="film-card-body">
      <h3 class="film-card-title">${unlock.filmTitle}</h3>
      <div class="film-rental-timer ${expired ? 'expired' : ''}" style="color:${expired ? '#71717a' : '#c084fc'};">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${timeLeft}
      </div>
      ${!expired
        ? `<button class="btn film-play-btn" style="background:linear-gradient(135deg,#6d28d9,#a855f7);border:none;">\u25B6 Watch Now</button>`
        : `<button class="btn film-play-btn disabled" disabled style="opacity:0.4;">Access Expired</button>`
      }
    </div>
  `;
  if (!expired && unlock.telegramLink) {
    card.querySelector('.film-play-btn').addEventListener('click', () => {
      window._currentPlayingFilmAdEnabled = true;
      window._roomHostAccessType = 'ad-unlock';
      window.logWatchHistory?.(unlock.filmId, unlock.filmTitle, '');
      playRentedFilm(unlock.telegramLink, unlock.filmTitle, 'ad-unlock');
    });
  }
  return card;
}

function buildRentalCard(rental) {
  const card = document.createElement('div');
  card.className = 'film-card' + (rental.isExpired ? ' film-card-expired' : '');
  const timeLeft = rental.isExpired ? 'Expired' : formatTimeRemaining(rental.expiresAt);
  card.innerHTML = `
    <div class="film-card-poster">
      ${rental.thumbnailBase64
        ? `<img src="${rental.thumbnailBase64}" alt="${rental.filmTitle}" style="width:100%;height:100%;object-fit:cover;">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#52525b;font-size:2rem;">\u{1F3AC}</div>`}
      ${rental.isExpired ? '<div class="film-expired-badge">EXPIRED</div>' : ''}
    </div>
    <div class="film-card-body">
      <h3 class="film-card-title">${rental.filmTitle}</h3>
      <div class="film-rental-timer ${rental.isExpired ? 'expired' : ''}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${timeLeft}
      </div>
      ${!rental.isExpired
        ? `<button class="btn film-play-btn" data-link="${rental.telegramLink || ''}" data-title="${rental.filmTitle.replace(/"/g, '&quot;')}">\u25B6 Play Now</button>`
        : `<button class="btn film-play-btn disabled" disabled>Access Expired</button>`}
    </div>
  `;
  if (!rental.isExpired) {
    card.querySelector('.film-play-btn').addEventListener('click', () => {
      window._currentPlayingFilmAdEnabled = false;
      window._roomHostAccessType = 'rental';
      window.logWatchHistory?.(rental.filmId, rental.filmTitle, rental.thumbnailBase64 || '');
      playRentedFilm(rental.telegramLink, rental.filmTitle, 'rental');
    });
  }
  return card;
}

// accessType: 'rental' | 'ad-unlock' | 'generic' \u2014 broadcast to Firestore room doc for guests
function playRentedFilm(link, title, accessType = 'generic') {
  if (!link) { showCustomAlert('Error', 'Stream link not available.'); return; }
  // Close the store modal
  document.getElementById('film-store-modal').style.display = 'none';

  // Broadcast host access type to room doc so guests can read it
  if (currentUser) {
    // Write to Firestore host's user doc \u2014 guests who snapshot this will update their _roomHostAccessType
    fetch('/api/patch-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: currentUser.uid, roomHostAccessType: accessType, roomFilmAdEnabled: window._currentPlayingFilmAdEnabled })
    }).catch(() => {});
  }

  // Play the film using existing room infrastructure
  const formatted = formatVideoUrl(link);
  handleNewUrl(formatted, true);

  // Auto-navigate to the room view
  if (currentUserDoc && currentUserDoc.roomCode) {
    spaPushState('room');
    showRoom(currentUserDoc.roomCode);
  }
}

// ================================================================
// ==== FILM STORE \u2014 ADMIN FUNCTIONS ====
// ================================================================

let adminFilmThumbBase64 = '';

// Thumbnail file picker with compression
document.getElementById('film-form-thumb')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const labelText = document.getElementById('film-thumb-label-text');
  const preview = document.getElementById('film-thumb-preview');
  try {
    labelText.textContent = 'Compressing...';
    adminFilmThumbBase64 = await compressImageToBase64(file);
    preview.src = adminFilmThumbBase64;
    preview.style.display = 'block';
    labelText.textContent = '\u2713 Poster ready \u2014 click to change';
  } catch (err) {
    labelText.textContent = 'Error reading image. Try again.';
    adminFilmThumbBase64 = '';
  }
});

document.getElementById('btn-admin-add-film')?.addEventListener('click', async () => {
  const editId = document.getElementById('film-edit-id').value;
  if (editId) { await saveEditFilm(editId); return; }
  await addFilmToStore();
});

document.getElementById('btn-admin-cancel-edit')?.addEventListener('click', resetFilmForm);

async function addFilmToStore() {
  const title   = document.getElementById('film-form-title').value.trim();
  const link    = document.getElementById('film-form-link').value.trim();
  const price   = document.getElementById('film-form-price').value;
  const days    = document.getElementById('film-form-days').value;
  const trailer = document.getElementById('film-form-trailer')?.value.trim() || '';
  const earlyEl = document.getElementById('film-form-early-access');
  const earlyUntil = earlyEl?.value ? new Date(earlyEl.value).getTime() : null;
  const msgEl   = document.getElementById('film-form-msg');
  const btn     = document.getElementById('btn-admin-add-film');

  if (!title || !link) {
    msgEl.textContent = 'Title and Stream Link are required.';
    msgEl.style.color = '#ef4444'; msgEl.style.display = 'block'; return;
  }

  btn.textContent = 'Uploading...'; btn.disabled = true;
  msgEl.style.display = 'none';
  try {
    const res = await fetch('/api/admin/add-film', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail: currentUser.email, title, telegramLink: link,
        thumbnailBase64: adminFilmThumbBase64, price: parseFloat(price) || 20,
        rentalDays: parseInt(days) || 3,
        adUnlockEnabled: document.getElementById('film-form-ad-unlock')?.checked !== false,
        trailerLink: trailer || null,
        earlyAccessUntil: earlyUntil
      })
    });
    const data = await res.json();
    if (data.success) {
      msgEl.textContent = '\u2713 Film added successfully!';
      msgEl.style.color = '#22c55e'; msgEl.style.display = 'block';
      resetFilmForm();
      loadAdminFilms();
    } else throw new Error(data.error);
  } catch (e) {
    msgEl.textContent = 'Error: ' + e.message;
    msgEl.style.color = '#ef4444'; msgEl.style.display = 'block';
  }
  btn.textContent = 'Add Film to Store'; btn.disabled = false;
}

async function saveEditFilm(filmId) {
  const title   = document.getElementById('film-form-title').value.trim();
  const link    = document.getElementById('film-form-link').value.trim();
  const price   = document.getElementById('film-form-price').value;
  const days    = document.getElementById('film-form-days').value;
  const trailer = document.getElementById('film-form-trailer')?.value.trim() || '';
  const earlyEl = document.getElementById('film-form-early-access');
  const earlyUntil = earlyEl?.value ? new Date(earlyEl.value).getTime() : null;
  const msgEl   = document.getElementById('film-form-msg');
  const btn     = document.getElementById('btn-admin-add-film');

  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    const body = {
      adminEmail: currentUser.email, filmId, title, telegramLink: link,
      price: parseFloat(price) || 20, rentalDays: parseInt(days) || 3,
      adUnlockEnabled: document.getElementById('film-form-ad-unlock')?.checked !== false,
      trailerLink: trailer || null,
      earlyAccessUntil: earlyUntil
    };
    if (adminFilmThumbBase64) body.thumbnailBase64 = adminFilmThumbBase64;
    const res = await fetch('/api/admin/update-film', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) {
      msgEl.textContent = '\u2713 Film updated!'; msgEl.style.color = '#22c55e'; msgEl.style.display = 'block';
      resetFilmForm(); loadAdminFilms();
      const storeModal = document.getElementById('film-store-modal');
      if (storeModal && storeModal.style.display !== 'none') loadFilmStore();
    } else throw new Error(data.error);
  } catch (e) {
    msgEl.textContent = 'Error: ' + e.message; msgEl.style.color = '#ef4444'; msgEl.style.display = 'block';
  }
  btn.textContent = 'Save Changes'; btn.disabled = false;
}

function resetFilmForm() {
  document.getElementById('film-edit-id').value = '';
  document.getElementById('film-form-title').value = '';
  document.getElementById('film-form-link').value = '';
  document.getElementById('film-form-price').value = '20';
  document.getElementById('film-form-days').value = '3';
  const adUnlockChk = document.getElementById('film-form-ad-unlock');
  if (adUnlockChk) adUnlockChk.checked = true;
  const trailerEl = document.getElementById('film-form-trailer');
  if (trailerEl) trailerEl.value = '';
  const earlyEl = document.getElementById('film-form-early-access');
  if (earlyEl) earlyEl.value = '';
  document.getElementById('film-thumb-preview').style.display = 'none';
  document.getElementById('film-thumb-label-text').textContent = 'Click to upload poster image';
  document.getElementById('film-form-thumb').value = '';
  document.getElementById('film-form-heading').textContent = 'Add New Film';
  document.getElementById('btn-admin-add-film').textContent = 'Add Film to Store';
  document.getElementById('btn-admin-cancel-edit').style.display = 'none';
  document.getElementById('film-form-msg').style.display = 'none';
  adminFilmThumbBase64 = '';
}

function startEditFilm(film) {
  document.getElementById('film-edit-id').value = film.filmId;
  document.getElementById('film-form-title').value = film.title;
  document.getElementById('film-form-link').value = film.telegramLink || '';
  document.getElementById('film-form-price').value = film.price || 20;
  document.getElementById('film-form-days').value = film.rentalDays || 3;
  const adUnlockChk = document.getElementById('film-form-ad-unlock');
  if (adUnlockChk) adUnlockChk.checked = film.adUnlockEnabled !== false;
  const trailerEl = document.getElementById('film-form-trailer');
  if (trailerEl) trailerEl.value = film.trailerLink || '';
  const earlyEl = document.getElementById('film-form-early-access');
  if (earlyEl && film.earlyAccessUntil) {
    // Convert timestamp to datetime-local value format (YYYY-MM-DDTHH:MM)
    const dt = new Date(film.earlyAccessUntil);
    const pad = n => String(n).padStart(2,'0');
    earlyEl.value = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } else if (earlyEl) { earlyEl.value = ''; }
  document.getElementById('film-form-heading').textContent = 'Edit Film';
  document.getElementById('btn-admin-add-film').textContent = 'Save Changes';
  document.getElementById('btn-admin-cancel-edit').style.display = 'block';
  if (film.thumbnailBase64) {
    const preview = document.getElementById('film-thumb-preview');
    preview.src = film.thumbnailBase64; preview.style.display = 'block';
    document.getElementById('film-thumb-label-text').textContent = '\u2713 Existing poster \u2014 click to change';
    adminFilmThumbBase64 = film.thumbnailBase64;
  }
  document.getElementById('film-form-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteFilm(filmId, btn) {
  if (!confirm('Delete this film from the store? This cannot be undone.')) return;
  const orig = btn.textContent; btn.textContent = '...'; btn.disabled = true;
  try {
    const res = await fetch('/api/admin/delete-film', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, filmId })
    });
    const data = await res.json();
    if (data.success) loadAdminFilms();
    else { btn.textContent = orig; btn.disabled = false; alert('Error: ' + data.error); }
  } catch (e) { btn.textContent = orig; btn.disabled = false; }
}

window.loadAdminFilms = async function() {
  const list = document.getElementById('admin-films-list');
  if (!list || !currentUser) return;
  list.innerHTML = '<p style="color:#52525b;font-size:0.875rem;">Loading...</p>';
  try {
    const res = await fetch(`/api/admin/films?adminEmail=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    if (!data.success || !data.films || data.films.length === 0) {
      list.innerHTML = '<p style="color:#52525b;font-size:0.875rem;font-style:italic;">No films added yet.</p>';
      return;
    }
    list.innerHTML = '';
    data.films.forEach(film => {
      const row = document.createElement('div');
      row.className = 'admin-film-row';
      row.innerHTML = `
        <div class="admin-film-row-thumb">
          ${film.thumbnailBase64 ? `<img src="${film.thumbnailBase64}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#27272a;border-radius:8px;font-size:1.25rem;">\u{1F3AC}</div>'}
        </div>
        <div class="admin-film-row-info">
          <div class="admin-film-row-title">${film.title}</div>
          <div class="admin-film-row-meta">\u20B9${film.price} \u00B7 ${film.rentalDays} day${film.rentalDays > 1 ? 's' : ''} \u00B7 <span style="color:${film.isActive ? '#22c55e' : '#ef4444'}">${film.isActive ? 'Active' : 'Hidden'}</span> \u00B7 <span style="background:${film.adUnlockEnabled !== false ? 'rgba(168,85,247,0.15)' : 'rgba(234,179,8,0.15)'};color:${film.adUnlockEnabled !== false ? '#c084fc' : '#eab308'};border:1px solid ${film.adUnlockEnabled !== false ? 'rgba(168,85,247,0.4)' : 'rgba(234,179,8,0.4)'};border-radius:4px;padding:0 5px;font-size:0.65rem;font-weight:800;">${film.adUnlockEnabled !== false ? '\u{1F4FA} FREE WITH ADS' : '\u{1F3AC} PREMIUM ONLY'}</span></div>
          <div class="admin-film-row-link" title="${film.telegramLink || ''}">${(film.telegramLink || '').substring(0, 50)}${(film.telegramLink || '').length > 50 ? '\u2026' : ''}</div>
        </div>
        <div class="admin-film-row-actions">
          <button class="btn-edit-film btn btn-secondary" style="padding:0.4rem 0.75rem;font-size:0.75rem;min-height:auto;width:auto;">Edit</button>
          <button class="btn-toggle-ad-film btn" style="padding:0.4rem 0.75rem;font-size:0.7rem;font-weight:800;min-height:auto;width:auto;background:${film.adUnlockEnabled !== false ? 'rgba(168,85,247,0.15)' : 'rgba(234,179,8,0.12)'};color:${film.adUnlockEnabled !== false ? '#c084fc' : '#eab308'};border:1px solid ${film.adUnlockEnabled !== false ? 'rgba(168,85,247,0.4)' : 'rgba(234,179,8,0.4)'};">${film.adUnlockEnabled !== false ? '\u{1F4FA} Free \u2192 \u{1F3AC} Make Premium' : '\u{1F3AC} Premium \u2192 \u{1F4FA} Make Free'}</button>
          <button class="btn-toggle-film btn btn-outline" style="padding:0.4rem 0.75rem;font-size:0.75rem;min-height:auto;width:auto;">${film.isActive ? 'Hide' : 'Show'}</button>
          <button class="btn-delete-film btn" style="padding:0.4rem 0.75rem;font-size:0.75rem;min-height:auto;width:auto;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid #ef4444;">Delete</button>
        </div>
      `;
      row.querySelector('.btn-edit-film').onclick = () => startEditFilm(film);
      row.querySelector('.btn-delete-film').onclick = (e) => deleteFilm(film.filmId, e.currentTarget);
      // Quick Ad ON/OFF toggle
      row.querySelector('.btn-toggle-ad-film').onclick = async (e) => {
        const b = e.currentTarget; b.textContent = '...'; b.disabled = true;
        const newState = film.adUnlockEnabled === false; // toggle
        await fetch('/api/admin/update-film', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminEmail: currentUser.email, filmId: film.filmId, adUnlockEnabled: newState })
        });
        loadAdminFilms();
        // Also refresh public film store if it is open
        const storeModal = document.getElementById('film-store-modal');
        if (storeModal && storeModal.style.display !== 'none') loadFilmStore();
      };
      row.querySelector('.btn-toggle-film').onclick = async (e) => {
        const b = e.currentTarget; b.textContent = '...'; b.disabled = true;
        await fetch('/api/admin/update-film', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminEmail: currentUser.email, filmId: film.filmId, isActive: !film.isActive }) });
        loadAdminFilms();
      };
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<p style="color:#ef4444;font-size:0.875rem;">Error: ${e.message}</p>`;
  }
};

// =====================================================================
// WINDOW EXPORTS \u2014 expose functions used by HTML onclick="" attributes
// (required because app.js is type="module" \u2014 module scope \u2260 global scope)
// =====================================================================
window.loadRentalLedger  = loadRentalLedger;
window.loadCodeUsers     = loadCodeUsers;

// ==== ADMIN: Free Pass Users ====
window.loadFreePassUsers = async function() {
    const tbody = document.getElementById('free-pass-users-body');
    if (!tbody || !currentUser) return;
    tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-zinc-600 italic">Loading...</td></tr>';

    try {
        const res = await fetch(`/api/admin/free-pass-users?adminEmail=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        if (!data.users || data.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-zinc-600 italic">No free pass claims yet.</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        data.users.forEach(u => {
            const active = u.freePassActive;
            const expiry = u.freePassExpiry ? new Date(u.freePassExpiry).toLocaleString('en-IN') : '\u2014';
            const claimedAt = u.freePassGrantedAt ? new Date(u.freePassGrantedAt).toLocaleString('en-IN') : '\u2014';
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-zinc-900/40 transition-colors';
            tr.innerHTML = `
              <td class="px-6 py-3 font-medium text-white">${u.displayName || '\u2014'}</td>
              <td class="px-6 py-3 text-zinc-400 text-xs" title="${u.uid}">${u.email || u.uid.substring(0, 12) + '\u2026'}</td>
              <td class="px-6 py-3">
                <span class="badge-pill ${active ? 'badge-success' : 'status-badge-expired'}">
                  ${active ? '\u2713 Active' : '\u2717 Expired'}
                </span>
              </td>
              <td class="px-6 py-3 text-xs text-zinc-400">${expiry}</td>
              <td class="px-6 py-3 text-xs text-zinc-500">${claimedAt}</td>
              <td class="px-6 py-3 text-right flex gap-2 justify-end">
                <button onclick="manageFreePass('${u.uid}','extend-24h',this)" class="btn btn-outline text-xs py-1 px-3 text-green-400 border-green-800 hover:bg-green-900">+24h</button>
                <button onclick="manageFreePass('${u.uid}','revoke',this)" class="btn btn-outline text-xs py-1 px-3 text-red-400 border-red-900 hover:bg-red-950">Revoke</button>
              </td>`;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400">Error: ${e.message}</td></tr>`;
    }
};

window.manageFreePass = async function(userId, action, btn) {
    if (!currentUser) return;
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '...';
    try {
        const res = await fetch('/api/admin/manage-free-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminEmail: currentUser.email, userId, action })
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.error);
        showToast(d.message || 'Done!', 'success');
        window.loadFreePassUsers(); // Reload table
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = orig;
    }
};

// ==== ADMIN: Visitor Stats ====
window.loadVisitorStats = async function() {
    const el = document.getElementById('admin-visitor-count');
    const spinner = document.getElementById('visitor-stats-spinner');
    if (!el || !currentUser) return;
    if (spinner) spinner.style.display = 'inline-block';
    try {
        const res = await fetch(`/api/visitor-stats?adminEmail=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (data.success) {
            el.textContent = data.totalVisitors || 0;
        } else {
            el.textContent = 'Error';
        }
    } catch(e) {
        el.textContent = '\u2014';
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
};

// ==== ADMIN: Free Day Toggle ====
window.loadFreeDayStatus = async function() {
    const toggle = document.getElementById('free-day-toggle');
    const label = document.getElementById('free-day-label');
    if (!toggle) return;
    try {
        const res = await fetch('/api/platform-config');
        const data = await res.json();
        toggle.checked = data.freeDayActive === true;
        if (label) label.textContent = data.freeDayActive ? '\u{1F7E2} Free Day: ON (all users have free access)' : '\u{1F534} Free Day: OFF (normal access rules apply)';
    } catch(e) {
        if (label) label.textContent = 'Error loading status';
    }
};

window.toggleFreeDay = async function() {
    const toggle = document.getElementById('free-day-toggle');
    const label = document.getElementById('free-day-label');
    if (!toggle || !currentUser) return;
    const newState = toggle.checked;
    try {
        const res = await fetch('/api/admin/set-free-day', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminEmail: currentUser.email, freeDayActive: newState })
        });
        const data = await res.json();
        if (data.success) {
            // Reset platform config cache so next checkAccessAndRoute picks up new state
            _platformConfig = null;
            if (label) label.textContent = newState 
                ? '\u{1F7E2} Free Day: ON (all users have free access)' 
                : '\u{1F534} Free Day: OFF (normal access rules apply)';
        } else {
            toggle.checked = !newState; // Revert
            alert('Error: ' + data.error);
        }
    } catch(e) {
        toggle.checked = !newState; // Revert
        alert('Network error. Try again.');
    }
};

// =====================================================================
// LOADING SCREEN \u2014 hide once Firebase auth has resolved (either way)
// =====================================================================
let _authResolved = false;
function hideLoadingScreen() {
    const screen = document.getElementById('loading-screen');
    if (!screen || _authResolved) return;
    _authResolved = true;
    sessionStorage.setItem('_vns_loaded', '1'); // skip splash on back-navigation
    screen.classList.add('fade-out');
    setTimeout(() => { if (screen.parentNode) screen.parentNode.removeChild(screen); }, 550);
}

// Second (lightweight) auth listener purely to dismiss the loading screen
onAuthStateChanged(auth, () => hideLoadingScreen());

// Safety net: hide loading screen after MAX 1.5 seconds regardless of auth state
setTimeout(hideLoadingScreen, 1500);

// =====================================================================
// PUBLIC PAGE-VIEW COUNTER \u2014 animated roll-up (Footer)
// =====================================================================
function animateCounter(el, target, duration) {
    const start = performance.now();
    const update = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
        el.textContent = Math.round(target * eased).toLocaleString('en-IN');
        if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
}

async function fetchPublicPageViews() {
    try {
        const res = await fetch('/api/page-view-count');
        const data = await res.json();
        const el = document.getElementById('public-visitor-count');
        if (el && data.success && data.totalPageViews) {
            animateCounter(el, data.totalPageViews, 1400);
        }
    } catch(e) { /* non-critical */ }
}

// Fetch immediately \u2014 no auth required
fetchPublicPageViews();

// =====================================================================
// HELP FAB + CONTACT MODAL
// =====================================================================
(function initHelpAndContact() {
    const fab         = document.getElementById('help-fab');
    const modal       = document.getElementById('contact-modal');
    const btnClose    = document.getElementById('btn-close-contact');
    const btnSend     = document.getElementById('btn-send-contact');
    const imgInput    = document.getElementById('contact-screenshot');
    const imgPreview  = document.getElementById('contact-preview');
    const fileNameEl  = document.getElementById('contact-file-name');
    const statusEl    = document.getElementById('contact-status');

    if (!fab || !modal) return;

    // Toggle open/close
    fab.addEventListener('click', () => {
        const isHidden = modal.classList.contains('hidden');
        if (isHidden) {
            modal.classList.remove('hidden');
            // Pre-fill logged-in user info
            const nameEl  = document.getElementById('contact-name');
            const emailEl = document.getElementById('contact-email');
            if (nameEl && sessionUserName && sessionUserName !== 'Guest') nameEl.value = sessionUserName;
            if (emailEl && currentUser?.email) emailEl.value = currentUser.email;
        } else {
            modal.classList.add('hidden');
        }
    });

    // Close buttons
    if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    // Screenshot preview
    if (imgInput) {
        imgInput.addEventListener('change', () => {
            const file = imgInput.files[0];
            if (!file) return;
            if (fileNameEl) fileNameEl.textContent = file.name.length > 28 ? file.name.substring(0,25)+'\u2026' : file.name;
            const reader = new FileReader();
            reader.onload = (e) => {
                if (imgPreview) { imgPreview.src = e.target.result; imgPreview.classList.remove('hidden'); }
            };
            reader.readAsDataURL(file);
        });
    }

    // Form submit
    if (btnSend) {
        btnSend.addEventListener('click', async () => {
            const name    = document.getElementById('contact-name')?.value?.trim() || 'Anonymous';
            const email   = document.getElementById('contact-email')?.value?.trim() || '';
            const message = document.getElementById('contact-message')?.value?.trim();

            if (!message) {
                if (statusEl) {
                    statusEl.textContent = 'Please write a message first.';
                    statusEl.className = 'text-center text-sm mt-3 text-red-400';
                    statusEl.classList.remove('hidden');
                }
                return;
            }

            btnSend.textContent = 'Sending\u2026';
            btnSend.disabled = true;
            if (statusEl) statusEl.classList.add('hidden');

            // Read screenshot as base64 if attached
            let screenshotBase64 = null;
            if (imgInput?.files?.[0]) {
                screenshotBase64 = await new Promise(resolve => {
                    const r = new FileReader();
                    r.onload = (ev) => resolve(ev.target.result);
                    r.readAsDataURL(imgInput.files[0]);
                });
            }

            try {
                const res = await fetch('/api/send-contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, message, screenshotBase64 })
                });
                const data = await res.json();
                if (data.success) {
                    if (statusEl) {
                        statusEl.textContent = "\u2713 Message sent! We'll reply within 24 hours.";
                        statusEl.className = 'text-center text-sm mt-3 text-green-400';
                        statusEl.classList.remove('hidden');
                    }
                    // Reset form
                    document.getElementById('contact-message').value = '';
                    if (imgInput) imgInput.value = '';
                    if (imgPreview) { imgPreview.src = ''; imgPreview.classList.add('hidden'); }
                    if (fileNameEl) fileNameEl.textContent = 'Click to attach screenshot';
                    setTimeout(() => modal.classList.add('hidden'), 2200);
                } else {
                    throw new Error(data.error || 'Server error');
                }
            } catch(err) {
                if (statusEl) {
                    statusEl.textContent = '\u2715 Failed to send. Check your connection and try again.';
                    statusEl.className = 'text-center text-sm mt-3 text-red-400';
                    statusEl.classList.remove('hidden');
                }
            }

            btnSend.textContent = 'Send Message';
            btnSend.disabled = false;
        });
    }
})();

// =====================================================================
// FREE PASS BUTTON \u2014 wire up event (card is injected by checkAccessAndRoute)
// =====================================================================
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-claim-free-pass') claimFreePass();
});

// =====================================================================
// TOAST NOTIFICATION SYSTEM
// =====================================================================
const _toastIcons = { success: '\u2713', error: '\u2715', info: '\u2139', warn: '\u26A0' };

function showToast(message, type = 'info', duration = 3500) {
    // Get or create container
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${_toastIcons[type] || _toastIcons.info}</span><span>${message}</span>`;

    // Click to dismiss early
    toast.addEventListener('click', () => dismissToast(toast));

    container.appendChild(toast);

    // Trigger enter animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('toast-show'));
    });

    // Auto-dismiss
    setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
    if (!toast.parentNode) return;
    toast.classList.remove('toast-show');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
}

// Make globally available
window.showToast = showToast;


// =====================================================================
// AD MONETIZATION SYSTEM
// =====================================================================

// ---- Premium user guard \u2014 NO ADS for paid subscribers ----
// Returns true if the current user has an active paid subscription or is admin.
// Premium users bypass ALL ad experiences.
function isPremiumUser() {
    if (!currentUser) return false;
    // Admin is always premium
    if (currentUser.email === 'anubhabmohapatra.01@gmail.com') return true;
    if (!currentUserDoc) return false;
    // \u2605 TIER STRATEGY:
    // one-time (1-day, \u20B950) \u2192 premium=true BUT sees reduced 3 in-movie ad breaks (stays on index.html)
    // weekly / monthly / access-code / extended \u2192 fully premium, zero ads, redirected to premium.html
    const premiumPlans = ['one-time', 'weekly', 'monthly', 'access-code', 'extended_by_admin'];
    return premiumPlans.includes(currentUserDoc.activeSubscription) &&
           currentUserDoc.subscriptionExpiry > Date.now();
}

// Returns true only for week/month subscribers (full ad-free, premium.html redirect)
function isFullPremiumUser() {
    if (!currentUser) return false;
    if (currentUser.email === 'anubhabmohapatra.01@gmail.com') return true;
    if (!currentUserDoc) return false;
    const fullPlans = ['weekly', 'monthly', 'access-code', 'extended_by_admin'];
    return fullPlans.includes(currentUserDoc.activeSubscription) &&
           currentUserDoc.subscriptionExpiry > Date.now();
}

// ---- Ad Modal Engine ----
// showAdModal(adNum, totalAds, durationSecs)
// Returns a promise that resolves when ad countdown finishes.
function showAdModal(adNum, totalAds, durationSecs = 30) {
    return new Promise((resolve) => {
        const modal     = document.getElementById('ad-modal');
        const numEl     = document.getElementById('ad-modal-num');
        const totalEl   = document.getElementById('ad-modal-total');
        const countdown = document.getElementById('ad-countdown');
        const fillEl    = document.getElementById('ad-progress-fill');
        const bannerDiv = document.getElementById('modal-banner-container');

        if (!modal) { resolve(); return; }

        // Set labels
        if (numEl)   numEl.textContent   = adNum;
        if (totalEl) totalEl.textContent = totalAds;
        if (countdown) countdown.textContent = durationSecs;
        if (fillEl)  { fillEl.style.transition = 'none'; fillEl.style.width = '0%'; }

        if (bannerDiv) {
            bannerDiv.innerHTML = '';
            bannerDiv.style.position = 'relative';
            bannerDiv.style.minHeight = '250px';

            const fallback = document.createElement('div');
            fallback.id = 'ad-modal-fallback';
            fallback.style.cssText = `
                position:absolute;inset:0;display:flex;flex-direction:column;
                align-items:center;justify-content:center;gap:1rem;
                background:linear-gradient(135deg,#0d0d12,#171722);
                border:1px solid #2d2d3a;border-radius:12px;
                font-family:inherit;text-align:center;padding:2rem;z-index:1;
            `;
            fallback.innerHTML = `
                <div style="font-size:3rem;line-height:1;">??</div>
                <div style="color:#e4e4e7;font-size:1rem;font-weight:700;">Supporting Vaanisethu</div>
                <div style="color:#71717a;font-size:0.78rem;line-height:1.6;max-width:240px;">
                    Ads keep Vaanisethu free for everyone.<br>
                    <span style="color:#a855f7;font-weight:600;">Please wait for the countdown to finish.</span>
                </div>
            `;
            bannerDiv.appendChild(fallback);

            // INJECT VIGNETTE AD SCRIPT
            (function(s){s.dataset.zone='10928460',s.src='https://n6wxm.com/vignette.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));
        }

        modal.style.display = 'flex';
        modal.classList.remove('hidden');


        // Prevent clicking outside to close
        const blockClose = (e) => e.stopPropagation();
        modal.addEventListener('click', blockClose);

        let remaining = durationSecs;

        // Start progress bar after a tiny delay (force reflow)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (fillEl) {
                    fillEl.style.transition = `width ${durationSecs}s linear`;
                    fillEl.style.width = '100%';
                }
            });
        });

        const tick = setInterval(() => {
            remaining--;
            if (countdown) countdown.textContent = remaining;

            if (remaining <= 0) {
                clearInterval(tick);
                modal.removeEventListener('click', blockClose);
                modal.style.display = 'none';
                modal.classList.add('hidden');
                // Reset progress bar
                if (fillEl) { fillEl.style.transition = 'none'; fillEl.style.width = '0%'; }
                // Clear ad iframe to stop audio
                if (bannerDiv) bannerDiv.innerHTML = '';
                resolve();
            }
        }, 1000);
    });
}

// ---- Site-Access Ad Flow (Payment Page: Watch 4 Ads \u2192 24hr pass) ----
async function startAdFlow() {
    if (!currentUser) {
        showToast('Please sign in first.', 'error');
        return;
    }

    const btn   = document.getElementById('btn-start-ad-flow');
    const msgEl = document.getElementById('ad-pass-msg');

    // Step indicator IDs: ad-step-1 \u2026 ad-step-4 = ads, ad-step-5 = Access
    const stepEls = [1, 2, 3, 4, 5].map(i => document.getElementById(`ad-step-${i}`));

    if (btn) { btn.disabled = true; btn.textContent = 'Starting ads...'; }

    const TOTAL_ADS   = 4;
    const AD_DURATION = 30; // seconds per ad
    const collectedTokens = [];

    try {
        for (let i = 1; i <= TOTAL_ADS; i++) {
            // Mark current ad step active
            if (stepEls[i - 1]) stepEls[i - 1].className = 'ad-step-indicator ad-step-active';
            if (btn) btn.textContent = `Watching Ad ${i} of ${TOTAL_ADS}...`;

            await showAdModal(i, TOTAL_ADS, AD_DURATION);

            // Get verification token from server
            const r = await fetch('/api/verify-ad-completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), adIndex: i })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error || `Ad ${i} verification failed`);

            collectedTokens.push(d.token);
            if (stepEls[i - 1]) stepEls[i - 1].className = 'ad-step-indicator ad-step-done';

            if (i < TOTAL_ADS) showToast(`Ad ${i} done! ${TOTAL_ADS - i} more to go.`, 'info', 2000);
        }

        // All 4 ads done \u2014 request access grant
        if (stepEls[4]) stepEls[4].className = 'ad-step-indicator ad-step-active';
        if (btn) btn.textContent = 'Granting access...';

        const fp = window._fp_visitor_id || '';
        const rGrant = await fetch('/api/grant-ad-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), tokens: collectedTokens, fingerprint: fp })
        });
        const dGrant = await rGrant.json();
        if (!dGrant.success) throw new Error(dGrant.error || 'Access grant failed');

        if (stepEls[4]) stepEls[4].className = 'ad-step-indicator ad-step-done';
        if (msgEl) {
            msgEl.textContent = '\u{1F389} 24-hour access granted! Redirecting...';
            msgEl.className = 'text-xs mt-3 text-center text-green-400';
            msgEl.classList.remove('hidden');
        }

        showToast('\u{1F389} 24-hour free access granted!', 'success', 4000);

        // Force-refresh user doc (handles snake_case→camelCase) then route to dashboard
        setTimeout(() => {
            _pollUserDoc();
        }, 2000);

    } catch (err) {
        showToast('Ad flow error: ' + err.message, 'error');
        if (msgEl) {
            msgEl.textContent = '\u2715 ' + err.message;
            msgEl.className = 'text-xs mt-3 text-center text-red-400';
            msgEl.classList.remove('hidden');
        }
        // Reset all steps
        stepEls.forEach(el => { if (el) el.className = 'ad-step-indicator ad-step-pending'; });
        if (btn) { btn.disabled = false; btn.textContent = '\u{1F4FA} Watch 4 Ads & Get Free 24hr Access'; }
    }
}

// Wire up the button
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-start-ad-flow') startAdFlow();
});

// ---- Per-Film Ad Unlock Flow ----
async function startFilmAdUnlock(filmId, filmTitle, adBtn) {
    if (!currentUser) {
        showToast('Please sign in first.', 'error');
        return;
    }

    // \u2705 Pre-check: verify this film still has ad unlock enabled BEFORE showing the ad
    // (Admin may have turned it off after the page loaded)
    const cachedFilm = window._allFilms && window._allFilms.find(f => f.filmId === filmId);
    if (cachedFilm && cachedFilm.adUnlockEnabled === false) {
        showToast('\u274C Ad unlock is not available for this film.', 'error');
        if (adBtn) { adBtn.disabled = false; adBtn.textContent = '\u{1F4FA} Watch 1 Ad \u2014 Free 1hr Access'; }
        return;
    }

    // Also do a fresh server-side pre-check via /api/films
    try {
        const freshFilms = await fetch('/api/films').then(r => r.json());
        if (freshFilms.success) {
            const freshFilm = (freshFilms.films || []).find(f => f.filmId === filmId);
            if (freshFilm && freshFilm.adUnlockEnabled === false) {
                showToast('\u274C Ad unlock is not available for this film.', 'error');
                if (adBtn) { adBtn.disabled = false; adBtn.textContent = '\u{1F4FA} Watch 1 Ad \u2014 Free 1hr Access'; }
                // Also refresh the film store so the button disappears
                loadFilmStore();
                return;
            }
        }
    } catch (_) { /* continue even if fresh check fails */ }

    if (adBtn) { adBtn.disabled = true; adBtn.textContent = '\u23F3 Watch Ad...'; }

    try {
        // Show the ad modal \u2014 30s countdown
        await showAdModal(1, 1, 30);

        if (adBtn) adBtn.textContent = '\u23F3 Verifying...';

        // Get verification token
        const r = await fetch('/api/verify-ad-completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), adIndex: 1 })
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Ad verification failed');

        // Grant unlock
        const rUnlock = await fetch('/api/grant-film-ad-unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), filmId, token: d.token })
        });
        const dUnlock = await rUnlock.json();
        if (!dUnlock.success) throw new Error(dUnlock.error || 'Unlock failed');

        showToast(`\u{1F3AC} "${filmTitle}" unlocked for 1 hour!`, 'success', 4000);
        // Reload film store to show the unlocked state
        loadFilmStore();

    } catch (err) {
        showToast('Film unlock failed: ' + err.message, 'error');
        if (adBtn) { adBtn.disabled = false; adBtn.textContent = '\u{1F4FA} Watch 1 Ad \u2014 Free 1hr Access'; }
    }
}

// Fetch user's ad-unlocked films (returns a Map of filmId \u2192 unlock data)
async function fetchMyAdUnlocks() {
    if (!currentUser) return new Map();
    try {
        const res = await fetch(`/api/my-ad-unlocks?userId=${encodeURIComponent((currentUserDoc?.uid || currentUser?.uid))}`);
        const data = await res.json();
        if (!data.success) return new Map();
        const map = new Map();
        data.unlocks.forEach(u => map.set(u.filmId, u));
        return map;
    } catch(e) {
        return new Map();
    }
}

// Store ad unlocks globally so film card renderer can use it
window._adUnlocks = new Map();

// Called after login to populate ad unlocks
async function refreshAdUnlocks() {
    window._adUnlocks = await fetchMyAdUnlocks();
}
window.refreshAdUnlocks = refreshAdUnlocks;

// Export for use in film card rendering (called from loadFilmStoreView)
window.startFilmAdUnlock = startFilmAdUnlock;


// =====================================================================
// IN-MOVIE SKIPPABLE AD SYSTEM
// Triggers skippable ad breaks at specific VIDEO timestamps (not wall clock)
// Ad break schedule: 20min, 45min, 70min into the video
// Skippable after 5 seconds
// =====================================================================

const _INMOVIE_AD_BREAK_SECS_FULL    = [5*60, 14*60, 24*60, 35*60, 48*60, 62*60, 78*60]; // 7 breaks (free/ad-pass users)
const _INMOVIE_AD_BREAK_SECS_REDUCED = [20*60, 50*60, 85*60]; // 3 breaks (1-day \u20B950 plan)
const _INMOVIE_AD_BREAK_SECS = _INMOVIE_AD_BREAK_SECS_FULL; // base (overridden per session below)
const _INMOVIE_SKIP_AFTER_SECS = 5;
const _INMOVIE_AD_DURATION_SECS = 20;
let _inmovieShownBreaks = new Set();
let _inmovieCheckTimer  = null; // kept for compat but unused
let _inmovieAdTick      = null;
let _inmovieVideoListener = null;

function startInMovieAdWatch() {
    if (isFullPremiumUser()) return; // \u{1F396}\uFE0F Full premium (weekly/monthly) \u2014 zero ads
    if (_inmovieVideoListener) return; // already running

    // Determine ad break schedule based on subscription tier
    let adBreakSchedule;
    if (currentUserDoc && currentUserDoc.activeSubscription === 'one-time') {
        // 1-day plan: reduced 3 breaks (still revenue, better UX)
        adBreakSchedule = _INMOVIE_AD_BREAK_SECS_REDUCED;
    } else {
        // Free / ad-pass users: full 7-break schedule
        adBreakSchedule = _INMOVIE_AD_BREAK_SECS_FULL;
    }

    // Set access type so shouldShowInMovieAds() returns true
    if (!window._roomHostAccessType && currentUserDoc &&
        (currentUserDoc.activeSubscription === 'ad-pass' ||
         currentUserDoc.activeSubscription === 'one-time' ||
         !currentUserDoc.activeSubscription ||
         currentUserDoc.freeDay)) {
        window._roomHostAccessType = 'ad-unlock';
    }

    _inmovieShownBreaks.clear();

    const video = document.getElementById('main-video');
    if (!video) return;

    _inmovieVideoListener = () => {
        const roomView = document.getElementById('room-view');
        if (!roomView || roomView.classList.contains('hidden')) return;
        if (video.paused || video.ended) return;

        const t = video.currentTime;
        for (const breakSec of adBreakSchedule) {
            // Fire if within a 15-second window past the break point (handles fast-forward)
            if (t >= breakSec && t < breakSec + 15 && !_inmovieShownBreaks.has(breakSec)) {
                let adLimit = (currentUserDoc && currentUserDoc.activeSubscription === 'one-time') ? 3 : 8;
                if (_inmovieShownBreaks.size >= adLimit) break;
                _inmovieShownBreaks.add(breakSec);
                showInMovieAd();
                break;
            }
        }
    };

    video.addEventListener('timeupdate', _inmovieVideoListener);
}

function stopInMovieAdWatch() {
    const video = document.getElementById('main-video');
    if (video && _inmovieVideoListener) {
        video.removeEventListener('timeupdate', _inmovieVideoListener);
        _inmovieVideoListener = null;
    }
    if (_inmovieCheckTimer) { clearInterval(_inmovieCheckTimer); _inmovieCheckTimer = null; }
    if (_inmovieAdTick)     { clearInterval(_inmovieAdTick);     _inmovieAdTick     = null; }
    _inmovieShownBreaks.clear();
    dismissInMovieAd();
}

// ---- Decision: should this user see in-movie ads right now? ----
// Three layers checked:
// 1. Is this user premium?
// 2. Is the current film's adUnlockEnabled on?
// 3. What access type did the host use to unlock this film?
function shouldShowInMovieAds() {
    if (isFullPremiumUser()) return false;                         // Full premium (weekly/monthly) \u2192 never
    if (window._currentPlayingFilmAdEnabled === false) return false; // Film has ads OFF \u2192 never
    const hat = window._roomHostAccessType || 'generic';
    if (hat === 'premium' || hat === 'rental') return false;       // Host premium/paid rental \u2192 no ads
    return true; // host watched ad ('ad-unlock'), 1-day plan, or generic URL \u2192 ads on
}

function showInMovieAd() {
    if (!shouldShowInMovieAds()) return; // 3-layer check
    const overlay  = document.getElementById('inmovie-ad');
    const timerEl  = document.getElementById('inmovie-ad-timer');
    const skipBtn  = document.getElementById('inmovie-skip-btn');
    const fillEl   = document.getElementById('inmovie-progress-fill');

    if (!overlay) return;
    if (_inmovieAdTick) clearInterval(_inmovieAdTick); // clear any existing tick

    let remaining  = _INMOVIE_AD_DURATION_SECS;
    let skipEnabled = false;

    // \u23F8 PAUSE the video so ad gets full attention
    const video = document.getElementById('main-video');
    if (video && !video.paused) video.pause();

    // Show fullscreen overlay
    overlay.classList.remove('hidden');
    if (timerEl)  timerEl.textContent = `${remaining}s`;
    if (skipBtn)  { skipBtn.classList.add('hidden'); skipBtn.disabled = true; }

    // Update inline hint timer too
    const hintTimer = document.getElementById('inmovie-hint-timer');
    if (hintTimer) hintTimer.textContent = `${remaining}s`;

    const inmovieSlot = document.getElementById('inmovie-banner-container');
    if (inmovieSlot) {
        inmovieSlot.innerHTML = '';

        // Fallback UI \u2014 shown if ad script fails / is blocked
        const fallback = document.createElement('div');
        fallback.id = 'inmovie-ad-fallback';
        fallback.style.cssText = `
            display:none; flex-direction:column; align-items:center; justify-content:center;
            width:300px; min-height:250px; text-align:center; gap:0.75rem; padding:1.5rem;
            color:#71717a; font-size:0.8rem;
        `;
        fallback.innerHTML = `
            <div style="font-size:2.5rem;">\u{1F3AC}</div>
            <div style="font-weight:700;color:#a1a1aa;font-size:0.9rem;">Vaanisethu</div>
            <div style="font-size:0.72rem;color:#52525b;line-height:1.4;">
                Watch movies together with friends.<br>Support us to keep it free!
            </div>
            <div style="font-size:0.65rem;color:#3f3f46;margin-top:0.5rem;">Ad loading\u2026</div>
        `;
        inmovieSlot.appendChild(fallback);

        // MutationObserver: kill any "ads are blocked" text injected by ad network
        const adBlockObserver = new MutationObserver(() => {
            // Remove any element that contains "blocked" or "adblock" text from the network
            inmovieSlot.querySelectorAll('*').forEach(el => {
                const txt = (el.textContent || '').toLowerCase();
                if (
                    (txt.includes('blocked') || txt.includes('adblock') || txt.includes('ad blocker') || txt.includes('contact the owner'))
                    && el.children.length === 0 // leaf node
                ) {
                    // Hide the entire injected container
                    let target = el;
                    while (target.parentElement && target.parentElement !== inmovieSlot) target = target.parentElement;
                    target.style.display = 'none';
                    // Show our branded fallback instead
                    fallback.style.display = 'flex';
                }
            });
        });
        adBlockObserver.observe(inmovieSlot, { childList: true, subtree: true, characterData: true });

        // Inject the actual ad script
        window.atOptions = { key: '466c31e87748ad9ff1e88a1b7cd5a34c', format: 'iframe', height: 250, width: 300, params: {} };
        const s = document.createElement('script');
        s.async = true;
        s.onerror = () => {
            // Script couldn't load at all (blocked by browser/CSP) \u2192 show fallback
            fallback.style.display = 'flex';
            fallback.querySelector('div:last-child').textContent = 'Please whitelist vaanisethu.online to support us!';
        };
        // 3 second timeout: if ad frame doesn't fill the slot, show fallback
        setTimeout(() => {
            const hasRealAd = inmovieSlot.querySelector('iframe, img[src*="ad"]');
            if (!hasRealAd) fallback.style.display = 'flex';
        }, 3000);
        inmovieSlot.appendChild(s);

        // Cleanup observer when ad is dismissed
        overlay._adBlockObserver = adBlockObserver;
    }


    // Reset + animate progress bar
    if (fillEl) { fillEl.style.transition = 'none'; fillEl.style.width = '0%'; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (fillEl) {
            fillEl.style.transition = `width ${_INMOVIE_AD_DURATION_SECS}s linear`;
            fillEl.style.width = '100%';
        }
    }));

    // ---- Start countdown tick ----
    function startTick() {
        _inmovieAdTick = setInterval(() => {
            if (document.hidden) return; // page not visible \u2014 skip decrement
            remaining--;
            if (timerEl) timerEl.textContent = `${remaining}s`;
            // Keep the hint timer in sync too
            const hintT = document.getElementById('inmovie-hint-timer');
            if (hintT) hintT.textContent = `${remaining}s`;

            // Enable skip button after SKIP_AFTER seconds
            if (!skipEnabled && remaining <= _INMOVIE_AD_DURATION_SECS - _INMOVIE_SKIP_AFTER_SECS) {
                skipEnabled = true;
                if (skipBtn) { skipBtn.classList.remove('hidden'); skipBtn.disabled = false; }
            }

            if (remaining <= 0) {
                clearInterval(_inmovieAdTick);
                _inmovieAdTick = null;
                cleanup();
                dismissInMovieAd();
            }
        }, 1000);
    }

    // ---- Page Visibility: pause/resume ----
    function onVisibilityChange() {
        if (document.hidden) {
            // Tab hidden / app backgrounded \u2192 pause progress bar animation
            if (fillEl) {
                const computedW = window.getComputedStyle(fillEl).width;
                const parentW   = fillEl.parentElement ? window.getComputedStyle(fillEl.parentElement).width : '1px';
                const pct = (parseFloat(computedW) / parseFloat(parentW)) * 100;
                fillEl.style.transition = 'none';
                fillEl.style.width = `${Math.max(0, pct)}%`;
            }
            // The setInterval itself still fires but skips decrement (document.hidden check above)
        } else {
            // Tab visible again \u2192 resume progress bar animation for remaining time
            if (fillEl && remaining > 0) {
                fillEl.style.transition = `width ${remaining}s linear`;
                fillEl.style.width = '100%';
            }
        }
    }

    function cleanup() {
        document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    startTick();

    // Skip button handler
    if (skipBtn) {
        skipBtn.onclick = () => {
            if (!skipEnabled) return;
            if (_inmovieAdTick) { clearInterval(_inmovieAdTick); _inmovieAdTick = null; }
            cleanup(); // remove visibilitychange listener
            dismissInMovieAd();
        };
    }
}

function dismissInMovieAd() {
    const overlay = document.getElementById('inmovie-ad');
    if (overlay) {
        overlay.classList.add('hidden');
        // Cleanup MutationObserver
        if (overlay._adBlockObserver) {
            overlay._adBlockObserver.disconnect();
            overlay._adBlockObserver = null;
        }
    }
    const fill = document.getElementById('inmovie-progress-fill');
    if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
    // Clear ad iframe to stop any audio
    const slot = document.getElementById('inmovie-banner-container');
    if (slot) slot.innerHTML = '';
    // \u25B6 RESUME video after ad
    const video = document.getElementById('main-video');
    if (video && video.paused && video.src) {
        video.play().catch(() => {});
    }
}

// Auto-start/stop in-movie ads by observing room-view visibility
(function initInMovieAdObserver() {
    const roomView = document.getElementById('room-view');
    if (!roomView) return;

    let wasVisible = false;
    const obs = new MutationObserver(() => {
        const isVisible = !roomView.classList.contains('hidden');
        if (isVisible && !wasVisible) {
            startInMovieAdWatch();
        } else if (!isVisible && wasVisible) {
            stopInMovieAdWatch();
        }
        wasVisible = isVisible;
    });
    obs.observe(roomView, { attributes: true, attributeFilter: ['class'] });
})();

window.startInMovieAdWatch = startInMovieAdWatch;
window.stopInMovieAdWatch  = stopInMovieAdWatch;


// =====================================================================
// AD BREAK TIMELINE BAR  (yellow markers on video progress track)
// =====================================================================

(function initAdTimeline() {
    const video = document.getElementById('main-video');
    if (!video) return;

    const AD_BREAK_SECS = typeof _INMOVIE_AD_BREAK_SECS !== 'undefined'
        ? _INMOVIE_AD_BREAK_SECS
        : [20 * 60, 45 * 60, 70 * 60];

    function buildTimeline() {
        if (isPremiumUser()) return; // premium users don't need this
        const bar     = document.getElementById('ad-timeline-bar');
        const track   = document.getElementById('ad-timeline-track');
        const cursor  = document.getElementById('ad-timeline-cursor');
        if (!bar || !track) return;

        const duration = video.duration;
        if (!duration || !isFinite(duration)) { bar.classList.add('hidden'); return; }

        // Clear old markers (keep cursor)
        track.querySelectorAll('.ad-timeline-marker').forEach(m => m.remove());

        // Insert yellow markers only for breaks that fit in the video
        AD_BREAK_SECS.forEach(t => {
            if (t >= duration) return;
            const pct = (t / duration) * 100;
            const marker = document.createElement('div');
            marker.className = 'ad-timeline-marker';
            marker.style.left = pct + '%';
            marker.title = `Ad break at ${Math.floor(t / 60)}m`;
            track.appendChild(marker);
        });

        bar.classList.remove('hidden');
    }

    function updateCursor() {
        const cursor   = document.getElementById('ad-timeline-cursor');
        const duration = video.duration;
        if (!cursor || !duration || !isFinite(duration)) return;
        const pct = (video.currentTime / duration) * 100;
        cursor.style.left = Math.min(pct, 100) + '%';
    }

    video.addEventListener('loadedmetadata', buildTimeline);
    video.addEventListener('timeupdate', updateCursor);

    // Hide bar when video is cleared
    video.addEventListener('emptied', () => {
        const bar = document.getElementById('ad-timeline-bar');
        if (bar) bar.classList.add('hidden');
    });
})();

// =====================================================================
// V2 FEATURES
// =====================================================================

// ---- \u{1F4AC} Emoji Reactions ----
function spawnFloatingEmoji(emoji, userName) {
  const el = document.createElement('div');
  el.className = 'emoji-float';
  el.textContent = emoji;
  // Random x near bottom center of room
  const x = (window.innerWidth * 0.3) + Math.random() * (window.innerWidth * 0.4);
  const y = window.innerHeight - 80;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// Emoji tray toggle
(function() {
  const trayBtn = document.getElementById('btn-emoji-tray');
  const tray    = document.getElementById('emoji-tray');
  if (!trayBtn || !tray) return;

  trayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = tray.style.display === 'flex';
    if (isOpen) {
      tray.style.display = 'none';
      return;
    }
    // Position fixed tray below the button using screen coordinates
    const rect = trayBtn.getBoundingClientRect();
    tray.style.top  = (rect.bottom + 8) + 'px';
    // Center horizontally on the button, keep within viewport
    const trayW = 260; // approximate width
    let left = rect.left + rect.width / 2 - trayW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - trayW - 8));
    tray.style.left = left + 'px';
    tray.style.display = 'flex';
  });

  document.addEventListener('click', (e) => {
    if (!tray.contains(e.target) && e.target !== trayBtn) {
      tray.style.display = 'none';
    }
  });

  tray.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-btn');
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    // Animate locally immediately
    spawnFloatingEmoji(emoji, sessionUserName);
    // Broadcast to room
    if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
      ws.send(JSON.stringify({ type: 'reaction', emoji, userName: sessionUserName }));
    }
    tray.style.display = 'none';
  });
})();

// ---- \u{1F310} WhatsApp Room Share ----
(function() {
  const btn = document.getElementById('btn-whatsapp-share');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!currentRoomId) return;
    const link = `${window.location.origin}/?join=${currentRoomId}`;
    const text = `\u{1F3AC} Join me on Vaanisethu to watch a movie together!\n\nRoom Code: *${currentRoomId}*\nJoin link: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  });
})();

// ---- \u{1F4CA} Watch History ----
async function loadWatchHistory() {
  const list = document.getElementById('history-list');
  if (!list || !currentUser) return;
  list.innerHTML = '<p style="color:#52525b;text-align:center;padding:3rem 0;">Loading...</p>';
  try {
    const res  = await fetch(`/api/my-watch-history?userId=${encodeURIComponent((currentUserDoc?.uid || currentUser?.uid))}`);
    const data = await res.json();
    if (!data.success || !data.history || data.history.length === 0) {
      list.innerHTML = '<p style="color:#52525b;text-align:center;padding:3rem 0;">No watch history yet. Watch a film to see it here!</p>';
      return;
    }
    list.innerHTML = '';
    data.history.forEach(item => {
      const d = new Date(item.watchedAt);
      const dateStr = d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        ${item.thumbnailBase64 ? `<img class="history-thumb" src="${item.thumbnailBase64}" alt="">` : '<div class="history-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;">\u{1F3AC}</div>'}
        <div class="history-info">
          <div class="history-title">${item.filmTitle || 'Unknown Film'}</div>
          <div class="history-date">Watched on ${dateStr}</div>
        </div>`;
      list.appendChild(div);
    });
  } catch(e) {
    list.innerHTML = '<p style="color:#ef4444;text-align:center;padding:3rem 0;">Failed to load history.</p>';
  }
}

// ---- Leaderboard ----
async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  try {
    const res  = await fetch('/api/leaderboard');
    const data = await res.json();
    if (!data.success || data.board.length === 0) {
      el.innerHTML = '<p style="color:#52525b;font-size:0.8rem;text-align:center;padding:1rem;">No data yet. Watch films to earn your spot!</p>';
      return;
    }
    const medals = ['\u{1F947}','\u{1F948}','\u{1F949}'];
    // Check if current user is admin
    const isAdminUser = currentUser && (currentUser.email === 'anubhabbhuyan01@gmail.com' || currentUserDoc?.isAdmin);
    el.innerHTML = '';
    data.board.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;transition:opacity 0.3s,transform 0.3s;';
      row.innerHTML = `
        <div class="lb-rank" style="min-width:2rem;">${medals[i] || (i + 1)}</div>
        <div class="lb-name" style="flex:1;">${entry.name}</div>
        <div class="lb-count">${entry.count} film${entry.count !== 1 ? 's' : ''}</div>
        ${isAdminUser ? `<button onclick="removeLbEntry(this,'${entry.uid}')" title="Remove from leaderboard" style="background:none;border:none;cursor:pointer;color:#71717a;font-size:1.1rem;padding:0.1rem 0.3rem;border-radius:0.3rem;line-height:1;transition:color 0.2s,background 0.2s;" onmouseover="this.style.color='#ef4444';this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.color='#71717a';this.style.background='none'">\u00D7</button>` : ''}`;
      el.appendChild(row);
    });
  } catch(e) {
    el.innerHTML = '<p style="color:#52525b;font-size:0.8rem;text-align:center;padding:1rem;">Could not load.</p>';
  }
}

window.removeLbEntry = async function(btn, targetUserId) {
  if (!currentUser) return;
  if (!confirm('Remove this user from the leaderboard this month?')) return;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await fetch('/api/remove-leaderboard-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: (currentUserDoc?.uid || currentUser?.uid), targetUserId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    // Animate row out
    const row = btn.closest('.lb-row');
    if (row) {
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      setTimeout(() => { row.remove(); showToast('\u2713 Removed from leaderboard', 'success', 2000); }, 300);
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '\u00D7';
    showToast('Failed: ' + e.message, 'error', 3000);
  }
};

// \u2500\u2500 Leaderboard: load whenever dashboard becomes visible \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
{
  const _dashEl = document.getElementById('dashboard-view');
  if (_dashEl) {
    new MutationObserver(() => {
      if (!_dashEl.classList.contains('hidden')) loadLeaderboard();
    }).observe(_dashEl, { attributes: true, attributeFilter: ['class'] });
  }
}


// ---- \u2B50 Film Star Ratings ----
window.rateFilm = async function(filmId, filmTitle, rating, starBar) {
  if (!currentUser) return;
  // Update stars visually immediately
  const stars = starBar.querySelectorAll('.film-star');
  stars.forEach((s, i) => s.classList.toggle('lit', i < rating));
  try {
    const res  = await fetch('/api/rate-film', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), filmId, filmTitle, rating })
    });
    const data = await res.json();
    if (data.success) {
      const avgEl = starBar.querySelector('.film-avg-rating');
      if (avgEl) avgEl.textContent = `\u2605 ${data.avg} (${data.count})`;
      showToast(`\u2B50 You rated this ${rating}/5`, 'success', 2000);
    }
  } catch(e) { /* silent */ }
};

// Build star rating bar for film cards
window.buildStarBar = function(filmId, filmTitle, avgRating, ratingCount) {
  const bar = document.createElement('div');
  bar.className = 'film-star-bar';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'film-star' + (i <= Math.round(avgRating || 0) ? ' lit' : '');
    s.textContent = '\u2605';
    s.title = `Rate ${i} star${i > 1 ? 's' : ''}`;
    s.onclick = () => window.rateFilm(filmId, filmTitle, i, bar);
    bar.appendChild(s);
  }
  const avg = document.createElement('span');
  avg.className = 'film-avg-rating';
  avg.textContent = avgRating ? `\u2605 ${Number(avgRating).toFixed(1)} (${ratingCount || 0})` : 'No ratings yet';
  bar.appendChild(avg);
  return bar;
};

// ---- \u{1F4CB} Log Watch History when a film starts playing ----
window.logWatchHistory = function(filmId, filmTitle, thumbnailBase64) {
  if (!currentUser || !filmId) return;
  fetch('/api/log-watch-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), filmId, filmTitle, thumbnailBase64: thumbnailBase64 || '' })
  }).catch(() => {});
};

// ---- \u{1F4E7} Priority Support Badge in contact form ----
(function() {
  const helpFab = document.getElementById('help-fab');
  if (!helpFab) return;
  helpFab._origTitle = helpFab.title;
  const origOnClick = helpFab.onclick;
  helpFab.addEventListener('click', () => {
    // Add premium badge to subject line if premium user
    const subjectEl = document.getElementById('contact-subject') || document.getElementById('contact-form');
    if (subjectEl && isFullPremiumUser()) {
      const marker = document.getElementById('premium-support-badge');
      if (!marker) {
        const badge = document.createElement('div');
        badge.id = 'premium-support-badge';
        badge.style.cssText = 'background:rgba(234,179,8,0.15);color:#eab308;border:1px solid rgba(234,179,8,0.4);border-radius:8px;padding:0.4rem 0.75rem;font-size:0.75rem;font-weight:800;margin-bottom:0.75rem;text-align:center;';
        badge.innerHTML = '\u2B50 Premium Member \u2014 Priority Support';
        subjectEl.prepend(badge);
      }
    }
  });
})();


// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// \u{1F4F1} PWA PUSH NOTIFICATIONS
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

let _swRegistration = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      _swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('[SW] Registered:', _swRegistration.scope);
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}

async function subscribeToPush(userId) {
  try {
    if (!('PushManager' in window) || !_swRegistration) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const res = await fetch('/api/push/vapid-key');
    if (!res.ok) return;
    const { publicKey } = await res.json();
    if (!publicKey) return;
    const subscription = await _swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, subscription })
    });
    console.log('[Push] Subscribed');
  } catch (err) {
    console.warn('[Push] Subscription failed:', err);
  }
}

// Auto-subscribe when dashboard-view becomes visible
const _dashObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes' && m.attributeName === 'class') {
      const el = m.target;
      if (el.id === 'dashboard-view' && !el.classList.contains('hidden')) {
        if (currentUser) setTimeout(() => subscribeToPush((currentUserDoc?.uid || currentUser?.uid)), 3500);
        _dashObserver.disconnect();
      }
    }
  }
});
const _dvPush = document.getElementById('dashboard-view');
if (_dvPush) _dashObserver.observe(_dvPush, { attributes: true });

// Admin: Send push notification button
document.getElementById('btn-send-push')?.addEventListener('click', async () => {
  const titleEl  = document.getElementById('push-notif-title');
  const bodyEl   = document.getElementById('push-notif-body');
  const urlEl    = document.getElementById('push-notif-url');
  const resultEl = document.getElementById('push-notif-result');
  const btn      = document.getElementById('btn-send-push');
  const title = titleEl?.value.trim();
  const body  = bodyEl?.value.trim();
  const url   = urlEl?.value.trim() || '/';
  if (!title || !body) {
    resultEl.textContent = 'Title and message are required.';
    resultEl.style.color = '#f87171'; resultEl.style.display = 'block'; return;
  }
  btn.textContent = 'Sending...'; btn.disabled = true;
  resultEl.style.display = 'none';
  try {
    const res = await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, title, body, url })
    });
    const data = await res.json();
    if (data.success) {
      resultEl.textContent = `Sent to ${data.sent} device${data.sent !== 1 ? 's' : ''}${data.failed ? ` (${data.failed} failed)` : ''}.`;
      resultEl.style.color = '#4ade80';
      titleEl.value = ''; bodyEl.value = ''; urlEl.value = '';
    } else {
      resultEl.textContent = data.error || 'Failed to send.';
      resultEl.style.color = '#f87171';
    }
  } catch(e) {
    resultEl.textContent = 'Network error. Try again.';
    resultEl.style.color = '#f87171';
  }
  resultEl.style.display = 'block';
  btn.textContent = 'Send to All Subscribers'; btn.disabled = false;
});

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// \u{1F4F1} MOBILE UI \u2014 Bottom Nav, Film Carousel, Profile Tab
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

(function initMobileUI() {

  // Only run on mobile widths
  function isMobile() { return window.matchMedia('(max-width: 640px)').matches; }

  // \u2500\u2500 Tab switching \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const SECTIONS = ['home','films','friends','profile'];
  function switchTab(tab) {
    if (!isMobile()) return;
    SECTIONS.forEach(s => {
      const sec = document.getElementById('mob-sec-' + s);
      const btn = document.querySelector('.mob-nav-btn[data-tab="' + s + '"]');
      if (sec) sec.classList.toggle('active', s === tab);
      if (btn) btn.classList.toggle('active', s === tab);
    });
    if (tab === 'films') buildMobCarousel();
    if (tab === 'friends') syncMobFriends();
    if (tab === 'profile') syncMobProfile();
  }

  document.querySelectorAll('.mob-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // "Add friend" button in friends tab \u2192 triggers existing modal
  document.getElementById('mob-btn-add-friend')?.addEventListener('click', () => {
    document.getElementById('btn-open-add-friend')?.click();
  });

  // Sign Out in profile tab
  document.getElementById('mob-btn-signout')?.addEventListener('click', () => {
    document.getElementById('btn-logout')?.click();
  });

  // \u2500\u2500 Mobile top bar username \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function updateMobUsername(rawName) {
    // Strip "Hi, " prefix that dashboard-user-name always has
    const name = (rawName || '').replace(/^Hi,\s*/i, '').trim() || window._mobCleanName || 'You';
    const el = document.getElementById('mob-username-display');
    const wn = document.getElementById('mob-welcome-name');
    if (el) el.textContent = name;
    if (wn) wn.textContent = name;
  }

  // Observer: when dashboard-user-name changes, sync to mobile bar
  const dashName = document.getElementById('dashboard-user-name');
  if (dashName) {
    const obs = new MutationObserver(() => updateMobUsername(dashName.textContent));
    obs.observe(dashName, { childList: true, characterData: true, subtree: true });
  }

  // \u2500\u2500 Profile tab sync \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function syncMobProfile() {
    // Name \u2014 use clean name stored at login time, not the "Hi, X" version
    const cleanName = window._mobCleanName || document.getElementById('mob-username-display')?.textContent || 'User';
    const profileName = document.getElementById('mob-profile-name-display');
    if (profileName) profileName.textContent = cleanName;

    // Avatar letter
    const letter = document.getElementById('mob-profile-avatar-letter');
    if (letter && !document.getElementById('mob-profile-avatar-img')?.src) {
      letter.textContent = cleanName[0].toUpperCase();
    }

    // Referral code = room code
    const roomCode = document.getElementById('my-room-code')?.textContent || '';
    const refEl = document.getElementById('mob-referral-code-val');
    if (refEl) refEl.textContent = roomCode;

    // Subscription status
    const plan = window._mobUserPlan || 'free';
    const subEl = document.getElementById('mob-sub-status');
    if (subEl) {
      const labels = { 'monthly': '\u2705 Monthly Active', 'weekly': '\u2705 Weekly Active', 'one-time': '\u2705 24Hr Active', 'ad-pass': 'Ad Pass', 'free': 'Free' };
      subEl.textContent = labels[plan] || plan;
    }

    // Badge
    const badge = document.getElementById('mob-profile-badge');
    if (badge) {
      if (plan === 'monthly') { badge.textContent = '\u{1F49C} Monthly Premium'; badge.style.background = 'rgba(168,85,247,0.15)'; badge.style.color = '#c084fc'; badge.style.borderColor = 'rgba(168,85,247,0.4)'; }
      else if (plan === 'weekly') { badge.textContent = '\u{1F7E0} Weekly Premium'; badge.style.background = 'rgba(249,115,22,0.15)'; badge.style.color = '#f97316'; badge.style.borderColor = 'rgba(249,115,22,0.4)'; }
      else if (plan === 'one-time') { badge.textContent = '\u23F1 24-Hour Pass'; badge.style.background = 'rgba(234,179,8,0.15)'; badge.style.color = '#eab308'; badge.style.borderColor = 'rgba(234,179,8,0.4)'; }
      else { badge.textContent = 'Free Plan'; badge.style.background = ''; badge.style.color = ''; badge.style.borderColor = ''; }
    }

    // Room name
    const rn = document.getElementById('mob-room-name-val');
    const roomNameDisplay = document.getElementById('room-name-display');
    if (rn) rn.textContent = roomNameDisplay?.textContent || 'My Room';

    // Page views \u2014 sync from existing public-visitor-count
    const pv = document.getElementById('public-visitor-count')?.textContent;
    const mobPv = document.getElementById('mob-page-views');
    if (mobPv && pv) mobPv.textContent = pv;
  }

  // Referral code tap \u2192 copy
  document.getElementById('mob-setting-referral')?.addEventListener('click', () => {
    const code = document.getElementById('mob-referral-code-val')?.textContent;
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        const el = document.getElementById('mob-referral-code-val');
        if (el) { const old = el.textContent; el.textContent = 'Copied!'; setTimeout(() => el.textContent = old, 1500); }
      }).catch(() => {});
    }
  });

  // Room name tap -> openMobRoomNameModal() (handled by onclick in HTML)
  // Old prompt() handler removed \u2014 custom modal used instead


  // Profile picture change
  document.getElementById('mob-profile-pic-input')?.addEventListener('change', function() {
    const file = this.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.getElementById('mob-profile-avatar-img');
      const letter = document.getElementById('mob-profile-avatar-letter');
      if (img) { img.src = e.target.result; img.style.display = 'block'; }
      if (letter) letter.style.display = 'none';
      // Save to localStorage for persistence
      try { localStorage.setItem('_vns_profile_pic', e.target.result); } catch(_) {}
    };
    reader.readAsDataURL(file);
  });

  // Restore saved profile pic \u2014 MOBILE ONLY
  if (window.matchMedia('(max-width: 640px)').matches) {
    const savedPic = localStorage.getItem('_vns_profile_pic');
    if (savedPic) {
      const img = document.getElementById('mob-profile-avatar-img');
      const letter = document.getElementById('mob-profile-avatar-letter');
      // Constrain: must stay inside the avatar circle, not go fullscreen
      if (img) {
        img.src = savedPic;
        img.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;';
      }
      if (letter) letter.style.display = 'none';
    }
  }

  // Notification toggle \u2192 manage push subscription
  document.getElementById('mob-notif-toggle')?.addEventListener('change', async function() {
    if (this.checked && currentUser) {
      await subscribeToPush((currentUserDoc?.uid || currentUser?.uid));
    }
  });

  // \u2500\u2500 Film Carousel (snap-scroll center focus) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  let _carouselBuilt = false;
  async function buildMobCarousel() {
    if (_carouselBuilt) return;
    const carousel = document.getElementById('mob-film-carousel');
    if (!carousel) return;

    if (!currentUser) {
      carousel.innerHTML = '<p style="color:#52525b;padding:2rem;text-align:center;">Sign in to see films</p>';
      return;
    }

    try {
      const res = await fetch('/api/films');
      if (!res.ok) throw new Error('Server error ' + res.status);
      const data = await res.json();

      // API returns { success: true, films: [...] } NOT a plain array
      const films = Array.isArray(data) ? data : (data.films || []);

      if (!films.length) {
        carousel.innerHTML = '<p style="color:#52525b;padding:2rem;text-align:center;">No films yet. Check back soon!</p>';
        return;
      }

      carousel.innerHTML = '';
      films.forEach((film, i) => {
        const item = document.createElement('div');
        item.className = 'mob-film-carousel-item' + (i === 0 ? ' snap-center' : '');
        item.dataset.filmid = film.filmId || film.id || '';

        // thumbnailBase64 is already a full data:image/...;base64,... string (same as film store uses)
        const poster = film.thumbnailBase64 || film.posterUrl || '';
        const price = film.rentalPrice != null ? film.rentalPrice : (film.price != null ? film.price : 20);
        const title = film.title || film.name || 'Untitled';
        const days  = film.rentalDays || 3;

        const posterEl = poster
          ? '<img class="mob-carousel-poster" src="' + poster + '" alt="' + title.replace(/"/g, '') + '" loading="lazy">'
          : '<div class="mob-carousel-poster" style="background:linear-gradient(135deg,#1a0a2e,#0f172a);display:flex;align-items:center;justify-content:center;font-size:2.5rem;">\u{1F3A5}</div>';

        item.innerHTML =
          posterEl +
          '<div class="mob-carousel-overlay">' +
            '<div class="mob-carousel-title">' + title + '</div>' +
            '<div style="font-size:0.7rem;color:rgba(255,255,255,0.6);">' + days + ' day rental \u00B7 \u20B9' + price + '</div>' +
          '</div>';

        // Tap -> open film store modal using the actual function
        item.addEventListener('click', () => {
          if (typeof openFilmStoreModal === 'function') {
            openFilmStoreModal();
          } else {
            const m = document.getElementById('film-store-modal');
            if (m) m.style.display = 'block';
          }
        });

        carousel.appendChild(item);
      });

      _carouselBuilt = true;
      initCarouselSnap(carousel);

    } catch(e) {
      console.error('[MobCarousel]', e);
      carousel.innerHTML = '<p style="color:#52525b;padding:2rem;text-align:center;cursor:pointer;">Could not load films. Tap to retry.</p>';
      carousel.onclick = () => { _carouselBuilt = false; carousel.onclick = null; buildMobCarousel(); };
    }
  }

  function initCarouselSnap(carousel) {
    const items = carousel.querySelectorAll('.mob-film-carousel-item');
    if (!items.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        entry.target.classList.toggle('snap-center', entry.isIntersecting && entry.intersectionRatio > 0.6);
      });
    }, {
      root: carousel,
      threshold: 0.6
    });

    items.forEach(item => observer.observe(item));
  }

  // \u2500\u2500 Friends Tab Sync \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function syncMobFriends() {
    const mainList = document.getElementById('friends-list');
    const mobList = document.getElementById('mob-friends-list');
    const mobEmpty = document.getElementById('mob-empty-friends');
    if (!mainList || !mobList) return;

    const items = mainList.querySelectorAll('.friend-item');
    if (!items.length) {
      if (mobEmpty) mobEmpty.style.display = 'block';
      return;
    }
    if (mobEmpty) mobEmpty.style.display = 'none';
    mobList.innerHTML = '';
    items.forEach(item => {
      const clone = item.cloneNode(true);
      mobList.appendChild(clone);
    });
  }

  // \u2500\u2500 Auto-init after dashboard loads \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const dvObs = new MutationObserver(() => {
    const dv = document.getElementById('dashboard-view');
    if (dv && !dv.classList.contains('hidden') && isMobile()) {
      switchTab('home');
      syncMobProfile();
      dvObs.disconnect();
    }
  });
  const dv = document.getElementById('dashboard-view');
  if (dv) dvObs.observe(dv, { attributes: true, attributeFilter: ['class'] });

  // Hook into onAuthStateChanged to store plan for profile tab
  const _origOnAuth = window._mobOnAuthHooked;
  if (!_origOnAuth) {
    window._mobOnAuthHooked = true;
    document.addEventListener('vaanisethu:userdata-loaded', (e) => {
      if (e.detail) window._mobUserPlan = e.detail.activeSubscription || 'free';
    });
  }


  // \u2500\u2500 Mobile Bottom Sheet helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  function closeMobSheet(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  async function openMobWatchHistory() {
    const sheet = document.getElementById('mob-watch-history-sheet');
    const list  = document.getElementById('mob-watch-history-list');
    if (!sheet || !list) return;
    sheet.style.display = 'block';
    list.innerHTML = '<p style="color:#52525b;text-align:center;padding:2rem 0;">Loading...</p>';
    try {
      const uid = currentUser?.uid;
      if (!uid) { list.innerHTML = '<p style="color:#ef4444;text-align:center;padding:1rem;">Sign in required.</p>'; return; }
      const res  = await fetch(`/api/my-watch-history?userId=${uid}`);
      const data = await res.json();
      const items = data.history || data.films || [];
      if (!items.length) { list.innerHTML = '<p style="color:#52525b;text-align:center;padding:2rem 0;">No watch history yet \u{1F3AC}</p>'; return; }
      list.innerHTML = items.map(h => {
        const dateStr = h.watchedAt ? new Date(h.watchedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '-';
        return `<div style="background:#1c1c1f;border-radius:0.75rem;padding:0.75rem 1rem;display:flex;align-items:center;gap:0.75rem;"><span style="font-size:1.5rem;">\u{1F3AC}</span><div style="flex:1;"><div style="color:white;font-weight:700;font-size:0.85rem;">${h.filmTitle || h.title || 'Unknown Film'}</div><div style="color:#71717a;font-size:0.72rem;">${dateStr}</div></div></div>`;
      }).join('');
    } catch(e) { list.innerHTML = '<p style="color:#ef4444;text-align:center;padding:1rem;">Could not load history.</p>'; }
  }

  async function openMobPurchaseHistory() {
    const sheet = document.getElementById('mob-purchase-history-sheet');
    const list  = document.getElementById('mob-purchase-history-list');
    if (!sheet || !list) return;
    sheet.style.display = 'block';
    list.innerHTML = '<p style="color:#52525b;text-align:center;padding:2rem 0;">Loading...</p>';
    try {
      const uid = currentUser?.uid;
      if (!uid) { list.innerHTML = '<p style="color:#ef4444;text-align:center;padding:1rem;">Sign in required.</p>'; return; }
      const res  = await fetch(`/api/my-purchases?userId=${uid}`);
      const data = await res.json();
      const items = data.purchases || [];
      if (!items.length) { list.innerHTML = '<p style="color:#52525b;text-align:center;padding:2rem 0;">No purchases yet \u{1F4B3}</p>'; return; }
      const planLabels = { 'one-time':'24-Hour Pass', 'weekly':'Weekly Pass', 'monthly':'Monthly Pass', 'access-code':'Access Code' };
      list.innerHTML = items.map(p => {
        const dateStr = p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '-';
        const amtStr  = p.amount ? `\u20B9${(p.amount/100).toFixed(0)}` : '-';
        const planStr = planLabels[p.plan] || p.plan || 'Unknown';
        return `<div style="background:#1c1c1f;border-radius:0.75rem;padding:0.75rem 1rem;"><div style="display:flex;justify-content:space-between;align-items:center;"><span style="color:white;font-weight:700;font-size:0.85rem;">${planStr}</span><span style="color:#f97316;font-weight:800;font-size:0.9rem;">${amtStr}</span></div><div style="color:#71717a;font-size:0.72rem;margin-top:0.2rem;">${dateStr}${p.referralBonusDays ? ` - +${p.referralBonusDays} bonus days applied` : ''}</div></div>`;
      }).join('');
    } catch(e) { list.innerHTML = '<p style="color:#ef4444;text-align:center;padding:1rem;">Could not load purchases.</p>'; }
  }

  function openMobRoomNameModal() {
    const modal = document.getElementById('mob-room-name-modal');
    const input = document.getElementById('mob-room-name-input');
    const msg   = document.getElementById('mob-room-name-msg');
    if (!modal || !input) return;
    const current = document.getElementById('mob-room-name-val')?.textContent || '';
    if (current && current !== 'Loading...') input.value = current;
    if (msg) msg.textContent = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 100);
  }

  document.getElementById('mob-room-name-save-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('mob-room-name-input');
    const msg   = document.getElementById('mob-room-name-msg');
    const name  = input?.value?.trim();
    if (!name) { if (msg) { msg.textContent = 'Please enter a name.'; msg.style.color = '#ef4444'; } return; }
    if (name.length > 30) { if (msg) { msg.textContent = 'Max 30 characters.'; msg.style.color = '#ef4444'; } return; }
    if (!currentUser) { if (msg) { msg.textContent = 'Not signed in.'; msg.style.color = '#ef4444'; } return; }
    if (msg) { msg.textContent = 'Saving...'; msg.style.color = '#71717a'; }
    try {
      // Use server API to update room name
      const res = await fetch('/api/update-room-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: (currentUserDoc?.uid || currentUser?.uid), roomName: name })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      const displayEl = document.getElementById('mob-room-name-val');
      if (displayEl) displayEl.textContent = name;
      const headerEl = document.getElementById('room-name-display');
      if (headerEl) headerEl.textContent = name;
      if (currentUserDoc) currentUserDoc.roomName = name;
      if (msg) { msg.textContent = '✔ Saved!'; msg.style.color = '#22c55e'; }
      setTimeout(() => closeMobSheet('mob-room-name-modal'), 900);
    } catch(e) {
      console.error('[RoomName]', e);
      if (msg) { msg.textContent = 'Save failed: ' + e.message; msg.style.color = '#ef4444'; }
    }
  });

  window.closeMobSheet          = closeMobSheet;
  window.openMobWatchHistory    = openMobWatchHistory;
  window.openMobPurchaseHistory = openMobPurchaseHistory;
  window.openMobRoomNameModal   = openMobRoomNameModal;
  window.openMobAdminPanel = function(section) {
    const adminView = document.getElementById('admin-view');
    const dashView    = document.getElementById('dashboard-view');
    const roomView    = document.getElementById('room-view');
    const paymentView = document.getElementById('payment-view');
    if (!adminView || !dashView) return;



    if (dashView)    dashView.classList.add('hidden');
    if (roomView)    roomView.classList.add('hidden');
    if (paymentView) paymentView.classList.add('hidden');
    adminView.classList.remove('hidden');

    if (typeof loadAdminLedger    === 'function') loadAdminLedger();
    if (typeof loadCodeUsers      === 'function') loadCodeUsers();
    if (typeof loadRentalLedger   === 'function') loadRentalLedger();
    if (typeof loadVisitorStats   === 'function') loadVisitorStats();
    if (typeof loadFreeDayStatus  === 'function') loadFreeDayStatus();
    if (typeof loadHelpDeskMessages === 'function') loadHelpDeskMessages();
    if (typeof loadAdminLeaderboard === 'function') loadAdminLeaderboard();

    setTimeout(() => {
      const sectionMap = {
        films:    'admin-film-section',
        users:    'admin-user-section',
        messages: 'admin-messages-section',
        leaderboard: 'admin-leaderboard-section'
      };
      const targetId = sectionMap[section];
      if (targetId) {
        const el = document.getElementById(targetId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 300);
  };

})();

// ---- Admin Help Desk Messages ----
window.loadHelpDeskMessages = async function() {
  if (!currentUser) return;
  const list = document.getElementById('admin-helpdesk-list');
  if (!list) return;
  list.innerHTML = '<p style="color:#71717a;font-size:0.875rem;">Loading messages...</p>';
  try {
    const res = await fetch('/api/admin/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: (currentUserDoc?.uid || currentUser?.uid) })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (data.messages.length === 0) {
      list.innerHTML = '<p style="color:#71717a;font-size:0.875rem;font-style:italic;">No messages found.</p>';
      return;
    }
    list.innerHTML = '';
    data.messages.forEach(msg => {
      const div = document.createElement('div');
      div.className = 'p-4 rounded border border-zinc-800 ' + (msg.read ? 'bg-zinc-900/40' : 'bg-zinc-800/80');
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;align-items:center;">
          <div>
            <span style="font-weight:bold;color:white;font-size:0.9rem;">${msg.name}</span>
            <span style="color:#a1a1aa;font-size:0.75rem;margin-left:0.5rem;">${msg.email}</span>
          </div>
          <span style="color:#71717a;font-size:0.7rem;">${new Date(msg.timestamp).toLocaleString()}</span>
        </div>
        <p style="color:#d4d4d8;font-size:0.85rem;margin:0 0 0.5rem 0;white-space:pre-wrap;">${msg.message}</p>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          ${msg.hasScreenshot ? '<span style="font-size:0.7rem;color:#f472b6;border:1px solid #f472b6;padding:2px 6px;border-radius:4px;">Has Screenshot (Check Email)</span>' : ''}
          ${!msg.read ? '<button onclick="markMsgRead(\'' + msg.id + '\', this)" class="btn btn-outline" style="font-size:0.7rem;padding:0.2rem 0.5rem;margin-left:auto;">Mark Read</button>' : '<span style="color:#22c55e;font-size:0.7rem;margin-left:auto;">\\u2713 Read</span>'}
        </div>
      `;
      list.appendChild(div);
    });
  } catch(e) {
    list.innerHTML = '<p style="color:#ef4444;font-size:0.875rem;">Failed to load messages: ' + e.message + '</p>';
  }
};

window.markMsgRead = async function(msgId, btn) {
  if (!currentUser) return;
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/messages/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: (currentUserDoc?.uid || currentUser?.uid), msgId })
    });
    if (res.ok) {
      btn.outerHTML = '<span style="color:#22c55e;font-size:0.7rem;margin-left:auto;">\\u2713 Read</span>';
      const lbl = document.getElementById('mob-admin-msg-label');
      if (lbl) {
        fetch('/api/unread-messages').then(r=>r.json()).then(d=>{
          lbl.textContent = d.count > 0 ? 'Help Desk Messages (' + d.count + ' new)' : 'Help Desk Messages';
        }).catch(()=>{});
      }
    }
  } catch(e) {
    btn.textContent = 'Failed';
  }
};

// ---- Admin Leaderboard Manager ----
window.loadAdminLeaderboard = async function() {
  const container = document.getElementById('admin-leaderboard-list');
  if (!container) return;
  container.innerHTML = '<p style="color:#71717a;font-size:0.875rem;">Loading leaderboard...</p>';
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    container.innerHTML = '';
    if (!data.success || !data.board || data.board.length === 0) {
      container.innerHTML = '<p style="color:#71717a;font-size:0.875rem;">No entries found this month.</p>';
      return;
    }
    data.board.forEach((entry, idx) => {
      const el = document.createElement('div');
      el.style.cssText = "display:flex;align-items:center;justify-content:space-between;background:#18181b;padding:0.75rem 1rem;border-radius:0.75rem;border:1px solid #27272a;";
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div style="width:24px;height:24px;border-radius:50%;background:#eab308;color:black;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:0.75rem;">${idx+1}</div>
          <span style="color:white;font-weight:600;font-size:0.9rem;">${entry.name}</span>
          <span style="color:#a1a1aa;font-size:0.8rem;">(${entry.count} films)</span>
        </div>
        <button onclick="removeLeaderboardEntry('${entry.uid}')" style="background:transparent;border:none;color:#ef4444;font-size:1.25rem;cursor:pointer;padding:0 0.5rem;" title="Remove Entry">×</button>
      `;
      container.appendChild(el);
    });
  } catch (err) {
    container.innerHTML = '<p style="color:#ef4444;font-size:0.875rem;">Failed to load leaderboard.</p>';
  }
};

window.removeLeaderboardEntry = async function(targetUserId) {
  if (!confirm('Are you sure you want to remove this user from the leaderboard for the month? This will delete their watch history for the current month.')) return;
  
  const container = document.getElementById('admin-leaderboard-list');
  if (container) container.style.opacity = '0.5';
  
  try {
    const adminEmail = currentUser?.email || '';
    const res = await fetch('/api/remove-leaderboard-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: (currentUserDoc?.uid || currentUser?.uid), targetUserId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    alert('User removed from leaderboard.');
    if (window.loadAdminLeaderboard) window.loadAdminLeaderboard();
  } catch(e) {
    alert('Failed to remove: ' + e.message);
  } finally {
    if (container) container.style.opacity = '1';
  }
};


// ================================================================
// ==== YOUTUBE-STYLE ROOM SUGGESTIONS ====
async function renderRoomSuggestions() {
  const container = document.getElementById('room-suggestions-container');
  const carousel  = document.getElementById('room-suggestions-carousel');
  const grid      = document.getElementById('room-suggestions-grid');
  if (!container) return;

  if (!window._allFilms || window._allFilms.length === 0) {
    try {
      const res = await fetch('/api/films');
      const data = await res.json();
      if (data.success && data.films && data.films.length > 0) {
        window._allFilms = data.films;
      } else {
        container.classList.add('hidden');
        return;
      }
    } catch(e) {
      container.classList.add('hidden');
      return;
    }
  }

  const films = window._allFilms.slice(0, 12);
  if (films.length === 0) { container.classList.add('hidden'); return; }

  const handleClick = () => {
    if (typeof openFilmStoreModal === 'function') {
      openFilmStoreModal();
      const modalGrid = document.getElementById('films-grid');
      if (modalGrid && modalGrid.innerHTML.trim() === '') loadFilmStore();
    }
  };

  // ── Mobile carousel cards ──────────────────────────────────
  if (carousel) {
    carousel.innerHTML = '';
    films.forEach(film => {
      const card = document.createElement('div');
      card.className = 'suggestion-card';
      card.onclick = handleClick;
      const img = film.thumbnailBase64
        ? `<img src="${film.thumbnailBase64}" alt="${film.title}" loading="lazy">`
        : `<div class="poster-placeholder">🎬</div>`;
      card.innerHTML = `${img}<div class="card-title">${film.title}</div>`;
      carousel.appendChild(card);
    });
  }

  // ── PC sidebar grid cards ──────────────────────────────────
  if (grid) {
    grid.innerHTML = '';
    films.forEach(film => {
      const card = document.createElement('div');
      card.className = 'suggestion-card-pc';
      card.onclick = handleClick;
      const img = film.thumbnailBase64
        ? `<img src="${film.thumbnailBase64}" alt="${film.title}" loading="lazy">`
        : `<div class="poster-placeholder">🎬</div>`;
      card.innerHTML = `
        ${img}
        <div class="pc-info">
          <div class="pc-title">${film.title}</div>
          <div class="pc-sub">Tap to Watch</div>
        </div>`;
      grid.appendChild(card);
    });
  }

  container.classList.remove('hidden');
}






