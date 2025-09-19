"use client";
import { useEffect } from 'react';

export default function AgencySignupPage() {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.pathname = '/signup';
    url.searchParams.set('mode', 'signup');
    url.searchParams.set('type', 'agency');
    window.location.replace(url.toString());
  }, []);
  return null;
}
