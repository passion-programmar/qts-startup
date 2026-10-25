import { readFile } from "node:fs/promises";
import path from "node:path";

// The render page is served from this private origin; every request it makes is answered
// from local files, and anything else (other hosts, unknown paths) is blocked.
export const templateRenderOrigin = "https://qts-render.invalid";

const templateRoot = path.join(process.cwd(), "public", "resume-templates");
const fontRoot = path.join(process.cwd(), "node_modules", "@fontsource");

const templateFileTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

// Open fonts with the same metrics as the Windows fonts the templates name. Vercel's Chromium
// ships only Open Sans, so without these every template would fall back to it.
export const templateFontFamilies = {
  arimo: { family: "Arimo", aliases: ["Arial", "Helvetica", "Arial Black", "Liberation Sans", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "DejaVu Sans"] },
  tinos: { family: "Tinos", aliases: ["Times New Roman", "Times", "Liberation Serif"] },
  cousine: { family: "Cousine", aliases: ["Consolas", "Courier New", "Liberation Mono"] },
  carlito: { family: "Carlito", aliases: ["Calibri"] },
  caladea: { family: "Caladea", aliases: ["Cambria"] },
  gelasio: { family: "Gelasio", aliases: ["Georgia", "Palatino Linotype", "Palatino", "Book Antiqua", "TeX Gyre Pagella"] },
} as const;

type FontPackage = keyof typeof templateFontFamilies;
const fontStyleFiles = ["400.css", "400-italic.css", "700.css", "700-italic.css"];

export const templateFontStylesheetPath = "/fonts/qts-template-fonts.css";

export type TemplateRenderAsset =
  | { kind: "file"; filePath: string; contentType: string }
  | { kind: "font-stylesheet" };

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
  if (pathname.includes("\\") || pathname.split("/").some((part) => part === "..")) return null;

  if (pathname === templateFontStylesheetPath) return { kind: "font-stylesheet" };

  const font = /^\/fonts\/([a-z]+)\/([a-z0-9-]+\.woff2)$/.exec(pathname);
  if (font) {
    const [, fontPackage, fileName] = font;
    if (!(fontPackage in templateFontFamilies) || !fileName.startsWith(`${fontPackage}-`)) return null;
    return { kind: "file", filePath: path.join(fontRoot, fontPackage, "files", fileName), contentType: "font/woff2" };
  }

  const template = /^\/resume-templates\/((?:[a-z0-9-]+\/)?[a-z0-9-]+(\.html|\.css|\.js))$/.exec(pathname);
  if (template) {
    const [, relativePath, extension] = template;
    return { kind: "file", filePath: path.join(templateRoot, relativePath), contentType: templateFileTypes[extension] };
  }
  return null;
}

let fontStylesheet: Promise<string> | null = null;

// fontsource's @font-face rules, pointed at the render origin, repeated under each Windows name.
export function templateFontStylesheet(): Promise<string> {
  fontStylesheet ??= buildTemplateFontStylesheet().catch((error: unknown) => {
    fontStylesheet = null;
    throw error;
  });
  return fontStylesheet;
}

async function buildTemplateFontStylesheet(): Promise<string> {
  const blocks: string[] = [];
  for (const [fontPackage, { family, aliases }] of Object.entries(templateFontFamilies) as [FontPackage, (typeof templateFontFamilies)[FontPackage]][]) {
    for (const styleFile of fontStyleFiles) {
      const source = await readFile(path.join(fontRoot, fontPackage, styleFile), "utf8").catch(() => "");
      const rules = rewriteFontFaces(source, fontPackage);
      if (!rules) continue;
      for (const name of [family, ...aliases]) {
        blocks.push(rules.replaceAll(`font-family: '${family}';`, `font-family: ${JSON.stringify(name)};`));
      }
    }
  }
  return blocks.join("\n");
}

export function rewriteFontFaces(source: string, fontPackage: string): string {
  return source
    // Only the woff2 files are served; Chromium never needs the woff fallback.
    .replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, "")
    .replaceAll("url(./files/", `url(/fonts/${fontPackage}/`)
    .trim();
}
