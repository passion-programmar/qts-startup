import { CardsPageSkeleton } from "@/app/ui/page-skeletons";

// Shown at once while this page's data loads (the sidebar and top bar stay).
export default function Loading() {
  return <CardsPageSkeleton label="Loading profile" />;
}
