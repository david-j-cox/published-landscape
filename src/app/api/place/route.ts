import { NextResponse } from "next/server";
import { placeArticle } from "@/lib/placement";

// Coerce an untrusted JSON value to a finite integer, else undefined.
function intOrUndef(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const abstract = typeof body?.abstract === "string" ? body.abstract.trim() : "";

  if (!title && !abstract) {
    return NextResponse.json({ error: "Provide at least a title or abstract." }, { status: 400 });
  }

  const result = placeArticle(title, abstract, 10, 30, {
    journalId: intOrUndef(body?.journalId),
    yearMin: intOrUndef(body?.yearMin),
    yearMax: intOrUndef(body?.yearMax),
  });
  if (result.matchedTermCount < 3) {
    return NextResponse.json(
      {
        error:
          "Too little recognizable text to place reliably - try pasting the full abstract, not just the title.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json(result);
}
