import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, RecaptchaVerifier, signInWithPhoneNumber, signInWithPopup, sendPasswordResetEmail, onAuthStateChanged
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

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.replace('/');
  }
});

const authForm = document.getElementById('auth-form');

const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const btnForgotPwd = document.getElementById('btn-forgot-pwd');
const btnToggleAuth = document.getElementById('btn-toggle-auth');
const btnGoogleLogin = document.getElementById('btn-google-login');
const authTitle = document.getElementById('auth-title');
const authError = document.getElementById('auth-error');
const emailGroup = document.getElementById('auth-email').parentElement;
const btnPhoneLogin = document.getElementById('btn-phone-login');
const passwordGroup = document.getElementById('password-group');
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
  emailGroup.classList.remove('hidden');
    otpGroup.classList.add('hidden');
});

btnForgotPwd.addEventListener('click', () => {
  authMode = 'reset';
  authTitle.textContent = 'Reset Password';
  btnAuthSubmit.textContent = 'Send Reset Link';
  btnToggleAuth.textContent = 'Back to Login';
  passwordGroup.classList.add('hidden');
  authPassword.required = false;
  authError.classList.add('hidden');
  emailGroup.classList.remove('hidden');
    otpGroup.classList.add('hidden');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  emailGroup.classList.remove('hidden');
    otpGroup.classList.add('hidden');
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


