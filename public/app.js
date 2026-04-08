import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, 
  onAuthStateChanged, updateProfile, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

// Global session initialized from Auth
let sessionUserId = Math.random().toString(36).substring(2, 10); // Fallback
let sessionUserName = "Guest";
let currentUser = null;

// State
let currentRoomId = null;
let currentVideoUrl = null;
let currentVideoFile = null;
let isUpdating = false;
let ws = null;

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

const usernameInput = document.getElementById('username-input');

// Dashboard Elements
const inputCreateUrl = document.getElementById('create-url-input');
const btnCreate = document.getElementById('btn-create');
const fileUpload = document.getElementById('file-upload');
const btnUpload = document.getElementById('btn-upload');
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

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// Settings Elements
const settingsModal = document.getElementById('settings-modal');
const btnPlayerSettings = document.getElementById('btn-player-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsUrlInput = document.getElementById('settings-url-input');
const btnApplySettings = document.getElementById('btn-apply-settings');

// ==== AUTH LOGIC ====
let authMode = 'login'; // login, register, reset

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

btnSaveProfile.addEventListener('click', async () => {
    const name = setupNameInput.value.trim();
    if (!name) return;
    btnSaveProfile.textContent = "Saving...";
    try {
        await updateProfile(auth.currentUser, { displayName: name });
        sessionUserName = name;
        if(dashboardUserName) dashboardUserName.textContent = `Hi, ${name}`;
        setupProfileView.classList.add('hidden');
        dashView.classList.remove('hidden');
    } catch (e) {
        console.error(e);
        btnSaveProfile.textContent = "Error";
    }
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        sessionUserId = user.uid;
        authView.classList.add('hidden');
        
        if (!user.displayName) {
            setupProfileView.classList.remove('hidden');
            dashView.classList.add('hidden');
        } else {
            sessionUserName = user.displayName;
            if(dashboardUserName) dashboardUserName.textContent = `Hi, ${user.displayName}`;
            setupProfileView.classList.add('hidden');
            if (!currentRoomId) {
                 dashView.classList.remove('hidden');
            }
        }
    } else {
        currentUser = null;
        if (ws) { ws.close(); ws = null; currentRoomId = null; }
        roomView.classList.add('hidden');
        dashView.classList.add('hidden');
        setupProfileView.classList.add('hidden');
        authView.classList.remove('hidden');
        authError.classList.add('hidden');
        // Reset password UI
        authError.classList.remove('bg-green-900', 'text-green-500');
        authError.classList.add('bg-red-900', 'text-red-500');
    }
});
// ==== END AUTH LOGIC ====

// Format Time helper
const formatTime = (time) => {
  if (isNaN(time)) return "0:00";
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

if(usernameInput) {
  usernameInput.addEventListener('input', (e) => {
    sessionUserName = e.target.value.trim() || 'Guest';
  });
}

const generateKey = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const formatVideoUrl = (url) => {
  let formattedUrl = url.trim();
  if (formattedUrl.includes('dropbox.com')) {
    try {
       const urlObj = new URL(formattedUrl);
       urlObj.hostname = 'dl.dropboxusercontent.com';
       urlObj.searchParams.delete('dl');
       return urlObj.toString();
    } catch(e) { }
  }
  return formattedUrl;
};

// Switch Views
function showRoom(roomId, url = null, file = null) {
  sessionUserName = currentUser?.displayName || 'Guest';
  currentRoomId = roomId;
  dashView.classList.add('hidden');
  roomView.classList.remove('hidden');
  roomIdDisplay.textContent = roomId;
  if(url) handleNewUrl(url, true);
  if(file) {
     currentVideoFile = file;
     handleNewUrl(URL.createObjectURL(file), false);
  }
  initWebSocket();
}

function leaveRoom() {
  currentRoomId = null;
  currentVideoUrl = null;
  currentVideoFile = null;
  if(ws) { ws.close(); ws = null; }
  mainVideo.src = "";
  playerWrapper.classList.add('hidden');
  sourceUi.classList.remove('hidden');
  chatMessages.innerHTML = '';
  
  roomView.classList.add('hidden');
  dashView.classList.remove('hidden');
}

// Actions
inputCreateUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnCreate.click();
});

btnCreate.addEventListener('click', () => {
  const url = inputCreateUrl.value.trim();
  showRoom(generateKey(), url ? formatVideoUrl(url) : null);
});

btnUpload.addEventListener('click', () => fileUpload.click());
fileUpload.addEventListener('change', (e) => {
  if(e.target.files && e.target.files[0]) {
    showRoom(generateKey(), null, e.target.files[0]);
  }
});

inputJoinKey.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

btnJoin.addEventListener('click', () => {
  const key = inputJoinKey.value.trim().toUpperCase();
  if(key) showRoom(key);
});

btnLeave.addEventListener('click', leaveRoom);

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoomId);
  btnCopy.textContent = "Copied!";
  btnCopy.classList.add('text-orange');
  setTimeout(() => { btnCopy.textContent = "Copy"; btnCopy.classList.remove('text-orange'); }, 2000);
});

btnChatFab.addEventListener('click', () => {
  chatPopup.classList.remove('closed');
  unreadCount = 0;
  chatBadge.classList.add('hidden');
  chatBadge.textContent = '0';
  chatNotification.classList.remove('show');
});

btnCloseSidebar.addEventListener('click', () => {
  chatPopup.classList.add('closed');
});

// Video Sourced
function handleNewUrl(formattedUrl, broadcast = false) {
  currentVideoUrl = formattedUrl;
  sourceUi.classList.add('hidden');
  playerWrapper.classList.remove('hidden');
  mainVideo.src = formattedUrl;
  settingsModal.classList.add('hidden');

  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "sync",
      action: "update-url",
      videoUrl: formattedUrl,
      time: 0,
      timestamp: Date.now()
    }));
  }
}

roomUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim() !== '') {
    handleNewUrl(formatVideoUrl(e.target.value), true);
  }
});

roomFileUpload.addEventListener('change', (e) => {
   if(e.target.files && e.target.files[0]) {
     currentVideoFile = e.target.files[0];
     handleNewUrl(URL.createObjectURL(e.target.files[0]), false);
   }
});

// Chat
function appendMessage(msg) {
   const isSelf = msg.senderId === sessionUserId;
   const msgDiv = document.createElement('div');
   msgDiv.className = `msg-bubble ${isSelf ? 'msg-self' : 'msg-other'}`;
   
   const nameSpan = document.createElement('span');
   nameSpan.className = 'msg-name';
   nameSpan.textContent = msg.senderName;

   const textSpan = document.createElement('div');
   textSpan.className = 'msg-text';
   textSpan.textContent = msg.text;

   msgDiv.appendChild(nameSpan);
   msgDiv.appendChild(textSpan);
   chatMessages.appendChild(msgDiv);
   chatMessages.scrollTop = chatMessages.scrollHeight;

   if (!isSelf && chatPopup.classList.contains('closed')) {
     unreadCount++;
     chatBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
     chatBadge.classList.remove('hidden');

     notifName.textContent = msg.senderName + ':';
     notifText.textContent = msg.text;
     chatNotification.classList.add('show');
     
     if (notifTimeout) clearTimeout(notifTimeout);
     notifTimeout = setTimeout(() => {
       chatNotification.classList.remove('show');
     }, 3000);
   }
}

function appendSystemMessage(text) {
   const msgDiv = document.createElement('div');
   msgDiv.className = 'msg-system';
   msgDiv.textContent = text;
   chatMessages.appendChild(msgDiv);
   chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if(!text || !ws) return;

  ws.send(JSON.stringify({
    type: "chat",
    text: text,
    userName: sessionUserName
  }));
  chatInput.value = '';
});

// Video Sync & Custom Player Events 

const sendVideoState = (action) => {
  if(isUpdating || !ws) return;
  ws.send(JSON.stringify({
     type: "sync", action: action,
     time: mainVideo.currentTime,
     timestamp: Date.now()
  }));
};

// Native Video Sync Events
mainVideo.addEventListener('play', () => sendVideoState('play'));
mainVideo.addEventListener('pause', () => sendVideoState('pause'));
mainVideo.addEventListener('seeked', () => sendVideoState('seek'));

// Settings Modal
btnPlayerSettings.addEventListener('click', () => {
  settingsUrlInput.value = currentVideoFile ? '(Local File active)' : (currentVideoUrl || '');
  settingsModal.classList.remove('hidden');
});
btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

btnApplySettings.addEventListener('click', () => {
  const url = settingsUrlInput.value.trim();
  if (url && url !== '(Local File active)') {
    handleNewUrl(formatVideoUrl(url), true);
  } else {
    settingsModal.classList.add('hidden');
  }
});

btnSyncPlayback.addEventListener('click', () => {
   isUpdating = true;
   mainVideo.play().catch(console.error);
   if(ws) ws.send(JSON.stringify({ type: "request-sync" }));
   syncOverlay.classList.add('hidden');
   setTimeout(() => { isUpdating = false; }, 500);
});

// WebSockets
let reconnectTimeout = null;

function initWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
  
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    if (reconnectTimeout) {
       clearTimeout(reconnectTimeout);
       reconnectTimeout = null;
    }
    ws.send(JSON.stringify({
      type: "join", roomId: currentRoomId,
      userId: sessionUserId, userName: sessionUserName,
      videoUrl: currentVideoFile ? null : currentVideoUrl
    }));
  };
  
  ws.onclose = () => {
    // Reconnect logic in case of network drop on Render
    if (currentRoomId) {
       reconnectTimeout = setTimeout(initWebSocket, 3000);
    }
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "room-state") {
       roomNameDisplay.textContent = data.room.name;
       data.room.messages.forEach(appendMessage);

       if (data.room.videoState.videoUrl && !currentVideoFile) {
           handleNewUrl(data.room.videoState.videoUrl, false);
       }
       
       mainVideo.currentTime = data.room.videoState.currentTime;
       if(data.room.videoState.isPlaying) {
          mainVideo.play().catch(() => syncOverlay.classList.remove('hidden'));
       }
    }

    if (data.type === "chat") {
       appendMessage(data.message);
    }

    if (data.type === "user-joined") {
       appendSystemMessage(`${data.userName} joined the room`);
    }

    if (data.type === "room-updated") {
       roomNameDisplay.textContent = data.name;
    }

    if (data.type === "sync") {
       if (data.videoUrl && data.videoUrl !== currentVideoUrl && !currentVideoFile) {
          handleNewUrl(data.videoUrl, false);
       }

       isUpdating = true;
       const latency = data.timestamp ? Math.max(0, Math.min((Date.now() - data.timestamp) / 1000, 2)) : 0;
       const targetTime = data.time + (data.action === "play" ? latency : 0);

       if (data.action === "play" && mainVideo.paused) {
           mainVideo.play().catch(() => {
              syncOverlay.classList.remove('hidden');
              mainVideo.pause();
              isUpdating = false;
           });
       } else if (data.action === "pause" && !mainVideo.paused) {
           mainVideo.pause();
       }

       if (Math.abs(mainVideo.currentTime - targetTime) > 0.5) {
           mainVideo.currentTime = targetTime;
       }
       setTimeout(() => { isUpdating = false; }, 500);
    }
  };
}

// Keep Render server awake by pinging it every 2 minutes with an HTTP request
setInterval(() => {
  fetch('/ping').catch(() => {});
}, 2 * 60 * 1000);
