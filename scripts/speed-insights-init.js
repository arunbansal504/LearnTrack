/* ===================================================
   VERCEL SPEED INSIGHTS INITIALIZATION
   Tracks Core Web Vitals and sends to Vercel Analytics
   
   Metrics Tracked:
   - LCP (Largest Contentful Paint)
   - FID (First Input Delay)
   - CLS (Cumulative Layout Shift)
   - FCP (First Contentful Paint)
   - TTFB (Time to First Byte)
   
   Documentation: https://vercel.com/docs/speed-insights
   =================================================== */

import { injectSpeedInsights } from './vendor/speed-insights.mjs';

// Initialize Speed Insights
// Note: Speed Insights does NOT track in development mode
// Data will only be sent from production deployments on Vercel
injectSpeedInsights({
  debug: false, // Set to true to see console logs (auto-enabled in dev)
  
  // Optional Configuration:
  // -----------------------
  
  // Sample rate: Control what % of page loads are tracked (0.0 to 1.0)
  // sampleRate: 1, // Default: 1 (100% of page loads)
  
  // Before send: Modify or filter events before sending to Vercel
  // beforeSend: (event) => {
  //   // Example: Filter out events from specific routes
  //   // if (event.url.includes('/admin')) return null;
  //   
  //   // Example: Add custom route information
  //   // event.route = computeCustomRoute(event.url);
  //   
  //   return event; // Return event to send, null/false to cancel
  // },
  
  // Custom route: Override automatic route detection
  // route: '/custom-route',
  
  // Custom endpoint: For self-hosted Speed Insights
  // endpoint: 'https://your-custom-endpoint.com/v1/vitals',
  
  // DSN: Data Source Name (required for self-hosting only)
  // dsn: 'your-dsn-here',
});

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  console.log('ℹ️ Speed Insights initialized (tracking disabled in local development)');
} else {
  console.log('✓ Vercel Speed Insights initialized');
}
