export type Representation = { dateFormat?: string; numberFormat?: string; callingCode?: string; nationalSignificant?: boolean; unit?: string; nameOrder?: string };
declare const api: { metadata(raw: unknown): Representation | undefined; describeField(raw: unknown): Representation | undefined; date(value: unknown, format?: string): {year: number; month: number; day: number} | null };
export default api;
