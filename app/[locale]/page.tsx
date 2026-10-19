import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('landing');

  const features = [
    {
      title: t('features.governance.title'),
      description: t('features.governance.description'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" strokeLinejoin="round" />
          <path d="M3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      title: t('features.voting.title'),
      description: t('features.voting.description'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M9 12.5 11 14.5 15.5 10" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
      ),
    },
    {
      title: t('features.claims.title'),
      description: t('features.claims.description'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  const partners = [
    { name: 'Stellar Development Foundation', href: 'https://stellar.org' },
    { name: 'CertiK', href: 'https://www.certik.com' },
    { name: 'Trail of Bits', href: 'https://www.trailofbits.com' },
  ];

  return (
    <main className="landing">
      <section className="hero" aria-labelledby="hero-heading">
        <div className="hero__content">
          <p className="hero__eyebrow">{t('hero.eyebrow')}</p>
          <h1 id="hero-heading" className="hero__title">
            {t('hero.title')}
          </h1>
          <p className="hero__subtitle">{t('hero.subtitle')}</p>
          <div className="hero__actions">
            <Link className="btn btn--primary" href={`/${locale}/quote`}>
              {t('hero.cta')}
            </Link>
            <Link className="btn btn--ghost" href={`/${locale}/dashboard`}>
              {t('hero.secondaryCta')}
            </Link>
          </div>
        </div>
        <div className="hero__graphic" aria-hidden="true">
          <svg viewBox="0 0 320 320" className="stellar-graphic" role="presentation">
            <defs>
              <radialGradient id="stellarGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="160" cy="160" r="150" fill="url(#stellarGlow)" />
            <g className="stellar-graphic__orbit">
              <ellipse cx="160" cy="160" rx="140" ry="60" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
              <ellipse cx="160" cy="160" rx="140" ry="60" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" transform="rotate(60 160 160)" />
              <ellipse cx="160" cy="160" rx="140" ry="60" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" transform="rotate(120 160 160)" />
            </g>
            <g className="stellar-graphic__nodes">
              <circle cx="160" cy="160" r="10" fill="currentColor" />
              <circle cx="300" cy="160" r="6" fill="currentColor" />
              <circle cx="90" cy="40" r="6" fill="currentColor" />
              <circle cx="230" cy="280" r="6" fill="currentColor" />
            </g>
          </svg>
        </div>
      </section>

      <section className="features" aria-labelledby="features-heading">
        <h2 id="features-heading" className="section__title">
          {t('features.heading')}
        </h2>
        <ul className="features__grid">
          {features.map((feature) => (
            <li key={feature.title} className="feature-card">
              <span className="feature-card__icon">{feature.icon}</span>
              <h3 className="feature-card__title">{feature.title}</h3>
              <p className="feature-card__description">{feature.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="cta" aria-labelledby="cta-heading">
        <h2 id="cta-heading" className="section__title">
          {t('cta.heading')}
        </h2>
        <p className="cta__description">{t('cta.description')}</p>
        <Link className="btn btn--primary" href={`/${locale}/quote`}>
          {t('cta.button')}
        </Link>
      </section>

      <section className="partners" aria-labelledby="partners-heading">
        <h2 id="partners-heading" className="section__title">
          {t('partners.heading')}
        </h2>
        <ul className="partners__list">
          {partners.map((partner) => (
            <li key={partner.name} className="partners__item">
              <a href={partner.href} target="_blank" rel="noopener noreferrer">
                {partner.name}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
