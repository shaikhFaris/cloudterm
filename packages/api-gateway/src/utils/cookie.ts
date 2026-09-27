import type { CookieOptions, Response } from "express";
import { env } from "../config/validateEnvs";

export const cookieOptions: CookieOptions = {
  secure: true,
  sameSite: "lax", //important
  domain: env.COOKIE_DOMAIN,
};

export const clearAllCookies = (res: Response) => {
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);
  //   res.clearCookie("csrfToken", cookieOptions);
};

export const setAllCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
  //   csrfToken: string,
) => {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    maxAge: env.JWT_ACCESS_TOKEN_TIME_IN_MS,
    ...cookieOptions,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    maxAge: env.JWT_REFRESH_TOKEN_TIME_IN_MS,
    ...cookieOptions,
  });
};
