// Managers see a plain explanation and who can fix it. Provider details and the
// diagnostic code stay in the server log and the response's diagnosticCode field.
export function getGetJdFailureMessage(code: string): string {
  const httpStatus = /^gemini_(?:count_tokens_)?http_(\d{3})$/.exec(code)?.[1];
  if (httpStatus === "429") {
    return "Gemini is busy or its quota is used up. Wait a minute and try again.";
  }
  if (httpStatus === "401" || httpStatus === "403") {
    return "Gemini rejected the server's access. Ask your Super Admin to check the Gemini API key.";
  }
  if (httpStatus && Number(httpStatus) >= 500) {
    return "Gemini is temporarily unavailable. Try again in a few minutes.";
  }
  if (code === "gemini_timeout" || code === "gemini_network_error") {
    return "QTS could not reach Gemini in time. Try again.";
  }
  return "Gemini could not evaluate this page. Try again, or ask your Super Admin if it keeps failing.";
}
