import { NextResponse } from "next/server";
import { getArticleById } from "@/lib/data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = getArticleById(id);
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(article);
}
