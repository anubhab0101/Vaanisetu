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

// Views
const authView = document.getElementById('auth-view');
const setupProfileView = document.getElementById('setup-profile-view');
const dashView = document.getElementById('dashboard-view');
const roomView = document.getElementById('room-view');

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
        setupProfileView.classList.add('hidden');
        
        listenToUserDoc();
        initWebSocket(true);

        // Process Deep Link
        const urlParams = new URLSearchParams(window.location.search);
        const joinCode = urlParams.get('join');
        if (joinCode) {
            window.history.replaceState({}, document.title, window.location.pathname);
            showRoom(joinCode.toUpperCase());
        } else {
            dashView.classList.remove('hidden');
        }
    } catch (e) {
        console.error(e);
        btnSaveProfile.textContent = "Error";
    }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        sessionUserId = user.uid;
        authView.classList.add('hidden');
        
        initWebSocket(true); // Sign into Presence Layer

        try {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                if (user.displayName) {
                    // Google Login provides a name, so auto-complete profile setup!
                    setupNameInput.value = user.displayName;
                    btnSaveProfile.click();
                } else {
                    setupProfileView.classList.remove('hidden');
                    dashView.classList.add('hidden');
                }
            } else if (!userSnap.data().displayName) {
                setupProfileView.classList.remove('hidden');
                dashView.classList.add('hidden');
            } else {
                currentUserDoc = userSnap.data();
                sessionUserName = currentUserDoc.displayName;
                if(dashboardUserName) dashboardUserName.textContent = `Hi, ${currentUserDoc.displayName}`;
                setupProfileView.classList.add('hidden');
                
                // Handle Deep Link Routing
                const urlParams = new URLSearchParams(window.location.search);
                const joinCode = urlParams.get('join');
                
                if (joinCode && !currentRoomId) {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    showRoom(joinCode.toUpperCase());
                } else if (!currentRoomId) {
                    dashView.classList.remove('hidden');
                }

                listenToUserDoc();
            }
        } catch (err) {
            console.error("Failed to load user profile:", err);
            authError.classList.remove('hidden', 'bg-green-900', 'text-green-500');
            authError.classList.add('bg-red-900', 'text-red-500');
            authError.textContent = "Database Error: " + err.message + " (Firebase Security Rules Need Update)";
            authView.classList.remove('hidden');
        }
    } else {
        currentUser = null;
        if (ws) { ws.close(); ws = null; currentRoomId = null; }
        roomView.classList.add('hidden'); dashView.classList.add('hidden'); setupProfileView.classList.add('hidden');
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
        }
    });

    // Refresh presence logic for friends periodically or if friends change
    if(ws && ws.readyState === WebSocket.OPEN && currentUserDoc && currentUserDoc.friends) {
        ws.send(JSON.stringify({ type: "subscribe-presence", friendIds: currentUserDoc.friends }));
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
  sessionUserName = currentUser?.displayName || 'Guest';
  currentRoomId = roomId;
  dashView.classList.add('hidden');
  roomView.classList.remove('hidden');
  roomIdDisplay.textContent = roomId;
  if(url) handleNewUrl(url, true);
  if(file) { currentVideoFile = file; handleNewUrl(URL.createObjectURL(file), false); }
  initWebSocket();
}

function leaveRoom() {
  currentRoomId = null;
  currentVideoUrl = null;
  currentVideoFile = null;
  mainVideo.src = "";
  playerWrapper.classList.add('hidden');
  sourceUi.classList.remove('hidden');
  if(waitingUi) waitingUi.classList.add('hidden');
  chatMessages.innerHTML = '';
  
  roomView.classList.add('hidden');
  dashView.classList.remove('hidden');
  
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
}

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
       } else if (!data.room.videoState.videoUrl) {
           currentVideoUrl = null;
           currentVideoFile = null;
           mainVideo.src = "";
           playerWrapper.classList.add('hidden');
           
           if(iAmOwner) {
               sourceUi.classList.remove('hidden');
               if(waitingUi) waitingUi.classList.add('hidden');
           } else {
               sourceUi.classList.add('hidden');
               if(waitingUi) {
                  waitingUi.classList.remove('hidden');
                  updateGuestWaitingUI();
               }
           }
       }
       mainVideo.currentTime = data.room.videoState.currentTime;
       if(data.room.videoState.isPlaying) mainVideo.play().catch(() => syncOverlay.classList.remove('hidden'));
    }

    if (data.type === "chat") appendMessage(data.message);
    if (data.type === "user-joined") {
       currentRoomUsers.add(data.userId);
       updateGuestWaitingUI();
       appendMessage({ senderName: "System", text: `${data.userName} joined the room`, isSystem: true });
    }

    if (data.type === "user-left") {
       currentRoomUsers.delete(data.userId);
       updateGuestWaitingUI();
       appendMessage({ senderName: "System", text: `A user left the room`, isSystem: true });
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
           } else {
               sourceUi.classList.add('hidden');
               if(waitingUi) {
                   waitingUi.classList.remove('hidden');
                   updateGuestWaitingUI();
               }
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
