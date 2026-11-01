export const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";

export function normalizeChatGptUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
