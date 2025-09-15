import { NextResponse } from 'next/server';

// GET /api/puzzles/daily - Get today's puzzle
export async function GET() {
  return NextResponse.json({ hello: "goodbye" }, { status: 200 });
}
