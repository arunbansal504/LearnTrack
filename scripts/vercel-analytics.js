/**
 * Vercel Web Analytics Integration
 * This script initializes Vercel Web Analytics for the LearnTrack app
 * Documentation: https://vercel.com/docs/analytics/quickstart
 */

import { inject } from '../node_modules/@vercel/analytics/dist/index.js';

// Initialize Vercel Web Analytics
inject({
  mode: 'auto', // Automatically detects production vs development
  debug: false  // Set to true for debugging
});

console.log('✓ Vercel Web Analytics initialized');
