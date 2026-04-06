import React from 'react';

interface StatusPillProps {
  tone: 'good' | 'warn' | 'bad';
  children: React.ReactNode;
}

export function StatusPill({ tone, children }: StatusPillProps) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}
