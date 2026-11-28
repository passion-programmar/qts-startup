import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Inbox, Plus, Settings2, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { Badge } from "@/app/ui/badge";
import { Button, LinkButton } from "@/app/ui/button";
import { Card, CardHeader, Section } from "@/app/ui/card";
import { EmptyState, Notice, Skeleton, SkeletonRows } from "@/app/ui/feedback";
import { Field, Input, Select, Textarea } from "@/app/ui/field";
import { PageHeader } from "@/app/ui/page-header";
import { Table, TableFrame, TBody, Td, TGroupRow, Th, THead, Tr } from "@/app/ui/table";
import { LinkTabs } from "@/app/ui/tabs";
import { InteractiveDemo } from "@/app/ui-kit/interactive-demo";

export const instant = false;

export const metadata: Metadata = {
  title: "UI kit | QTS",
};

// A preview of the shared pieces in src/app/ui (UI rebuild, Step 1). Signed-in staff only; not in the menu.
export default async function UiKitPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const tab = (await searchParams).tab === "second" ? "second" : "first";

  return (
      <main className="space-y-6 py-1">
        <PageHeader
          actions={<LinkButton href="/ui-kit" icon={<Plus aria-hidden="true" className="size-4" />}>Add New</LinkButton>}
          back={{ href: "/", label: "Home" }}
          title="UI kit"
        />

        <Card>
          <CardHeader description="Primary for the main action on a page; one per area." icon={<Sparkles />} title="Buttons" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="soft">Soft</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Saving...</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm">Small primary</Button>
            <Button size="sm" variant="secondary">Small secondary</Button>
            <Button size="sm" variant="soft">Edit</Button>
          </div>
        </Card>

        <Card>
          <CardHeader description="Status labels and counts." title="Badges" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="primary">Global default</Badge>
            <Badge dot tone="success">Active</Badge>
            <Badge dot tone="warning">Waiting</Badge>
            <Badge dot tone="danger">Failed</Badge>
          </div>
        </Card>

        <LinkTabs
          items={[
            { href: "/ui-kit", label: "All", count: 14, active: tab === "first" },
            { href: "/ui-kit?tab=second", label: "AI / ML", count: 7, active: tab === "second" },
          ]}
          label="Demo tabs"
          trailing={<Button variant="secondary">Right side</Button>}
        />

        <Card>
          <CardHeader actions={<Button size="sm" variant="secondary">Action</Button>} description="Switches, a loading button and a confirm dialog." icon={<Settings2 />} title="Interactive" />
          <div className="mt-4">
            <InteractiveDemo />
          </div>
        </Card>

        <Card>
          <CardHeader description="Label, control, then a hint or an error." title="Form fields" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field hint="As on the candidate's documents." htmlFor="demo-first" label="First name" required>
              <Input id="demo-first" placeholder="Jordan" />
            </Field>
            <Field error="Enter a valid email address." htmlFor="demo-email" label="Email">
              <Input aria-invalid defaultValue="jordan@" id="demo-email" type="email" />
            </Field>
            <Field htmlFor="demo-category" label="Category">
              <Select defaultValue="ai" id="demo-category">
                <option value="ai">AI / ML</option>
                <option value="devops">DevOps / Cloud</option>
              </Select>
            </Field>
            <Field className="sm:col-span-2 lg:col-span-3" htmlFor="demo-notes" label="Notes">
              <Textarea id="demo-notes" placeholder="Anything to remember" />
            </Field>
            <Field htmlFor="demo-disabled" label="Disabled">
              <Input defaultValue="Can't change" disabled id="demo-disabled" />
            </Field>
          </div>
          <div className="mt-6 space-y-5">
            <Section description="A block inside a card, with a line above." title="Section">
              <p className="text-sm text-fg-muted">Section content.</p>
            </Section>
            <Section actions={<Button size="sm" variant="ghost">Edit</Button>} title="Another section">
              <p className="text-sm text-fg-muted">More content.</p>
            </Section>
          </div>
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          <Notice title="Saved">The profile was saved.</Notice>
          <Notice tone="success">Apply is on with ChatGPT.</Notice>
          <Notice tone="warning" title="Check this">The extension can take up to 5 minutes to update.</Notice>
          <Notice tone="danger">The candidate could not be deleted. Please try again.</Notice>
        </div>

        <TableFrame>
          <Table>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th className="text-right">Jobs</Th>
              </tr>
            </THead>
            <TBody>
              <TGroupRow colSpan={4}>AI / ML</TGroupRow>
              <Tr>
                <Td className="font-semibold text-fg">Andrei Gavriluta</Td>
                <Td>AI / ML</Td>
                <Td><Badge dot tone="success">Active</Badge></Td>
                <Td className="text-right tabular-nums">12</Td>
              </Tr>
              <Tr>
                <Td className="font-semibold text-fg">Andrei Sava</Td>
                <Td>DevOps / Cloud</Td>
                <Td><Badge dot>Inactive</Badge></Td>
                <Td className="text-right tabular-nums">4</Td>
              </Tr>
            </TBody>
          </Table>
        </TableFrame>

        <div className="grid gap-4 md:grid-cols-2">
          <Card flush>
            <div className="border-b border-line px-4 py-3 text-xs font-semibold text-fg-muted">Loading table</div>
            <SkeletonRows columns={4} rows={4} />
          </Card>
          <Card>
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </Card>
        </div>

        <Card flush>
          <EmptyState
            action={<Button icon={<Plus aria-hidden="true" className="size-4" />}>Add New</Button>}
            description="Candidates you add appear here."
            icon={<Inbox />}
            title="No candidate accounts"
          />
        </Card>
      </main>
  );
}
