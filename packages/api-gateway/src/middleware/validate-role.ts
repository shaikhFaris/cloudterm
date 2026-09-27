// import type { RequestHandler } from "express";
// import type { Role } from "../types/db";
// import { ApiError } from "../utils/ApiError";

// export const authenticateRole =
//   (role: Role): RequestHandler =>
//   (req, res, next) => {
//     const reqRole = req.user?.role;
//     if (!role) throw new ApiError(500, "role not found");
//     console.log(role, reqRole);
//     if (role !== reqRole) throw new ApiError(403, "Access denied.");
//     next();
//   };
