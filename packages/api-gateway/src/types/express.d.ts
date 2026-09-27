declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };
      refreshToken?: string;
    }
  }
}

export {};
