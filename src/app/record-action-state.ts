/** resumeFiles: a removed job's PDFs under Downloads/QTS_Resume, deleted on this PC by the extension. */
export type RecordActionState = { error: string | null; success: string | null; resumeFiles?: string[] };
export const initialRecordState: RecordActionState = { error: null, success: null };
