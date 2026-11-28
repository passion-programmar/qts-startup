// The summary line above the people tree ("2 admins · 4 managers · 11 candidates"); server-side.
import type { PeopleTreeUser } from "@/app/components/people-tree";

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

export function peopleTreeSummary(users: PeopleTreeUser[]): string {
  const count = (role: string) => users.filter((user) => user.role === role).length;
  return [plural(count("admin"), "admin"), plural(count("manager"), "manager"), plural(count("account"), "candidate")].join(" · ");
}
