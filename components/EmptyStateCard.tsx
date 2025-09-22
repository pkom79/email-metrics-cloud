"use client";
import { Calendar } from 'lucide-react';
import React from 'react';

export default function EmptyStateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
      <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300" />
      <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h4>
      <p className="text-sm text-gray-600 dark:text-gray-400">{body}</p>
    </div>
  );
}

