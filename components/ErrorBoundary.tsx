"use client";
import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ComponentType<{ error: Error; reset: () => void }>; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) { console.error('Dashboard error:', error, errorInfo); }
    reset = () => { this.setState({ hasError: false, error: null }); };
    render() {
        if (this.state.hasError && this.state.error) {
            const Fallback = this.props.fallback;
            if (Fallback) return <Fallback error={this.state.error} reset={this.reset} />;
            return (
                <div className="min-h-screen flex items-center justify-center p-4">
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
                        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">Something went wrong</h2>
                        <p className="text-sm text-red-600 dark:text-red-300 mb-4">{this.state.error.message}</p>
                        <button onClick={this.reset} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors">Try again</button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
