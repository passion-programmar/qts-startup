// Runs in an extension-origin frame so the host page cannot observe the
// credentials typed here. Success is published through extension storage,
// which the page launcher watches to close this frame.

const form = document.querySelector('form');
const userInput = document.getElementById('login-user');
const passwordInput = document.getElementById('login-password');
const errorMessage = document.querySelector('.error');
const errorText = errorMessage.querySelector('.error-text');
const submitButton = form.querySelector('button[type="submit"]');
const submitLabel = submitButton.querySelector('.submit-label');
const revealButton = document.querySelector('.reveal');
const capsNote = document.querySelector('.caps');
let loginInFlight = false;

function showError(message) {
  errorText.textContent = message;
  errorMessage.hidden = false;
}

function setLoading(loading) {
  userInput.disabled = loading;
  passwordInput.disabled = loading;
  revealButton.disabled = loading;
  submitButton.disabled = loading;
  submitButton.classList.toggle('loading', loading);
  submitLabel.textContent = loading ? 'Signing in…' : 'Sign in';
}

async function submitSignIn() {
  const loginName = userInput.value.trim();
  const password = passwordInput.value;
  if (!loginName || !password || loginInFlight) return;
  loginInFlight = true;
  setLoading(true);
  errorMessage.hidden = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'QTS_PAGE_ACTION',
      action: 'sign_in',
      loginName,
      password,
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not sign in.');
    passwordInput.value = '';
  } catch (error) {
    showError(error?.message || 'Could not sign in.');
  } finally {
    loginInFlight = false;
    setLoading(false);
    if (!errorMessage.hidden) passwordInput.select();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!userInput.value.trim() || !passwordInput.value) {
    showError('Enter your User Name and Password.');
    (userInput.value.trim() ? passwordInput : userInput).focus();
    return;
  }
  submitSignIn();
});
userInput.addEventListener('change', submitSignIn);
passwordInput.addEventListener('change', submitSignIn);
// Typing again clears an earlier error.
for (const input of [userInput, passwordInput]) {
  input.addEventListener('input', () => { errorMessage.hidden = true; });
}
// The eye shows the password as typed; focus stays in the box.
revealButton.addEventListener('mousedown', (event) => event.preventDefault());
revealButton.addEventListener('click', () => {
  const shown = passwordInput.type === 'password';
  passwordInput.type = shown ? 'text' : 'password';
  revealButton.setAttribute('aria-pressed', String(shown));
  revealButton.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
  passwordInput.focus();
});
// Caps Lock, said while the password box is used.
for (const type of ['keydown', 'keyup']) {
  passwordInput.addEventListener(type, (event) => {
    capsNote.hidden = !event.getModifierState?.('CapsLock');
  });
}
passwordInput.addEventListener('blur', () => { capsNote.hidden = true; });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  chrome.runtime.sendMessage({ type: 'QTS_CLOSE_SIGN_IN_FRAME' }).catch(() => {});
});
// The launcher focuses this frame when it opens; move focus to the first empty field.
window.addEventListener('focus', () => {
  if (document.activeElement === userInput || document.activeElement === passwordInput) return;
  (userInput.value ? passwordInput : userInput).focus();
});
// The card around this frame sizes itself to the form, so an error message never needs a scrollbar.
// Only the height leaves this frame.
new ResizeObserver(() => {
  window.parent.postMessage({ qtsSignInHeight: form.offsetHeight }, '*');
}).observe(form);
