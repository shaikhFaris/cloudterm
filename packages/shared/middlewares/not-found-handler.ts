import { type RequestHandler } from "express";

export const handle404: RequestHandler = (req, res, next) => {
  res.status(404).json({
    error: "Resource not found",
  });
};
