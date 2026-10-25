// pdfjs-dist ships no types for its worker module; the Resume page only hands this export to pdf.js.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
