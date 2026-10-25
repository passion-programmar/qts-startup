import path from "node:path";

// The render page is served from this private origin; every request it makes is answered from
// public/resume-templates (the same files the Resume page preview loads, fonts included), and
// anything else (other hosts, other paths) is blocked.
export const templateRenderOrigin = "https://qts-render.invalid";

const templateRoot = path.join(process.cwd(), "public", "resume-templates");

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

export type TemplateRenderAsset = { filePath: string; contentType: string };

export function resolveTemplateRenderAsset(rawUrl: string): TemplateRenderAsset | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== templateRenderOrigin) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // Lowercase names, at most two folders deep, and only the file types the templates use.
  const match = /^\/resume-templates\/((?:[a-z0-9-]+\/){0,2}[a-z0-9-]+(\.html|\.css|\.js|\.woff2))$/.exec(pathname);
  if (!match) return null;
  const [, relativePath, extension] = match;
  if (extension === ".woff2" && !relativePath.startsWith("fonts/")) return null;
  return { filePath: path.join(templateRoot, relativePath), contentType: contentTypes[extension] };
}
