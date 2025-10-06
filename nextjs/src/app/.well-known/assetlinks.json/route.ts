import { NextResponse } from 'next/server';

export async function GET() {
  const assetlinks = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.conradscrossword',
        sha256_cert_fingerprints: [
          '0B:DB:24:CD:7D:90:ED:4B:13:E3:68:BB:2B:EE:EE:61:29:61:90:49:68:BF:A5:60:A3:3D:E2:86:4C:16:D5:C9'
        ]
      }
    }
  ];

  return new NextResponse(JSON.stringify(assetlinks), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
