import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';

const app = express();

// Explicit origin allowlist sourced from env (comma-separated).
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Strict CSP: only necessary sources (Stellar SDK CDN, IPFS gateways).
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://unpkg.com',
  ],
  styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
  imgSrc: [
    "'self'",
    'data:',
    'https://ipfs.io',
    'https://gateway.pinata.cloud',
    'https://cloudflare-ipfs.com',
  ],
  connectSrc: [
    "'self'",
    'https://horizon.stellar.org',
    'https://horizon-testnet.stellar.org',
    'https://ipfs.io',
    'https://gateway.pinata.cloud',
    'https://cloudflare-ipfs.com',
  ],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  upgradeInsecureRequests: [],
};

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives,
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

// Referrer-Policy, Permissions-Policy, and X-Content-Type-Options headers.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// CORS with explicit origin allowlist; reject pre-flight from unlisted origins.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

app.use(express.json());

export default app;
