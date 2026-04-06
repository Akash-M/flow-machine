import React from 'react';

interface MetricCardProps {
  eyebrow: string;
  title: string;
  detail: string;
  tone?: 'neutral' | 'good' | 'warn';
}

export function MetricCard({ eyebrow, title, detail, tone = 'neutral' }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-card__eyebrow">{eyebrow}</p>
      <h3 className="metric-card__title">{title}</h3>
      <p className="metric-card__detail">{detail}</p>
    </article>
  );
}
