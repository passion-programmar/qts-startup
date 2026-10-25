// Time zones Super Admin can choose for job record dates (Settings). Pure, so
// the list is shared by the settings form, the action and the tests.

export const jobRecordTimeZoneSettingKey = "job_record_time_zone";

export const defaultJobRecordTimeZone = "America/Los_Angeles";

export const jobRecordTimeZoneOptions = [
  { value: "Asia/Tokyo", label: "Japan" },
  { value: "Europe/Bucharest", label: "Romania" },
  { value: "America/Los_Angeles", label: "United States — Pacific" },
  { value: "America/Chicago", label: "United States — Central" },
  { value: "America/New_York", label: "United States — Eastern" },
  { value: "America/Toronto", label: "Canada — Eastern" },
  { value: "Europe/London", label: "United Kingdom" },
  { value: "Europe/Berlin", label: "Germany" },
  { value: "Europe/Warsaw", label: "Poland" },
  { value: "Europe/Kyiv", label: "Ukraine" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Asia/Manila", label: "Philippines" },
  { value: "Asia/Seoul", label: "South Korea" },
  { value: "Australia/Sydney", label: "Australia — Sydney" },
  { value: "UTC", label: "UTC" },
] as const;

export function isJobRecordTimeZone(value: unknown): value is string {
  return jobRecordTimeZoneOptions.some((option) => option.value === value);
}
