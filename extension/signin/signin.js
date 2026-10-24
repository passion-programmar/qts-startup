// Runs in an extension-origin frame so the host page cannot observe the
// credentials typed here. Success is published through extension storage,
// which the page launcher watches to close this frame.

const form = document.querySelector('form');
const userInput = document.getElementById('login-user');
const passwordInput = document.getElementById('login-password');
const errorMessage = document.querySelector('.error');
let loginInFlight = false;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

async function submitSignIn() {
  const loginName = userInput.value.trim();
  const password = passwordInput.value;
  if (!loginName || !password || loginInFlight) return;
  loginInFlight = true;
  userInput.disabled = true;
  passwordInput.disabled = true;
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
    userInput.disabled = false;
    passwordInput.disabled = false;
    if (!errorMessage.hidden) passwordInput.select();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitSignIn();
});
userInput.addEventListener('change', submitSignIn);
passwordInput.addEventListener('change', submitSignIn);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  chrome.runtime.sendMessage({ type: 'QTS_CLOSE_SIGN_IN_FRAME' }).catch(() => {});
});
// The launcher focuses this frame when it opens; move focus to the first empty field.
window.addEventListener('focus', () => {
  if (document.activeElement === userInput || document.activeElement === passwordInput) return;
  (userInput.value ? passwordInput : userInput).focus();
});
