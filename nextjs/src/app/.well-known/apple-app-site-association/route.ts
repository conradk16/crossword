import { NextResponse } from 'next/server';

export async function GET() {
  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'ZNUR9L7D9D.com.conradscrossword',
          paths: ['/share', '/share/*']
        }
      ]
    }
  };

  return new NextResponse(JSON.stringify(aasa), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
