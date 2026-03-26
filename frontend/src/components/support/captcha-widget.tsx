'use client';

import { useEffect, useRef } from 'react';

interface CaptchaWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
    };
    hcaptcha?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
    };
    onCaptchaLoad?: () => void;
  }
}

export function CaptchaWidget({ onVerify, onExpire }: CaptchaWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY ?? '';
  const provider = process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'turnstile';

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    const scriptSrc =
      provider === 'hcaptcha'
        ? 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=onCaptchaLoad'
        : 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onCaptchaLoad';

    const renderWidget = () => {
      if (!containerRef.current) return;
      const api = provider === 'hcaptcha' ? window.hcaptcha : window.turnstile;
      if (!api) return;
      widgetIdRef.current = api.render(containerRef.current, {
        sitekey: siteKey,
        callback: onVerify,
        'expired-callback': onExpire,
        theme: 'light',
      });
    };

    if (
      (provider === 'hcaptcha' && window.hcaptcha) ||
      (provider === 'turnstile' && window.turnstile)
    ) {
      renderWidget();
      return;
    }

    window.onCaptchaLoad = renderWidget;

    const existing = document.querySelector(`script[src="${scriptSrc}"]`);
    if (!existing) {
      const script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      window.onCaptchaLoad = undefined;
    };
  }, [siteKey, provider, onVerify, onExpire]);

  if (!siteKey) {
    // Dev mode: render a fake token input so the form still works
    return (
      <div className="rounded border border-dashed border-muted-foreground/40 p-3 text-xs text-muted-foreground">
        CAPTCHA disabled — set{' '}
        <code className="font-mono">NEXT_PUBLIC_CAPTCHA_SITE_KEY</code> to enable.
        <input type="hidden" value="dev-token" onChange={() => {}} />
        <button
          type="button"
          className="ml-2 underline"
          onClick={() => onVerify('dev-token')}
        >
          Simulate verify
        </button>
      </div>
    );
  }

  return <div ref={containerRef} />;
}
