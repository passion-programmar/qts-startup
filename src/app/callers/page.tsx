import { redirect } from "next/navigation";
import { AddCallerForm, CallerRowActions } from "@/app/callers/callers-manager";
import { PaginatedTable } from "@/app/components/paginated-table";
import { Badge } from "@/app/ui/badge";
import { Card } from "@/app/ui/card";
import { PageHeader } from "@/app/ui/page-header";
import { requireUser } from "@/lib/session";
import { readAdminCallers } from "@/server/callers/callers";

export const instant = false;

// The Admin's callers: the people who take interview calls. The Admin's Managers pick one on each
// interview. Removing a caller keeps them on the interviews they took.
export default async function CallersPage() {
  const admin = await requireUser();
  if (admin.role !== "admin") redirect("/");
  const rows = await readAdminCallers(admin.id);
  const active = rows.filter((row) => !row.archivedAt).length;

  return (
    <main className="py-1">
      <PageHeader
        actions={<Badge className="px-3 py-1 text-xs">{active} active</Badge>}
        title="Callers"
      />
      <Card className="mb-6">
        <AddCallerForm />
      </Card>
      <PaginatedTable
        columns={[
          { label: "No", className: "w-[6%]" },
          { label: "Name", className: "w-[34%]" },
          { label: "Label", className: "w-[25%]" },
          { label: "Actions", className: "w-[35%]" },
        ]}
        emptyMessage="No callers yet. Add the first one above."
        rows={rows.map((row, index) => ({
          id: row.id,
          search: { name: row.name, label: row.label ?? "" },
          cells: [
            index + 1,
            <span className={row.archivedAt ? "text-slate-400 line-through" : "font-medium"} key="name">{row.name}</span>,
            <span className="flex flex-wrap items-center gap-1.5" key="label">
              {row.label ? <Badge>{row.label}</Badge> : <span className="text-slate-400">—</span>}
              {row.archivedAt && <Badge tone="warning">Removed</Badge>}
            </span>,
            <CallerRowActions caller={{ id: row.id, name: row.name, label: row.label, removed: Boolean(row.archivedAt) }} key="actions" />,
          ],
        }))}
        searchFields={[{ key: "name", label: "Name" }, { key: "label", label: "Label" }]}
      />
    </main>
  );
}
