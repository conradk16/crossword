import { NextResponse } from 'next/server';

export async function GET() {
  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: '48NP6Y8GUR.com.conradscrossword',
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
