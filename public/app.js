import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, 
  onAuthStateChanged, updateProfile, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion, arrayRemove, query, collection, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const db = getFirestore(app, "ai-studio-d5fada93-c575-4056-a5ca-c8a98edf9c90");

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
// SPA NAVIGATION — History API
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

window.addEventListener('popstate', function(e) {
    if (_spaHandlingPop) return;
    _spaHandlingPop = true;
    try {
        const state = e.state;

        // 1. Film Store Modal open — close it on Back
        const filmModal = document.getElementById('film-store-modal');
        if (filmModal && filmModal.style.display !== 'none') {
            filmModal.style.display = 'none';
            // Repush current view since we "consumed" this back event
            history.pushState({ spaSite: true, view: _currentSpaView }, '', '/');
            _spaHandlingPop = false;
            return;
        }

        if (!state || !state.spaSite || state.view === 'auth' || state.view === 'init') {
            // Trying to go before the SPA started — block and stay
            history.pushState({ spaSite: true, view: _currentSpaView }, '', '/');
            _spaHandlingPop = false;
            return;
        }

        const targetView = state.view;

        // 2. Back from admin → show dashboard
        if (_currentSpaView === 'admin') {
            _currentSpaView = targetView;
            adminView.classList.add('hidden');
            checkAccessAndRoute();
            _spaHandlingPop = false;
            return;
        }

        // 3. Back from room → leave room gracefully
        if (_currentSpaView === 'room') {
            _currentSpaView = targetView;
            leaveRoom();
            _spaHandlingPop = false;
            return;
        }

        // 4. Back on dashboard/payment → stay (block leaving SPA)
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
        await signInWithPopup(auth, provider);
    } catch (error) {
        authError.classList.remove('hidden');
        authError.textContent = error.message.replace('Firebase:', '').trim();
    }
});

if(btnLogout) btnLogout.addEventListener('click', () => signOut(auth));

async function generateUniqueRoomCode() {
    let code = '';
    let isUnique = false;
    while (!isUnique) {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const q = query(collection(db, 'users'), where('roomCode', '==', code));
        const res = await getDocs(q);
        if (res.empty) isUnique = true;
    }
    return code;
}

btnSaveProfile.addEventListener('click', async () => {
    const name = setupNameInput.value.trim();
    if (!name) return;
    btnSaveProfile.textContent = "Saving...";
    try {
        await updateProfile(auth.currentUser, { displayName: name });
        const code = await generateUniqueRoomCode();
        
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
            uid: auth.currentUser.uid,
            email: auth.currentUser.email,
            displayName: name,
            roomCode: code,
            friends: [],
            friendRequests: []
        });

        sessionUserName = name;
        if(dashboardUserName) dashboardUserName.textContent = `Hi, ${name}`;

        // Register as a new unique visitor (server deduplicates with userId doc)
        fetch('/api/register-visitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: auth.currentUser.uid, displayName: name })
        }).catch(() => {}); // Non-blocking
        
        listenToUserDoc();
        initWebSocket(true);

        // Security fix: previously blindly routed to dashView/room, now routes via gatekeeper
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
        // ⚠️ DO NOT hide authView here — wait until we know which view to show
        // authView will be hidden inside the branches below to prevent black screen
        
        initWebSocket(true); // Sign into Presence Layer

        try {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
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
                authView.classList.add('hidden'); // hide auth only now
                setupProfileView.classList.add('hidden');
                
                if (user.email === 'anubhabmohapatra.01@gmail.com') {
                    btnAdminDash.classList.remove('hidden');
                } else {
                    btnAdminDash.classList.add('hidden');
                }

                // Register visitor for ALL users (server deduplicates by userId — no double count)
                fetch('/api/register-visitor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: user.uid, displayName: currentUserDoc.displayName })
                }).catch(() => {});

                checkAccessAndRoute();
                listenToUserDoc();
            }
        } catch (err) {
            console.error("Failed to load user profile:", err);
            authError.classList.remove('hidden', 'bg-green-900', 'text-green-500');
            authError.classList.add('bg-red-900', 'text-red-500');
            authError.textContent = "Database Error: " + err.message + " (Firebase Security Rules Need Update)";
            // authView stays visible so user can see the error
        }
    } else {
        currentUser = null;
        if (ws) { ws.close(); ws = null; currentRoomId = null; }
        roomView.classList.add('hidden'); dashView.classList.add('hidden'); setupProfileView.classList.add('hidden');
        paymentView.classList.add('hidden'); adminView.classList.add('hidden');
        authView.classList.remove('hidden'); authError.classList.add('hidden');
        authError.classList.remove('bg-green-900', 'text-green-500'); authError.classList.add('bg-red-900', 'text-red-500');
        if(unsubscribeDoc) unsubscribeDoc();
    }
});

// ==== FIRESTORE SYNC ====
function listenToUserDoc() {
    if(unsubscribeDoc) unsubscribeDoc();
    unsubscribeDoc = onSnapshot(doc(db, 'users', currentUser.uid), async (docSnap) => {
        if(docSnap.exists()){
            currentUserDoc = docSnap.data();
            document.getElementById('my-room-code').textContent = currentUserDoc.roomCode;
            
            renderFriendRequests(currentUserDoc.friendRequests || []);
            renderFriends(currentUserDoc.friends || []);
            
            // Unconditionally re-check access. If subscription expires while they are in app, they get kicked out.
            // If they are on the payment view and just got subbed, they are routed to dashboard.
            checkAccessAndRoute();
        }
    });

    // Refresh presence logic for friends periodically or if friends change
    if(ws && ws.readyState === WebSocket.OPEN && currentUserDoc && currentUserDoc.friends) {
        ws.send(JSON.stringify({ type: "subscribe-presence", friendIds: currentUserDoc.friends }));
    }
}

// ==== ACCESS GATEKEEPER & PAYMENTS ====
function hasValidAccess() {
    if (currentUser.email === 'anubhabmohapatra.01@gmail.com') return true;
    // Active subscription
    if (currentUserDoc && currentUserDoc.activeSubscription && currentUserDoc.subscriptionExpiry) {
        if (Date.now() < currentUserDoc.subscriptionExpiry) return true;
    }
    // First-time free pass (claim kiya hua, abhi valid hai)
    if (currentUserDoc && currentUserDoc.freePassActive && currentUserDoc.freePassExpiry) {
        if (Date.now() < currentUserDoc.freePassExpiry) return true;
    }
    return false;
}

function checkAccessAndRoute() {
    if (adminView && !adminView.classList.contains('hidden')) return; // let them stay in admin view

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
        // 🔧 FIX: IMMEDIATELY show payment view (no black screen)
        dashView.classList.add('hidden');
        roomView.classList.add('hidden');
        paymentView.classList.remove('hidden');
        currentGuestAccessRoom = null;
        if (!_spaHandlingPop) spaPushState('payment');
        showFreePassCardIfEligible();

        // THEN check if admin turned Free Day ON (async, updates if needed)
        getPlatformConfig().then(config => {
            if (config && config.freeDayActive) {
                // Free Day active — override payment wall
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
                userId: currentUser.uid, 
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
            // listenToUserDoc snapshot will pick up freePassActive and route to dashboard
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
                        userId: currentUser.uid,
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
                body: JSON.stringify({ code: code, userId: currentUser.uid })
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
                 <td style="padding: 0.85rem 1.5rem; color:#4ade80; font-weight:800; white-space:nowrap;">&#8377;${p.amount}</td>
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
                    <div style="font-weight:700;color:#c084fc;font-size:0.82rem;">🎦 ${r.filmTitle}</div>
                    <div style="font-size:0.65rem;color:#71717a;">${r.rentalDays} day rental</div>
                </td>
                <td style="padding:0.85rem 1.5rem;color:#4ade80;font-weight:800;white-space:nowrap;">&#8377;${r.amount}</td>
                <td style="padding:0.85rem 1.5rem;font-family:monospace;font-size:0.65rem;color:#52525b;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;" title="${r.paymentId}">${r.paymentId || '—'}</td>
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
        const q = query(collection(db, 'users'), where('roomCode', '==', code));
        const qt = await getDocs(q);
        if (qt.empty) {
            errEl.textContent = "User not found."; errEl.classList.remove('hidden'); return;
        }
        
        const targetUser = qt.docs[0];
        const targetData = targetUser.data();
        
        if ((targetData.friends && targetData.friends.includes(currentUser.uid)) ||
            (targetData.friendRequests && targetData.friendRequests.includes(currentUser.uid))) {
             errEl.textContent = "Already friends or request pending."; errEl.classList.remove('hidden'); return;
        }

        await updateDoc(doc(db, 'users', targetUser.id), {
            friendRequests: arrayUnion(currentUser.uid)
        });

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
        await updateDoc(doc(db, 'users', currentUser.uid), {
            friendRequests: arrayRemove(reqId), friends: arrayUnion(reqId)
        });
        await updateDoc(doc(db, 'users', reqId), { friends: arrayUnion(currentUser.uid) });
    } catch(e) { console.error("Error accepting", e); }
}

async function declineFriendRequest(reqId) {
    try {
        await updateDoc(doc(db, 'users', currentUser.uid), { friendRequests: arrayRemove(reqId) });
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
        const reqSnap = await getDoc(doc(db, 'users', reqId));
        if(!reqSnap.exists()) continue;
        const reqData = reqSnap.data();

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
           const fSnap = await getDoc(doc(db, 'users', fid));
           if(fSnap.exists()) {
               friend = fSnap.data(); friendCache.set(fid, friend);
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
             
             const fSnap = await getDoc(doc(db, 'users', fid));
             if (fSnap.exists()) {
                 const freshCode = fSnap.data().roomCode;
                 if (freshCode !== friend.roomCode) {
                     div.querySelector('.friend-code').innerHTML = `<span class="text-red-500 font-bold">Invalid</span> (Tap Reload ⟳)`;
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
}

function leaveRoom() {
  if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
      ws.send(JSON.stringify({ type: "leave", roomId: currentRoomId }));
  }
  currentRoomId = null;
  currentVideoUrl = null;
  currentVideoFile = null;
  mainVideo.src = "";
  playerWrapper.classList.add('hidden');
  sourceUi.classList.remove('hidden');
  if(waitingUi) waitingUi.classList.add('hidden');
  chatMessages.innerHTML = '';
  
  roomView.classList.add('hidden');
  
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
  mainVideo.src = formattedUrl;
  settingsModal.classList.add('hidden');

  // Video loaded - ALWAYS show chat FAB for everyone
  if (btnChatFab) btnChatFab.style.display = 'flex';
  const fabContainer = document.getElementById('chat-fab-container');
  if (fabContainer) fabContainer.style.display = 'flex';

  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "sync", action: "update-url", videoUrl: formattedUrl, time: 0, timestamp: Date.now() }));
  }
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
  } else {
    srcStepTitle.textContent = 'LOCAL FILE';
    localGroup.classList.remove('hidden');
  }
}

document.getElementById('btn-src-dropbox')?.addEventListener('click', () => openSourceStep('dropbox'));
document.getElementById('btn-src-telegram')?.addEventListener('click', () => openSourceStep('telegram'));
document.getElementById('btn-src-local')?.addEventListener('click', () => openSourceStep('local'));

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
  if(isUpdating || !ws) return;
  ws.send(JSON.stringify({ type: "sync", action, time: mainVideo.currentTime, timestamp: Date.now() }));
};

async function updateGuestWaitingUI() {
    if (!waitingUi || waitingUi.classList.contains('hidden')) return;
    
    if (!currentRoomOwnerUid) {
        try {
           const q = query(collection(db, "users"), where("roomCode", "==", currentRoomId));
           const snaps = await getDocs(q);
           if (!snaps.empty) currentRoomOwnerUid = snaps.docs[0].id;
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
    settingsModal.classList.add('hidden');
    
    // Clear chats
    chatMessages.innerHTML = '';
    
    if (ws && ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify({ type: "sync", action: "remove-video", time: 0, timestamp: Date.now() }));
    }
});

btnSyncPlayback.addEventListener('click', () => {
   isUpdating = true; mainVideo.play().catch(console.error);
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
           // Video chal raha hai — chat FAB sabko dikhao
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
           playerWrapper.classList.add('hidden');
           
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

       if (data.action === "play" && mainVideo.paused) {
           mainVideo.play().catch(() => { syncOverlay.classList.remove('hidden'); mainVideo.pause(); isUpdating = false; });
       } else if (data.action === "pause" && !mainVideo.paused) mainVideo.pause();

       if (Math.abs(mainVideo.currentTime - targetTime) > 0.5) mainVideo.currentTime = targetTime;
       setTimeout(() => { isUpdating = false; }, 500);
    }
  };
}

setInterval(() => { fetch('/ping').catch(() => {}); }, 2 * 60 * 1000);

// ================================================================
// ==== FILM STORE — SHARED STATE ====
// ================================================================
let filmStoreData = [];

// ================================================================
// ==== FILM STORE — UTILITY FUNCTIONS ====
// ================================================================

// Compress image to max 600px wide, JPEG quality 0.75 → returns base64
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
// ==== FILM STORE — USER MODAL ====
// ================================================================

window.switchFilmTab = function(tab) {
  const browsePanel = document.getElementById('film-tab-browse');
  const rentalsPanel = document.getElementById('film-tab-rentals');
  const browseBtnEl = document.getElementById('tab-btn-browse');
  const rentalsBtnEl = document.getElementById('tab-btn-rentals');
  if (tab === 'browse') {
    browsePanel.classList.remove('hidden');
    rentalsPanel.classList.add('hidden');
    browseBtnEl.classList.add('active');
    rentalsBtnEl.classList.remove('active');
    loadFilmStore();
  } else {
    browsePanel.classList.add('hidden');
    rentalsPanel.classList.remove('hidden');
    browseBtnEl.classList.remove('active');
    rentalsBtnEl.classList.add('active');
    loadMyRentals();
  }
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
    const res = await fetch('/api/films');
    const data = await res.json();
    if (!data.success || !data.films || data.films.length === 0) {
      grid.innerHTML = '<div class="text-zinc-500 text-center py-12 col-span-full"><svg class="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 2h10l4 4v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg><p class="font-bold">No films available yet.</p><p class="text-sm mt-1">Check back soon!</p></div>';
      return;
    }
    filmStoreData = data.films;
    grid.innerHTML = '';
    data.films.forEach(film => grid.appendChild(buildFilmCard(film)));
  } catch (e) {
    grid.innerHTML = `<div class="text-red-400 text-center py-12 col-span-full">Error loading films: ${e.message}</div>`;
  }
}

function buildFilmCard(film) {
  const card = document.createElement('div');
  card.className = 'film-card';
  card.innerHTML = `
    <div class="film-card-poster">
      ${film.thumbnailBase64
        ? `<img src="${film.thumbnailBase64}" alt="${film.title}" style="width:100%;height:100%;object-fit:cover;">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#52525b;font-size:2rem;">🎬</div>`}
    </div>
    <div class="film-card-body">
      <h3 class="film-card-title">${film.title}</h3>
      <div class="film-card-meta">
        <span class="film-card-price">₹${film.price}</span>
        <span class="film-card-days">${film.rentalDays} day${film.rentalDays > 1 ? 's' : ''}</span>
      </div>
      <button class="btn film-rent-btn" data-filmid="${film.filmId}" data-title="${film.title.replace(/"/g, '&quot;')}" data-price="${film.price}" data-days="${film.rentalDays}">
        Rent for ${film.rentalDays} Day${film.rentalDays > 1 ? 's' : ''} — ₹${film.price}
      </button>
    </div>
  `;
  card.querySelector('.film-rent-btn').addEventListener('click', () => {
    initiateFilmRental(film.filmId, film.title, film.price, film.rentalDays);
  });
  return card;
}

async function initiateFilmRental(filmId, filmTitle, price, rentalDays) {
  if (!currentUser) { showCustomAlert('Login Required', 'Please login to rent films.'); return; }
  try {
    const res = await fetch('/api/rent-film', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.uid, filmId })
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
            userId: currentUser.uid,
            filmId
          })
        });
        const vData = await verifyRes.json();
        if (vData.success) {
          showCustomAlert('🎬 Rental Activated!', `"${filmTitle}" is now available for ${rentalDays} days. Go to My Rentals to watch!`);
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
    const res = await fetch(`/api/my-rentals?userId=${currentUser.uid}`);
    const data = await res.json();
    if (!data.success || !data.rentals || data.rentals.length === 0) {
      grid.innerHTML = '<div class="text-zinc-500 text-center py-12 col-span-full"><svg class="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg><p class="font-bold">No rentals yet.</p><p class="text-sm mt-1">Browse films and rent one!</p></div>';
      return;
    }
    grid.innerHTML = '';
    data.rentals.forEach(rental => grid.appendChild(buildRentalCard(rental)));
  } catch (e) {
    grid.innerHTML = `<div class="text-red-400 text-center py-12 col-span-full">Error loading rentals: ${e.message}</div>`;
  }
}

function buildRentalCard(rental) {
  const card = document.createElement('div');
  card.className = 'film-card' + (rental.isExpired ? ' film-card-expired' : '');
  const timeLeft = rental.isExpired ? 'Expired' : formatTimeRemaining(rental.expiresAt);
  card.innerHTML = `
    <div class="film-card-poster">
      ${rental.thumbnailBase64
        ? `<img src="${rental.thumbnailBase64}" alt="${rental.filmTitle}" style="width:100%;height:100%;object-fit:cover;">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#52525b;font-size:2rem;">🎬</div>`}
      ${rental.isExpired ? '<div class="film-expired-badge">EXPIRED</div>' : ''}
    </div>
    <div class="film-card-body">
      <h3 class="film-card-title">${rental.filmTitle}</h3>
      <div class="film-rental-timer ${rental.isExpired ? 'expired' : ''}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${timeLeft}
      </div>
      ${!rental.isExpired
        ? `<button class="btn film-play-btn" data-link="${rental.telegramLink || ''}" data-title="${rental.filmTitle.replace(/"/g, '&quot;')}">▶ Play Now</button>`
        : `<button class="btn film-play-btn disabled" disabled>Access Expired</button>`}
    </div>
  `;
  if (!rental.isExpired) {
    card.querySelector('.film-play-btn').addEventListener('click', () => {
      playRentedFilm(rental.telegramLink, rental.filmTitle);
    });
  }
  return card;
}

function playRentedFilm(link, title) {
  if (!link) { showCustomAlert('Error', 'Stream link not available.'); return; }
  // Close the store modal
  document.getElementById('film-store-modal').style.display = 'none';
  // Play the film using existing room infrastructure
  const formatted = formatVideoUrl(link);
  handleNewUrl(formatted, true);
}

// ================================================================
// ==== FILM STORE — ADMIN FUNCTIONS ====
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
    labelText.textContent = '✓ Poster ready — click to change';
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
  const title = document.getElementById('film-form-title').value.trim();
  const link = document.getElementById('film-form-link').value.trim();
  const price = document.getElementById('film-form-price').value;
  const days = document.getElementById('film-form-days').value;
  const msgEl = document.getElementById('film-form-msg');
  const btn = document.getElementById('btn-admin-add-film');

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
        rentalDays: parseInt(days) || 3
      })
    });
    const data = await res.json();
    if (data.success) {
      msgEl.textContent = '✓ Film added successfully!';
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
  const title = document.getElementById('film-form-title').value.trim();
  const link = document.getElementById('film-form-link').value.trim();
  const price = document.getElementById('film-form-price').value;
  const days = document.getElementById('film-form-days').value;
  const msgEl = document.getElementById('film-form-msg');
  const btn = document.getElementById('btn-admin-add-film');

  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    const body = { adminEmail: currentUser.email, filmId, title, telegramLink: link, price: parseFloat(price) || 20, rentalDays: parseInt(days) || 3 };
    if (adminFilmThumbBase64) body.thumbnailBase64 = adminFilmThumbBase64;
    const res = await fetch('/api/admin/update-film', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) {
      msgEl.textContent = '✓ Film updated!'; msgEl.style.color = '#22c55e'; msgEl.style.display = 'block';
      resetFilmForm(); loadAdminFilms();
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
  document.getElementById('film-form-heading').textContent = 'Edit Film';
  document.getElementById('btn-admin-add-film').textContent = 'Save Changes';
  document.getElementById('btn-admin-cancel-edit').style.display = 'block';
  if (film.thumbnailBase64) {
    const preview = document.getElementById('film-thumb-preview');
    preview.src = film.thumbnailBase64; preview.style.display = 'block';
    document.getElementById('film-thumb-label-text').textContent = '✓ Existing poster — click to change';
    adminFilmThumbBase64 = film.thumbnailBase64;
  }
  // Scroll to form
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
          ${film.thumbnailBase64 ? `<img src="${film.thumbnailBase64}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#27272a;border-radius:8px;font-size:1.25rem;">🎬</div>'}
        </div>
        <div class="admin-film-row-info">
          <div class="admin-film-row-title">${film.title}</div>
          <div class="admin-film-row-meta">₹${film.price} · ${film.rentalDays} day${film.rentalDays > 1 ? 's' : ''} · <span style="color:${film.isActive ? '#22c55e' : '#ef4444'}">${film.isActive ? 'Active' : 'Hidden'}</span></div>
          <div class="admin-film-row-link" title="${film.telegramLink || ''}">${(film.telegramLink || '').substring(0, 50)}${(film.telegramLink || '').length > 50 ? '…' : ''}</div>
        </div>
        <div class="admin-film-row-actions">
          <button class="btn-edit-film btn btn-secondary" style="padding:0.4rem 0.75rem;font-size:0.75rem;min-height:auto;width:auto;">Edit</button>
          <button class="btn-toggle-film btn btn-outline" style="padding:0.4rem 0.75rem;font-size:0.75rem;min-height:auto;width:auto;">${film.isActive ? 'Hide' : 'Show'}</button>
          <button class="btn-delete-film btn" style="padding:0.4rem 0.75rem;font-size:0.75rem;min-height:auto;width:auto;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid #ef4444;">Delete</button>
        </div>
      `;
      row.querySelector('.btn-edit-film').onclick = () => startEditFilm(film);
      row.querySelector('.btn-delete-film').onclick = (e) => deleteFilm(film.filmId, e.currentTarget);
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
// WINDOW EXPORTS — expose functions used by HTML onclick="" attributes
// (required because app.js is type="module" — module scope ≠ global scope)
// =====================================================================
window.loadRentalLedger = loadRentalLedger;
window.loadCodeUsers    = loadCodeUsers;

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
        el.textContent = '—';
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
        if (label) label.textContent = data.freeDayActive ? '🟢 Free Day: ON (all users have free access)' : '🔴 Free Day: OFF (normal access rules apply)';
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
                ? '🟢 Free Day: ON (all users have free access)' 
                : '🔴 Free Day: OFF (normal access rules apply)';
        } else {
            toggle.checked = !newState; // Revert
            alert('Error: ' + data.error);
        }
    } catch(e) {
        toggle.checked = !newState; // Revert
        alert('Network error. Try again.');
    }
};
