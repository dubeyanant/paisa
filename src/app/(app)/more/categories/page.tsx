import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getCategoryTree } from "@/lib/data/categories";
import { CategoriesManager } from "./categories-manager";

export const metadata: Metadata = { title: "Categories · Paisa" };

export default async function CategoriesPage() {
  const tree = await getCategoryTree();
  return (
    <>
      <PageHeader title="Categories" back={{ href: "/more", label: "Back to more" }} />
      <CategoriesManager {...tree} />
    </>
  );
}
