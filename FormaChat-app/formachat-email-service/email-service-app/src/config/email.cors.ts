export const corsManager = {
  getCorsConfig: () => ({
    origin: process.env.EMAIL_CORS_ORIGIN || true, // Allow all in dev, restrict in prod
    credentials: false, // Email service doesn't need credentials
    methods: ['GET', 'HEAD'],
  }),
};