'use client';

import { useEffect } from 'react';

export default function SharePage() {
  useEffect(() => {
    // Detect user agent to determine platform
    const userAgent = navigator.userAgent || navigator.vendor;
    
    // Check if iOS
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    // Check if Android
    const isAndroid = /android/i.test(userAgent);
    
    // Redirect to appropriate store
    if (isIOS) {
      window.location.href = 'https://apps.apple.com/app/id6753033018';
    } else if (isAndroid) {
      window.location.href = 'https://play.google.com/store/apps/details?id=com.conradscrossword';
    } else {
      // Default to iOS App Store for desktop/other platforms
      window.location.href = 'https://apps.apple.com/app/id6753033018';
    }
  }, []);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Opening Conrad&apos;s Crossword...</h1>
        <p style={{ color: '#666' }}>If the app doesn&apos;t open automatically, you&apos;ll be redirected to download it.</p>
      </div>
    </div>
  );
}
