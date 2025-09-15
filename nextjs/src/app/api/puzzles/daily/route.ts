import { NextRequest, NextResponse } from 'next/server';

// GET /api/puzzles/daily - Get today's puzzle
export async function GET(request: NextRequest) {
  return NextResponse.json({ hello: "goodbye" }, { status: 200 });
}
