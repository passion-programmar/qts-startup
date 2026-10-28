// What a ChatGPT answer that failed the document check holds, in one line: the resume's own keys
// and its sections with their item counts. It goes into the message sent back to ChatGPT (so it
// can correct exactly that) and into the Manager's notification, since a failed run is not kept.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function describeResumeShape(responseJson: unknown): string {
  const resume = isRecord(responseJson) ? responseJson.resume : null;
  if (!isRecord(resume)) return "Found: no resume object.";
  const keys = Object.keys(resume).slice(0, 15).join(", ") || "none";
  const sections = resume.sections;
  if (!Array.isArray(sections)) {
    return `Found: resume keys ${keys}; resume.sections is ${isRecord(sections) ? "an object, not a list" : "missing"}.`;
  }
  const listed = sections.slice(0, 12).map((section) => {
    if (!isRecord(section)) return "(not an object)";
    const name = String(section.id ?? section.title ?? "(no id)").slice(0, 40);
    const items = section.items;
    const itemKeys = Array.isArray(items) && isRecord(items[0]) ? Object.keys(items[0]).slice(0, 8).join("/") : "";
    const otherLists = Object.keys(section).filter((key) => key !== "items" && Array.isArray(section[key]));
    return `${name} (${Array.isArray(items) ? `${items.length} items${itemKeys ? `: ${itemKeys}` : ""}` : "no items list"}`
      + `${otherLists.length ? `; lists under ${otherLists.join(", ")}` : ""})`;
  });
  return `Found: resume keys ${keys}; sections: ${listed.join(", ") || "none"}.`;
}
