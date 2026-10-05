import { NextRequest, NextResponse } from "next/server";

const TRIAGULL_API_BASE = "https://api.triagulljobs.in/api";

function clampLimit(value: string | null): number {
  const parsed = Number.parseInt(value || "12", 10);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(50, parsed));
}

async function forwardJson(url: URL) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "ULTRON-Triagull-Assistant/1.0",
    },
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = {
      success: false,
      message: text || "Invalid Triagull API response",
    };
  }

  return NextResponse.json(payload, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const action = (params.get("action") || "jobs").toLowerCase();

    if (action === "health") {
      return forwardJson(new URL(TRIAGULL_API_BASE + "/health"));
    }

    if (action === "categories") {
      return forwardJson(
        new URL(TRIAGULL_API_BASE + "/jobs/categories"),
      );
    }

    if (action === "job") {
      const id = Number.parseInt(params.get("id") || "", 10);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json(
          {
            success: false,
            message: "A valid job id is required",
          },
          { status: 400 },
        );
      }

      return forwardJson(
        new URL(TRIAGULL_API_BASE + "/jobs/" + id),
      );
    }

    const url = new URL(TRIAGULL_API_BASE + "/jobs");
    const allowed = [
      "search",
      "location",
      "category",
      "type",
      "page",
    ] as const;

    for (const key of allowed) {
      const value = params.get(key);
      if (value && value.trim()) {
        url.searchParams.set(key, value.trim());
      }
    }

    url.searchParams.set(
      "limit",
      String(clampLimit(params.get("limit"))),
    );

    return forwardJson(url);
  } catch (error) {
    console.error("Triagull API proxy error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unable to reach Triagull Jobs API",
      },
      { status: 502 },
    );
  }
}
