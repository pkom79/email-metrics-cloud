"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export type AdminAccountOption = {
    id: string;
    label: string;
    businessName?: string | null;
    storeUrl?: string | null;
    adminContactLabel?: string | null;
    isAdminFree?: boolean;
};

type Props = {
    accounts: AdminAccountOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
};

function TagBubble({ label }: { label: string }) {
    return (
        <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 px-2 py-0.5 text-[11px] font-semibold tracking-wide">
            {label}
        </span>
    );
}

export default function AdminAccountPicker({ accounts, value, onChange, placeholder = 'Select account', disabled }: Props) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const hasAccounts = accounts.length > 0;

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            const node = event.target as Node;
            if (menuRef.current?.contains(node) || buttonRef.current?.contains(node)) return;
            setOpen(false);
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    const active = useMemo(() => accounts.find(acc => acc.id === value), [accounts, value]);
    const tagLabel = active?.isAdminFree ? (active.adminContactLabel || 'Internal') : null;

    const handleSelect = (id: string) => {
        onChange(id);
        setOpen(false);
    };

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled || !hasAccounts}
                onClick={() => setOpen(prev => !prev)}
                className={`inline-flex h-10 items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm font-medium text-gray-900 dark:text-gray-100 w-full sm:w-[260px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-60`}
            >
                <div className="flex flex-col text-left">
                    <span className="truncate">{active?.label || placeholder}</span>
                    {active?.storeUrl && <span className="text-xs font-normal text-gray-500 dark:text-gray-400 truncate">{active.storeUrl}</span>}
                </div>
                <div className="flex items-center gap-1">
                    {tagLabel && <TagBubble label={tagLabel} />}
                    <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-300" />
                </div>
            </button>
            {open && (
                <div
                    ref={menuRef}
                    role="listbox"
                    className="absolute right-0 z-20 mt-2 w-full sm:w-72 max-h-80 overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl"
                >
                    {hasAccounts ? (
                        <>
                            {accounts.map(account => {
                                const isSelected = account.id === value;
                                const optionTag = account.isAdminFree ? (account.adminContactLabel || 'Internal') : null;
                                return (
                                    <button
                                        key={account.id}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => handleSelect(account.id)}
                                        className={`w-full text-left px-4 py-3 flex flex-col gap-1 hover:bg-purple-50 dark:hover:bg-gray-800 ${isSelected ? 'bg-purple-50/70 dark:bg-gray-800' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{account.label}</p>
                                            {optionTag && <TagBubble label={optionTag} />}
                                        </div>
                                        {account.storeUrl && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{account.storeUrl}</p>}
                                    </button>
                                );
                            })}
                            <div className="border-t border-gray-200 dark:border-gray-800">
                                <button
                                    type="button"
                                    onClick={() => handleSelect('')}
                                    className="flex w-full items-center justify-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                >
                                    <X className="h-3.5 w-3.5" />
                                    Clear selection
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">No accounts found yet.</div>
                    )}
                </div>
            )}
        </div>
    );
}
